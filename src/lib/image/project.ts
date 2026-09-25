import type { LithophaneSettings } from "@/features/lithophane/settings";
import type { ShapeParams } from "@/lib/geometry/types";
import { computeCropRect, type CompositionSettings } from "./compose";
import { moonMipLevels, sampleMoon, type GrayMap } from "./moon";

/**
 * Exact projection of the lamp composition (PURE — no DOM; runs in Node, a worker or the page).
 *
 * Lamp coordinates: longitude θ ∈ (−180°, 180°], θ = 0 faces the viewer (+Z), θ = +90° is +X (the
 * viewer's right); latitude φ = 90° − polar angle (+90° = top pole). Front view: orthographic from +Z,
 * x right, y up, unit disc = the sphere's silhouette.
 *
 * - Sphere: the moon map is wrapped 1:1 (lon = θ + moonLongitude, lat = φ; no stretching), and the photo
 *   is an orthographic decal centred at λ0 = imageX/100·180°, φ0 = −imageY/100·90° (clamped), so a centred
 *   photo sits on the front, undistorted when viewed head-on.
 * - Flat pieces: the moon is an orthographic disc as seen from Earth (radius = outerRadius for crescent and
 *   circle, "cover" otherwise), turned with the shape's rotation; the photo keeps the prototype placement
 *   (imageScale % of the piece width, offsets in % of width/height, clockwise rotation, crop rect).
 * - Everything is sampled per point by inverse mapping with bilinear filtering; with a sample spacing the
 *   moon map and the photo are prefiltered (trilinear mip levels) so fine detail doesn't alias.
 */

/** RGBA pixels of a photo (row-major, not premultiplied). Get one with `getPhotoPixels` (cached per source). */
export interface PhotoPixels {
  width: number;
  height: number;
  data: Uint8ClampedArray;
}

export type Domain =
  | { kind: "flat"; widthMm: number; heightMm: number; shape: ShapeParams }
  | { kind: "sphere"; openingDeg: number };

/** Settings the projection reads. */
export type ProjectionSettings = CompositionSettings & Pick<LithophaneSettings, "moonLongitude" | "moonRotation">;

/**
 * Writes one composite sample into `out` (length ≥ 5): [r, g, b, a] in 0..255 (always opaque, a = 255)
 * and [4] = Rec. 709 luminance 0..1 (before tone processing).
 */
export interface Sampler {
  /**
   * Domain coordinates u, v in 0..1 (v = 0 at the top). Flat: across the piece. Sphere: the equirectangular
   * unwrap centred on the front (θ = 360°·(u − ½), φ = 90° − 180°·v).
   */
  flat(u: number, v: number, out: Float32Array): void;
  /** Lamp coordinates in degrees. Flat pieces treat (θ, φ) as the unwrap above: u = θ/360 + ½, v = (90 − φ)/180. */
  lamp(thetaDeg: number, phiDeg: number, out: Float32Array): void;
}

export interface SamplerOptions {
  /**
   * Distance between neighbouring samples: millimetres on a flat piece; radians of arc on the sphere
   * (a front view N px across has spacing 2/N). Enables prefiltering; omit for plain bilinear sampling.
   * Use `gridSpacing` for a renderGrid grid.
   */
  spacing?: number;
}

/** Floats per sample written by a Sampler. */
export const SAMPLE_SIZE = 5;

const DEG = Math.PI / 180;
const RAD = 180 / Math.PI;
const LUMA_R = 0.2126;
const LUMA_G = 0.7152;
const LUMA_B = 0.0722;
/** The decal centre stays at least this far above the bottom opening, and below this latitude. */
const DECAL_OPENING_MARGIN_DEG = 5;
const DECAL_MAX_LAT_DEG = 80;

const clampNum = (n: number, min: number, max: number) => (n < min ? min : n > max ? max : n);
const finiteOr = (n: number, fallback: number) => (Number.isFinite(n) ? n : fallback);

/** Wrap an angle into (−180°, 180°]. */
export function wrapDegrees(deg: number): number {
  if (!Number.isFinite(deg)) return 0;
  const w = deg - Math.ceil((deg - 180) / 360) * 360;
  return w <= -180 ? w + 360 : w;
}

/** Aspect used by cropRatio "model": the piece (W / H) for flat shapes, 1:1 for the sphere decal. */
export function modelAspectFor(domain: Domain): number {
  return domain.kind === "sphere" ? 1 : domain.widthMm / domain.heightMm;
}

/** Source rectangle of the photo for these settings (see computeCropRect). */
export function photoCropRect(
  domain: Domain,
  s: CompositionSettings,
  photo: { width: number; height: number },
): { x: number; y: number; w: number; h: number } {
  return computeCropRect(photo.width, photo.height, s, modelAspectFor(domain));
}

/** Column c of C → θ = 360°·(c/C − ½) (matches buildSphereMesh). */
export function sphereColumnTheta(column: number, columns: number): number {
  return 360 * (column / columns - 0.5);
}

/** Row r of R → φ = 90° − r/(R − 1)·(180° − opening) (matches buildSphereMesh). */
export function sphereRowPhi(row: number, rows: number, openingDeg: number): number {
  return rows > 1 ? 90 - (row / (rows - 1)) * (180 - openingDeg) : 90;
}

/** Sample spacing of a renderGrid grid, in SamplerOptions units. */
export function gridSpacing(domain: Domain, width: number, height: number): number {
  if (domain.kind === "sphere") {
    const around = (2 * Math.PI) / Math.max(1, width);
    const down = height > 1 ? ((180 - domain.openingDeg) * DEG) / (height - 1) : around;
    return Math.max(around, down);
  }
  const across = width > 1 ? domain.widthMm / (width - 1) : domain.widthMm;
  const down = height > 1 ? domain.heightMm / (height - 1) : domain.heightMm;
  return Math.max(across, down);
}

/** Decal centre on the sphere for a placement (λ0, φ0 in degrees; φ0 kept clear of the opening and the pole). */
export function decalCentre(
  s: Pick<CompositionSettings, "imageX" | "imageY">,
  openingDeg: number,
): { thetaDeg: number; phiDeg: number } {
  const lower = -(90 - openingDeg - DECAL_OPENING_MARGIN_DEG);
  return {
    thetaDeg: (finiteOr(s.imageX, 0) / 100) * 180,
    phiDeg: clampNum((-finiteOr(s.imageY, 0) / 100) * 90, Math.min(lower, DECAL_MAX_LAT_DEG), DECAL_MAX_LAT_DEG),
  };
}

// ---------------------------------------------------------------------------------------------
// Photo mip levels + filtered sampling

/** 2×2 box downsample with alpha-weighted colour (edge texels repeat for odd sizes). */
function halvePhoto(p: PhotoPixels): PhotoPixels {
  const { width: w, height: h, data } = p;
  const nw = Math.max(1, Math.ceil(w / 2));
  const nh = Math.max(1, Math.ceil(h / 2));
  const out = new Uint8ClampedArray(nw * nh * 4);
  for (let y = 0; y < nh; y++) {
    const r0 = Math.min(h - 1, y * 2) * w;
    const r1 = Math.min(h - 1, y * 2 + 1) * w;
    for (let x = 0; x < nw; x++) {
      const c0 = Math.min(w - 1, x * 2);
      const c1 = Math.min(w - 1, x * 2 + 1);
      const a = (r0 + c0) * 4;
      const b = (r0 + c1) * 4;
      const c = (r1 + c0) * 4;
      const d = (r1 + c1) * 4;
      const aa = data[a + 3];
      const ab = data[b + 3];
      const ac = data[c + 3];
      const ad = data[d + 3];
      const sum = aa + ab + ac + ad;
      const o = (y * nw + x) * 4;
      if (sum > 0) {
        out[o] = (data[a] * aa + data[b] * ab + data[c] * ac + data[d] * ad) / sum;
        out[o + 1] = (data[a + 1] * aa + data[b + 1] * ab + data[c + 1] * ac + data[d + 1] * ad) / sum;
        out[o + 2] = (data[a + 2] * aa + data[b + 2] * ab + data[c + 2] * ac + data[d + 2] * ad) / sum;
      }
      out[o + 3] = sum / 4;
    }
  }
  return { width: nw, height: nh, data: out };
}

const photoMipCache = new WeakMap<PhotoPixels, PhotoPixels[]>();

/** Mip chain of a photo (level 0 = the photo itself), built lazily up to `maxLevel` and cached. */
function photoLevels(photo: PhotoPixels, maxLevel: number): PhotoPixels[] {
  let levels = photoMipCache.get(photo);
  if (!levels) {
    levels = [photo];
    photoMipCache.set(photo, levels);
  }
  while (levels.length <= maxLevel) {
    const last = levels[levels.length - 1];
    if (last.width <= 1 && last.height <= 1) break;
    levels.push(halvePhoto(last));
  }
  return levels;
}

/**
 * Bilinear, premultiplied sample of a photo at continuous pixel coords (x, y) in level-0 pixels.
 * Writes [r·a, g·a, b·a, a] (colour 0..255, a 0..1) into `acc`, scaled by `weight` and ADDED.
 */
function accumulatePhoto(p: PhotoPixels, x: number, y: number, weight: number, acc: Float64Array): void {
  const w = p.width;
  const h = p.height;
  const d = p.data;
  let fx = x - 0.5;
  if (!(fx > 0)) fx = 0;
  else if (fx > w - 1) fx = w - 1;
  let fy = y - 0.5;
  if (!(fy > 0)) fy = 0;
  else if (fy > h - 1) fy = h - 1;
  const x0 = Math.floor(fx);
  const y0 = Math.floor(fy);
  const tx = fx - x0;
  const ty = fy - y0;
  const x1 = x0 + 1 < w ? x0 + 1 : x0;
  const y1 = y0 + 1 < h ? y0 + 1 : y0;
  const i00 = (y0 * w + x0) * 4;
  const i10 = (y0 * w + x1) * 4;
  const i01 = (y1 * w + x0) * 4;
  const i11 = (y1 * w + x1) * 4;
  const k = weight / 255;
  const w00 = (1 - tx) * (1 - ty) * k * d[i00 + 3];
  const w10 = tx * (1 - ty) * k * d[i10 + 3];
  const w01 = (1 - tx) * ty * k * d[i01 + 3];
  const w11 = tx * ty * k * d[i11 + 3];
  acc[0] += d[i00] * w00 + d[i10] * w10 + d[i01] * w01 + d[i11] * w11;
  acc[1] += d[i00 + 1] * w00 + d[i10 + 1] * w10 + d[i01 + 1] * w01 + d[i11 + 1] * w11;
  acc[2] += d[i00 + 2] * w00 + d[i10 + 2] * w10 + d[i01 + 2] * w01 + d[i11 + 2] * w11;
  acc[3] += w00 + w10 + w01 + w11;
}

/** Fractional mip level for a footprint of `texelsPerSample` level-0 texels (0 = full detail). */
function mipLevel(texelsPerSample: number, levelCount: number): number {
  if (!(texelsPerSample > 1) || levelCount < 2) return 0;
  return Math.min(levelCount - 1, Math.log2(texelsPerSample));
}

/** Level-0 footprint → the photo levels needed and the blend between them. */
interface PhotoFilter {
  lo: PhotoPixels;
  hi: PhotoPixels | null;
  /** Level-0 pixel coords → level coords. */
  loSx: number;
  loSy: number;
  hiSx: number;
  hiSy: number;
  /** Weight of `hi` (0..1). */
  t: number;
}

function photoFilter(photo: PhotoPixels, texelsPerSample: number): PhotoFilter {
  const maxLevels = Math.max(1, Math.ceil(Math.log2(Math.max(photo.width, photo.height))) + 1);
  const level = mipLevel(texelsPerSample, maxLevels);
  const l0 = Math.floor(level);
  const t = level - l0;
  const levels = photoLevels(photo, t > 1e-3 ? l0 + 1 : l0);
  const lo = levels[Math.min(l0, levels.length - 1)];
  const hi = t > 1e-3 && l0 + 1 < levels.length ? levels[l0 + 1] : null;
  return {
    lo,
    hi,
    loSx: lo.width / photo.width,
    loSy: lo.height / photo.height,
    hiSx: hi ? hi.width / photo.width : 0,
    hiSy: hi ? hi.height / photo.height : 0,
    t: hi ? t : 0,
  };
}

/** Moon map level(s) for a footprint, sampled trilinearly with sampleMoon. */
interface MoonFilter {
  lo: GrayMap;
  hi: GrayMap | null;
  t: number;
}

function moonFilter(map: GrayMap, texelsPerSample: number): MoonFilter {
  const levels = moonMipLevels(map);
  const level = mipLevel(texelsPerSample, levels.length);
  const l0 = Math.floor(level);
  const t = level - l0;
  const hi = t > 1e-3 && l0 + 1 < levels.length ? levels[l0 + 1] : null;
  return { lo: levels[l0], hi, t: hi ? t : 0 };
}

function sampleMoonFiltered(f: MoonFilter, lon: number, lat: number): number {
  const a = sampleMoon(f.lo, lon, lat);
  return f.hi ? a + (sampleMoon(f.hi, lon, lat) - a) * f.t : a;
}

// ---------------------------------------------------------------------------------------------
// Sampler

/** Shared placement of the photo: crop rect, half size in local units, rotation and feather. */
interface Decal {
  filter: PhotoFilter;
  cropX: number;
  cropY: number;
  cropW: number;
  cropH: number;
  /** Half width / height in local units (flat: mm; sphere: sphere radii). */
  hw: number;
  hh: number;
  cos: number;
  sin: number;
  /** Feather distance in local units (0 = hard edge). */
  feather: number;
}

function makeDecal(
  domain: Domain,
  s: ProjectionSettings,
  photo: PhotoPixels | null,
  halfWidth: number,
  moonOn: boolean,
  spacing: number | undefined,
): Decal | null {
  if (!photo || !(photo.width >= 1) || !(photo.height >= 1) || photo.data.length < photo.width * photo.height * 4) {
    return null;
  }
  const crop = photoCropRect(domain, s, photo);
  if (!(crop.w > 0) || !(crop.h > 0) || !(halfWidth > 0) || !Number.isFinite(halfWidth)) return null;
  const hw = halfWidth;
  const hh = hw / (crop.w / crop.h);
  const texels = spacing && spacing > 0 ? (spacing * crop.w) / (2 * hw) : 0;
  const r = finiteOr(s.rotation, 0) * DEG;
  const blend = moonOn ? clampNum(finiteOr(s.edgeBlend, 0), 0, 100) / 100 : 0;
  return {
    filter: photoFilter(photo, texels),
    cropX: crop.x,
    cropY: crop.y,
    cropW: crop.w,
    cropH: crop.h,
    hw,
    hh,
    cos: Math.cos(r),
    sin: Math.sin(r),
    feather: blend * Math.min(hw, hh),
  };
}

/**
 * Composite the photo over the background grey `bg` (0..255) at local coords (lx right, ly DOWN) and
 * write the sample. `acc` is scratch.
 */
function writeSample(decal: Decal | null, lx: number, ly: number, bg: number, acc: Float64Array, out: Float32Array): void {
  let r = bg;
  let g = bg;
  let b = bg;
  if (decal) {
    const ax = lx < 0 ? -lx : lx;
    const ay = ly < 0 ? -ly : ly;
    if (ax <= decal.hw && ay <= decal.hh) {
      const px = decal.cropX + (lx / (2 * decal.hw) + 0.5) * decal.cropW;
      const py = decal.cropY + (ly / (2 * decal.hh) + 0.5) * decal.cropH;
      const f = decal.filter;
      acc[0] = acc[1] = acc[2] = acc[3] = 0;
      accumulatePhoto(f.lo, px * f.loSx, py * f.loSy, 1 - f.t, acc);
      if (f.hi) accumulatePhoto(f.hi, px * f.hiSx, py * f.hiSy, f.t, acc);
      let k = 1;
      if (decal.feather > 0) {
        const edge = Math.min(decal.hw - ax, decal.hh - ay);
        if (edge < decal.feather) {
          const t = edge / decal.feather;
          k = t * t * (3 - 2 * t);
        }
      }
      const a = acc[3] * k;
      if (a > 0) {
        r = r * (1 - a) + acc[0] * k;
        g = g * (1 - a) + acc[1] * k;
        b = b * (1 - a) + acc[2] * k;
      }
    }
  }
  out[0] = r;
  out[1] = g;
  out[2] = b;
  out[3] = 255;
  out[4] = (LUMA_R * r + LUMA_G * g + LUMA_B * b) / 255;
}

/** Shapes whose outline turns with moonRotation (the moon disc turns with them). */
const ROTATING_SHAPES = new Set<ShapeParams["shape"]>(["crescent", "circle", "heart", "rounded", "square"]);

function makeFlatSampler(
  domain: Extract<Domain, { kind: "flat" }>,
  s: ProjectionSettings,
  photo: PhotoPixels | null,
  moon: GrayMap | null,
  spacing: number | undefined,
): Sampler {
  const W = domain.widthMm;
  const H = domain.heightMm;
  const m = Math.min(W, H);
  const sx = W / m;
  const sy = H / m;
  const moonOn = s.moonBackground && moon !== null && m > 0 && Number.isFinite(m);
  const shape = domain.shape;
  const discRadius = shape.shape === "crescent" || shape.shape === "circle" ? shape.outerRadius : Math.hypot(sx, sy);
  const a = ROTATING_SHAPES.has(shape.shape) ? -finiteOr(s.moonRotation, 0) * DEG : 0;
  const mc = Math.cos(a);
  const ms = Math.sin(a);
  const lon0 = finiteOr(s.moonLongitude, 0);
  const invDisc = discRadius > 0 ? 1 / discRadius : 0;
  // One normalised unit is m/2 mm; at the disc centre one disc radius spans one radian of longitude.
  const moonTexels = moon && spacing && spacing > 0 ? ((spacing * 2) / m / discRadius) * (moon.width / (2 * Math.PI)) : 0;
  const mf = moon && moonOn ? moonFilter(moon, moonTexels) : null;

  const decal = makeDecal(domain, s, photo, (finiteOr(s.imageScale, 0) / 100) * W / 2, moonOn, spacing);
  const cx = W / 2 + (finiteOr(s.imageX, 0) / 100) * W;
  const cy = H / 2 + (finiteOr(s.imageY, 0) / 100) * H;
  const acc = new Float64Array(4);

  const flat = (u: number, v: number, out: Float32Array) => {
    let bg = 255;
    if (mf) {
      const nx = (u * 2 - 1) * sx;
      const ny = (v * 2 - 1) * sy;
      const dx = (nx * mc - ny * ms) * invDisc;
      const dy = -(nx * ms + ny * mc) * invDisc;
      const rho2 = dx * dx + dy * dy;
      if (rho2 <= 1) {
        const lat = Math.asin(dy) * RAD;
        const lon = lon0 + Math.atan2(dx, Math.sqrt(1 - rho2)) * RAD;
        bg = sampleMoonFiltered(mf, lon, lat) * 255;
      }
    }
    let lx = 0;
    let ly = 0;
    if (decal) {
      // Screen offset (y down) → photo-local: undo the clockwise rotation.
      const dx = u * W - cx;
      const dy = v * H - cy;
      lx = decal.cos * dx + decal.sin * dy;
      ly = -decal.sin * dx + decal.cos * dy;
    }
    writeSample(decal, lx, ly, bg, acc, out);
  };

  return {
    flat,
    lamp: (thetaDeg, phiDeg, out) => flat(thetaDeg / 360 + 0.5, (90 - phiDeg) / 180, out),
  };
}

function makeSphereSampler(
  domain: Extract<Domain, { kind: "sphere" }>,
  s: ProjectionSettings,
  photo: PhotoPixels | null,
  moon: GrayMap | null,
  spacing: number | undefined,
): Sampler {
  const moonOn = s.moonBackground && moon !== null;
  const lon0 = finiteOr(s.moonLongitude, 0);
  const moonTexels = moon && spacing && spacing > 0 ? spacing * (moon.width / (2 * Math.PI)) : 0;
  const mf = moon && moonOn ? moonFilter(moon, moonTexels) : null;

  const decal = makeDecal(domain, s, photo, finiteOr(s.imageScale, 0) / 100, moonOn, spacing);
  const centre = decalCentre(s, domain.openingDeg);
  const lam0 = centre.thetaDeg;
  const sinP0 = Math.sin(centre.phiDeg * DEG);
  const cosP0 = Math.cos(centre.phiDeg * DEG);
  const acc = new Float64Array(4);
  // Row-major grids keep φ constant along a row: remember its sine/cosine.
  let lastPhi = Number.NaN;
  let sinP = 0;
  let cosP = 1;

  const lamp = (thetaDeg: number, phiDeg: number, out: Float32Array) => {
    const bg = mf ? sampleMoonFiltered(mf, thetaDeg + lon0, phiDeg) * 255 : 255;
    if (!decal) {
      writeSample(null, 0, 0, bg, acc, out);
      return;
    }
    if (phiDeg !== lastPhi) {
      lastPhi = phiDeg;
      sinP = Math.sin(phiDeg * DEG);
      cosP = Math.cos(phiDeg * DEG);
    }
    const d = (thetaDeg - lam0) * DEG;
    const cd = Math.cos(d);
    const cosC = sinP0 * sinP + cosP0 * cosP * cd;
    if (!(cosC > 0)) {
      writeSample(null, 0, 0, bg, acc, out);
      return;
    }
    // Orthographic tangent-plane coords (x right, y up), then undo the clockwise rotation.
    const x = cosP * Math.sin(d);
    const y = cosP0 * sinP - sinP0 * cosP * cd;
    const lx = x * decal.cos - y * decal.sin;
    const lyUp = x * decal.sin + y * decal.cos;
    writeSample(decal, lx, -lyUp, bg, acc, out);
  };

  return {
    lamp,
    flat: (u, v, out) => lamp(360 * (u - 0.5), 90 - 180 * v, out),
  };
}

/**
 * Build the composite sampler for a domain: moon background (or white) with the photo on top.
 * `s.moonBackground` off, or `moon` null → white background (thinnest wall) and no edge feather.
 */
export function makeSampler(
  domain: Domain,
  s: ProjectionSettings,
  photo: PhotoPixels | null,
  moon: GrayMap | null,
  options: SamplerOptions = {},
): Sampler {
  const spacing = options.spacing !== undefined && options.spacing > 0 && Number.isFinite(options.spacing) ? options.spacing : undefined;
  return domain.kind === "sphere"
    ? makeSphereSampler(domain, s, photo, moon, spacing)
    : makeFlatSampler(domain, s, photo, moon, spacing);
}

/**
 * Sample the composite at the MESH grid points. Flat: point (col, row) → u = col/(w − 1), v = row/(h − 1)
 * (buildFlatMesh). Sphere: column c of C → θ = 360°·(c/C − ½), row r of R → φ = 90° − r/(R − 1)·(180° − opening)
 * (buildSphereMesh; rows never reach below the opening). Returns fresh arrays.
 */
export function renderGrid(
  domain: Domain,
  sampler: Sampler,
  width: number,
  height: number,
): { rgba: Uint8ClampedArray; lum: Float32Array } {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1) {
    throw new Error("The image grid must be at least 1 × 1 samples.");
  }
  const count = width * height;
  const rgba = new Uint8ClampedArray(count * 4);
  const lum = new Float32Array(count);
  const out = new Float32Array(SAMPLE_SIZE);
  let i = 0;
  if (domain.kind === "sphere") {
    const thetas = new Float64Array(width);
    for (let c = 0; c < width; c++) thetas[c] = sphereColumnTheta(c, width);
    for (let r = 0; r < height; r++) {
      const phi = sphereRowPhi(r, height, domain.openingDeg);
      for (let c = 0; c < width; c++, i++) {
        sampler.lamp(thetas[c], phi, out);
        const p = i * 4;
        rgba[p] = out[0];
        rgba[p + 1] = out[1];
        rgba[p + 2] = out[2];
        rgba[p + 3] = out[3];
        lum[i] = out[4];
      }
    }
  } else {
    for (let r = 0; r < height; r++) {
      const v = height > 1 ? r / (height - 1) : 0.5;
      for (let c = 0; c < width; c++, i++) {
        sampler.flat(width > 1 ? c / (width - 1) : 0.5, v, out);
        const p = i * 4;
        rgba[p] = out[0];
        rgba[p + 1] = out[1];
        rgba[p + 2] = out[2];
        rgba[p + 3] = out[3];
        lum[i] = out[4];
      }
    }
  }
  return { rgba, lum };
}

// ---------------------------------------------------------------------------------------------
// Editor geometry helpers

/**
 * Outline of the photo rectangle, `samplesPerEdge` points per edge, clockwise from the photo's top-left
 * corner: corners TL, TR, BR, BL are at indices 0, n, 2n, 3n.
 * - Flat: normalised piece coords [u, v] (v down); `visible` = inside the piece rectangle.
 * - Sphere: front-view coords [x, y] (x right, y up, unit disc); `visible` = on the lamp surface facing the
 *   viewer (not behind the globe, not over the bottom opening). Corners beyond the decal's hemisphere
 *   continue linearly (useful as handle positions) and are never visible.
 */
export function photoOutline(
  domain: Domain,
  s: CompositionSettings,
  cropAspect: number,
  samplesPerEdge = 16,
): { points: [number, number][]; visible: boolean[] } {
  const n = Math.max(1, Math.floor(samplesPerEdge));
  const aspect = Number.isFinite(cropAspect) && cropAspect > 0 ? cropAspect : 1;
  const r = finiteOr(s.rotation, 0) * DEG;
  const cr = Math.cos(r);
  const sr = Math.sin(r);
  const points: [number, number][] = [];
  const visible: boolean[] = [];

  // Local corners with y UP: TL, TR, BR, BL.
  const walk = (hw: number, hh: number, emit: (lx: number, lyUp: number) => void) => {
    const cx = [-hw, hw, hw, -hw];
    const cy = [hh, hh, -hh, -hh];
    for (let k = 0; k < 4; k++) {
      const x0 = cx[k];
      const y0 = cy[k];
      const x1 = cx[(k + 1) % 4];
      const y1 = cy[(k + 1) % 4];
      for (let i = 0; i < n; i++) {
        const t = i / n;
        emit(x0 + (x1 - x0) * t, y0 + (y1 - y0) * t);
      }
    }
  };

  if (domain.kind === "flat") {
    const W = domain.widthMm;
    const H = domain.heightMm;
    const hw = ((finiteOr(s.imageScale, 0) / 100) * W) / 2;
    const cx = W / 2 + (finiteOr(s.imageX, 0) / 100) * W;
    const cy = H / 2 + (finiteOr(s.imageY, 0) / 100) * H;
    walk(hw, hw / aspect, (lx, lyUp) => {
      const ly = -lyUp; // y down
      const u = (cx + cr * lx - sr * ly) / W;
      const v = (cy + sr * lx + cr * ly) / H;
      points.push([u, v]);
      visible.push(u >= 0 && u <= 1 && v >= 0 && v <= 1);
    });
    return { points, visible };
  }

  const hw = finiteOr(s.imageScale, 0) / 100;
  const centre = decalCentre(s, domain.openingDeg);
  const l0 = centre.thetaDeg * DEG;
  const p0 = centre.phiDeg * DEG;
  const sl = Math.sin(l0);
  const cl = Math.cos(l0);
  const sp = Math.sin(p0);
  const cp = Math.cos(p0);
  // Front-view basis of the tangent plane: centre C, east E, north N (components x, y, z).
  const C = [cp * sl, sp, cp * cl];
  const E = [cl, 0, -sl];
  const N = [-sp * sl, cp, -sp * cl];
  const minY = -Math.cos(domain.openingDeg * DEG);
  walk(hw, hw / aspect, (lx, lyUp) => {
    const x = lx * cr + lyUp * sr;
    const y = -lx * sr + lyUp * cr;
    const rho2 = x * x + y * y;
    const z = rho2 <= 1 ? Math.sqrt(1 - rho2) : 0;
    const px = x * E[0] + y * N[0] + z * C[0];
    const py = x * E[1] + y * N[1] + z * C[1];
    const pz = x * E[2] + y * N[2] + z * C[2];
    points.push([px, py]);
    visible.push(rho2 <= 1 && pz >= 0 && py >= minY);
  });
  return { points, visible };
}

/** Front-view point (unit disc, x right, y up) → lamp coords on the facing hemisphere; null outside the disc. */
export function frontViewToLamp(x: number, y: number): { thetaDeg: number; phiDeg: number } | null {
  const r2 = x * x + y * y;
  if (!(r2 <= 1 + 1e-9)) return null;
  const z = Math.sqrt(Math.max(0, 1 - r2));
  return { thetaDeg: Math.atan2(x, z) * RAD, phiDeg: Math.asin(clampNum(y, -1, 1)) * RAD };
}

/** Lamp coords → front-view point; `visible` is false on the far hemisphere. */
export function lampToFrontView(thetaDeg: number, phiDeg: number): { x: number; y: number; visible: boolean } {
  const t = thetaDeg * DEG;
  const p = phiDeg * DEG;
  const cp = Math.cos(p);
  return { x: cp * Math.sin(t), y: Math.sin(p), visible: cp * Math.cos(t) >= 0 };
}

/**
 * Placement that centres the sphere decal on (θ, φ): the inverse of the decal centre mapping
 * (imageX = θ/180·100, imageY = −φ/90·100), clamped to ±100. Values are not rounded.
 */
export function lampToPlacement(thetaDeg: number, phiDeg: number): { imageX: number; imageY: number } {
  const imageX = clampNum((wrapDegrees(thetaDeg) / 180) * 100, -100, 100);
  const imageY = clampNum((-finiteOr(phiDeg, 0) / 90) * 100, -100, 100);
  return { imageX: imageX === 0 ? 0 : imageX, imageY: imageY === 0 ? 0 : imageY };
}
