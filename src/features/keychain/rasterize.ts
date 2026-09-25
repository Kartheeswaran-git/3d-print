import type { ScalarField } from "@/lib/geometry/types";
import { gaussianBlur } from "@/lib/image/tone";
import { fontCss, KEYCHAIN_FONT_FACES, type KeychainFontFace } from "./fonts";
import { MASK_THRESHOLD, NUMERIC, type KeychainSettings } from "./settings";

export interface KeychainRaster {
  /** Coverage of the whole plate (ring + outlined text, counters filled, hole cut out), softened for a bevel. */
  baseAlpha: ScalarField;
  /** Coverage of the glyphs only, softened for a bevel. */
  textAlpha: ScalarField;
  /** Physical size of the grids (sample spacing = widthMm / (width − 1); 1 / dpmm unless the name exceeded canvas limits). */
  widthMm: number;
  heightMm: number;
  /** Outline width actually used (it is capped on short plates so the letters stay legible). */
  outlineMm: number;
  /** 2D silhouette for the "Outline" view: white plate, grey letters, subtle rim, transparent hole. */
  outline: HTMLCanvasElement;
}

const EMPTY_TEXT_MESSAGE = "Type a name to preview your keychain.";

/** Edge softening (σ) that gives the printed plate and letters a small bevel. */
const BEVEL_MM = 0.15;
/** The keyring wall is never thinner than this, whatever the outline width. */
const RING_MIN_WALL_MM = 1.5;
/** Outline is capped at this share of the plate height so letters keep ≥ 40 % of it. */
const MAX_OUTLINE_SHARE = 0.3;
/** Minimum width of the bridges that join words or marks that don't touch. */
const BRIDGE_MIN_MM = 2;
/** Canvas limits that every browser (including iOS Safari) can allocate and the mesher can handle. */
const MAX_SIDE_PX = 8192;
const MAX_SAMPLES = 4_000_000;

const clamp = (n: number, min: number, max: number) => Math.min(max, Math.max(min, n));
const clamp01 = (n: number) => (n < 0 ? 0 : n > 1 ? 1 : n);

/** Abramowitz–Stegun 7.1.26 (|error| < 1.5e-7). */
function erf(x: number): number {
  const sign = x < 0 ? -1 : 1;
  const ax = Math.abs(x);
  const t = 1 / (1 + 0.3275911 * ax);
  const poly = ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t;
  return sign * (1 - poly * Math.exp(-ax * ax));
}

/** z such that Φ(z) = p (bisection; only called once per raster). */
function normalQuantile(p: number): number {
  let lo = -8;
  let hi = 8;
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    if (0.5 * (1 + erf(mid / Math.SQRT2)) < p) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

function createContext(width: number, height: number): CanvasRenderingContext2D {
  if (typeof document === "undefined") throw new Error("Keychain rendering is only available in the browser.");
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, width);
  canvas.height = Math.max(1, height);
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("This browser couldn't create a drawing surface. Close other tabs and try again.");
  return ctx;
}

let measureCtx: CanvasRenderingContext2D | null = null;

interface InkMetrics {
  ascent: number;
  descent: number;
  left: number;
  right: number;
}

function measureInk(text: string, face: KeychainFontFace, sizePx: number): InkMetrics {
  measureCtx ??= createContext(1, 1);
  const ctx = measureCtx;
  ctx.font = fontCss(face, sizePx);
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  ctx.direction = "ltr";
  const m = ctx.measureText(text);
  return {
    ascent: m.actualBoundingBoxAscent,
    descent: m.actualBoundingBoxDescent,
    left: m.actualBoundingBoxLeft,
    right: m.actualBoundingBoxRight,
  };
}

function setTextStyle(ctx: CanvasRenderingContext2D, face: KeychainFontFace, sizePx: number) {
  ctx.font = fontCss(face, sizePx);
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  ctx.direction = "ltr";
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  ctx.fillStyle = "#fff";
  ctx.strokeStyle = "#fff";
}

/** Crisp coverage (alpha ≥ 50 %) as a 0/1 mask. */
function readSolid(ctx: CanvasRenderingContext2D, w: number, h: number): Uint8Array {
  const data = ctx.getImageData(0, 0, w, h).data;
  const out = new Uint8Array(w * h);
  for (let i = 0, p = 3; i < out.length; i++, p += 4) out[i] = data[p] >= 128 ? 1 : 0;
  return out;
}

function readAlpha(ctx: CanvasRenderingContext2D, w: number, h: number): Float32Array {
  const data = ctx.getImageData(0, 0, w, h).data;
  const out = new Float32Array(w * h);
  for (let i = 0, p = 3; i < out.length; i++, p += 4) out[i] = data[p] / 255;
  return out;
}

/** 4-connected component labels (0 = empty). */
function labelComponents(mask: Uint8Array, w: number, h: number): { labels: Int32Array; count: number } {
  const n = w * h;
  const labels = new Int32Array(n);
  const stack = new Int32Array(n);
  let count = 0;
  let sp = 0;
  const visit = (q: number) => {
    if (mask[q] && !labels[q]) {
      labels[q] = count;
      stack[sp++] = q;
    }
  };
  for (let i = 0; i < n; i++) {
    if (!mask[i] || labels[i]) continue;
    count++;
    visit(i);
    while (sp > 0) {
      const p = stack[--sp];
      const x = p % w;
      if (x > 0) visit(p - 1);
      if (x < w - 1) visit(p + 1);
      if (p >= w) visit(p - w);
      if (p + w < n) visit(p + w);
    }
  }
  return { labels, count };
}

interface Layout {
  dpmm: number;
  fontPx: number;
  ink: InkMetrics;
  outlinePx: number;
  ringPx: number;
  holePx: number;
  bevelPx: number;
  width: number;
  height: number;
  /** Left edge of the glyph ink and the text baseline. */
  inkX: number;
  baseline: number;
  cy: number;
}

function computeLayout(text: string, face: KeychainFontFace, s: KeychainSettings, dpmm: number, outlineMm: number, glyphMm: number): Layout {
  // Ink height scales linearly with the font size; refine once at the real size for hinting drift.
  const reference = measureInk(text, face, 200);
  const refHeight = reference.ascent + reference.descent;
  if (!(refHeight > 0) || !(reference.left + reference.right > 0)) throw new Error(EMPTY_TEXT_MESSAGE);
  let fontPx = (200 * glyphMm * dpmm) / refHeight;
  let ink = measureInk(text, face, fontPx);
  const measured = ink.ascent + ink.descent;
  if (measured > 0) {
    fontPx *= (glyphMm * dpmm) / measured;
    ink = measureInk(text, face, fontPx);
  }

  const outlinePx = outlineMm * dpmm;
  const holeR = s.holeSize / 2;
  const coreMm = glyphMm + outlineMm * 2;
  const ringMm = Math.max(holeR + RING_MIN_WALL_MM, Math.min(holeR + Math.max(outlineMm, RING_MIN_WALL_MM), coreMm / 2));
  const ringPx = ringMm * dpmm;
  const bevelPx = BEVEL_MM * dpmm;
  const pad = Math.ceil(bevelPx * 3) + 2;

  const inkW = ink.left + ink.right;
  const inkH = ink.ascent + ink.descent;
  const contentH = Math.max(inkH + outlinePx * 2, ringPx * 2);
  const height = Math.ceil(contentH + pad * 2);
  const inkX = pad + ringPx * 2 + outlinePx;
  const width = Math.ceil(inkX + inkW + outlinePx + pad);
  const cy = height / 2;
  return {
    dpmm,
    fontPx,
    ink,
    outlinePx,
    ringPx,
    holePx: holeR * dpmm,
    bevelPx,
    width,
    height,
    inkX,
    baseline: cy + (ink.ascent - ink.descent) / 2,
    cy,
  };
}

/** Ring centre x: as close to the text as possible while overlapping the outlined plate by `overlap` px. */
function ringCentreX(solid: Uint8Array, L: Layout, overlap: number): number {
  const { width: w, height: h, ringPx: R, cy } = L;
  let best = Infinity;
  const y0 = Math.max(0, Math.floor(cy - R));
  const y1 = Math.min(h - 1, Math.ceil(cy + R));
  for (let y = y0; y <= y1; y++) {
    const dy = y + 0.5 - cy;
    if (Math.abs(dy) >= R) continue;
    let left = -1;
    const row = y * w;
    for (let x = 0; x < w; x++) {
      if (solid[row + x]) {
        left = x;
        break;
      }
    }
    if (left < 0) continue;
    best = Math.min(best, left - Math.sqrt(R * R - dy * dy));
  }
  const fallback = L.inkX - L.outlinePx - R;
  const cx = Number.isFinite(best) ? best + overlap : fallback + overlap;
  return Math.max(cx, Math.ceil(L.bevelPx * 3) + 2 + R);
}

interface BridgeCandidate {
  length: number;
  labelA: number;
  labelB: number;
  pixelA: number;
  pixelB: number;
}

/**
 * Make the base plate a single piece. Pieces that don't touch (separate words, marks, letters
 * that only meet at a corner) are joined along a minimum spanning tree of their shortest gaps:
 * all pieces grow outwards together (multi-source BFS), every place where two fronts meet is a
 * candidate bridge, and the shortest set that connects everything is drawn as round-capped bars.
 */
function bridgeIslands(ctx: CanvasRenderingContext2D, L: Layout) {
  const { width: w, height: h } = L;
  const n = w * h;
  const inkH = L.ink.ascent + L.ink.descent;
  const bridgeW = Math.max(1, Math.min(inkH * 0.6, Math.max(L.outlinePx * 2, BRIDGE_MIN_MM * L.dpmm)));

  for (let round = 0; round < 3; round++) {
    const { labels, count } = labelComponents(readSolid(ctx, w, h), w, h);
    if (count <= 1) return;

    const owner = new Int32Array(labels);
    const dist = new Int32Array(n);
    const source = new Int32Array(n);
    const queue = new Int32Array(n);
    let tail = 0;
    for (let i = 0; i < n; i++) {
      if (owner[i]) {
        source[i] = i;
        queue[tail++] = i;
      }
    }
    const best = new Map<number, BridgeCandidate>();
    for (let head = 0; head < tail; head++) {
      const p = queue[head];
      const px = p % w;
      const py = (p - px) / w;
      const op = owner[p];
      for (let dy = -1; dy <= 1; dy++) {
        const y = py + dy;
        if (y < 0 || y >= h) continue;
        for (let dx = -1; dx <= 1; dx++) {
          const x = px + dx;
          if ((dx === 0 && dy === 0) || x < 0 || x >= w) continue;
          const q = y * w + x;
          const oq = owner[q];
          if (oq === 0) {
            owner[q] = op;
            dist[q] = dist[p] + 1;
            source[q] = source[p];
            queue[tail++] = q;
          } else if (oq !== op) {
            const a = Math.min(op, oq);
            const b = Math.max(op, oq);
            const key = a * (count + 1) + b;
            const length = dist[p] + dist[q] + 1;
            const current = best.get(key);
            if (!current || length < current.length) {
              const pa = op === a ? source[p] : source[q];
              const pb = op === a ? source[q] : source[p];
              best.set(key, { length, labelA: a, labelB: b, pixelA: pa, pixelB: pb });
            }
          }
        }
      }
    }

    // Kruskal over the candidate bridges.
    const parent = new Int32Array(count + 1);
    for (let i = 0; i <= count; i++) parent[i] = i;
    const find = (i: number): number => {
      let r = i;
      while (parent[r] !== r) {
        parent[r] = parent[parent[r]];
        r = parent[r];
      }
      return r;
    };
    ctx.lineCap = "round";
    ctx.lineWidth = bridgeW;
    const edges = [...best.values()].sort((e1, e2) => e1.length - e2.length);
    for (const e of edges) {
      const ra = find(e.labelA);
      const rb = find(e.labelB);
      if (ra === rb) continue;
      parent[ra] = rb;
      const ax = e.pixelA % w;
      const bx = e.pixelB % w;
      ctx.beginPath();
      ctx.moveTo(ax + 0.5, (e.pixelA - ax) / w + 0.5);
      ctx.lineTo(bx + 0.5, (e.pixelB - bx) / w + 0.5);
      ctx.stroke();
    }
  }
}

/**
 * Fill every background region the plate encloses (letter counters, slivers where the outline
 * almost closes) so the base is a solid silhouette; only the keyring hole, cut afterwards, stays open.
 */
function fillEnclosed(alpha: Float32Array, w: number, h: number) {
  const n = w * h;
  const outside = new Uint8Array(n);
  const queue = new Int32Array(n);
  let tail = 0;
  const seed = (i: number) => {
    if (!outside[i] && alpha[i] < 0.5) {
      outside[i] = 1;
      queue[tail++] = i;
    }
  };
  for (let x = 0; x < w; x++) {
    seed(x);
    seed((h - 1) * w + x);
  }
  for (let y = 0; y < h; y++) {
    seed(y * w);
    seed(y * w + w - 1);
  }
  // 8-connected background pairs with the 4-connected plate used everywhere else.
  for (let head = 0; head < tail; head++) {
    const p = queue[head];
    const px = p % w;
    const py = (p - px) / w;
    for (let dy = -1; dy <= 1; dy++) {
      const y = py + dy;
      if (y < 0 || y >= h) continue;
      for (let dx = -1; dx <= 1; dx++) {
        const x = px + dx;
        if (x >= 0 && x < w) seed(y * w + x);
      }
    }
  }
  for (let i = 0; i < n; i++) if (!outside[i]) alpha[i] = 1;
}

/** Cut the keyring hole with an antialiased edge. */
function cutHole(alpha: Float32Array, w: number, h: number, cx: number, cy: number, r: number) {
  const x0 = Math.max(0, Math.floor(cx - r - 1));
  const x1 = Math.min(w - 1, Math.ceil(cx + r + 1));
  const y0 = Math.max(0, Math.floor(cy - r - 1));
  const y1 = Math.min(h - 1, Math.ceil(cy + r + 1));
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy);
      alpha[y * w + x] *= clamp01(d - r + 0.5);
    }
  }
}

function buildOutline(base: Float32Array, text: Float32Array, w: number, h: number): HTMLCanvasElement {
  const ctx = createContext(w, h);
  const image = ctx.createImageData(w, h);
  const px = image.data;
  const t = MASK_THRESHOLD;
  const span = Math.max(0.05, 0.5 - t);
  // Plate white, rim cool grey (reads on light and dark stages), letters mid grey.
  const rim = [150, 158, 173];
  const ink = [128, 137, 153];
  for (let i = 0, p = 0; i < base.length; i++, p += 4) {
    const a = clamp01((base[i] - t) / span);
    if (a <= 0) continue;
    const r = clamp01(1 - (base[i] - t) / 0.4) * 0.85;
    const g = clamp01((text[i] - t) / span);
    for (let c = 0; c < 3; c++) {
      const plate = 255 + (rim[c] - 255) * r;
      px[p + c] = Math.round(plate + (ink[c] - plate) * g);
    }
    px[p + 3] = Math.round(a * 255);
  }
  ctx.putImageData(image, 0, 0);
  return ctx.canvas;
}

/**
 * Rasterise a name keychain: keyring on the left (with hole), outlined text, 0.15 mm bevel blur.
 * Glyph bounds are measured with actualBoundingBox* and the font is sized so the finished plate
 * (letters + 2 × outline, including the bevel's footprint) is exactly `targetHeight` tall; nothing
 * is clipped, the ring is vertically centred and overlaps the outline (FIXES K3). The base is always
 * one solid piece: separate words are bridged and letter counters filled. Very large names are
 * rasterised at a lower density to stay within canvas limits.
 * Returns fresh arrays every call. Empty text throws Error("Type a name to preview your keychain.").
 */
export function rasterizeKeychain(s: KeychainSettings, dpmm: number): KeychainRaster {
  const text = s.text.replace(/\s+/g, " ").trim();
  if (!text) throw new Error(EMPTY_TEXT_MESSAGE);
  if (!(dpmm > 0) || !Number.isFinite(dpmm)) throw new Error("Keychain density must be a positive number.");
  const face = KEYCHAIN_FONT_FACES[s.font] ?? KEYCHAIN_FONT_FACES.manrope;

  const spec = NUMERIC;
  const targetMm = clamp(s.targetHeight, spec.targetHeight.min, spec.targetHeight.max);
  const settings: KeychainSettings = {
    ...s,
    holeSize: clamp(s.holeSize, spec.holeSize.min, spec.holeSize.max),
  };
  // The bevel blur grows the solid footprint by σ·z beyond the crisp edge (z for the mask threshold).
  const growMm = BEVEL_MM * normalQuantile(1 - MASK_THRESHOLD);
  const coreMm = targetMm - growMm * 2;
  const outlineMm = Math.min(clamp(s.outlineWidth, spec.outlineWidth.min, spec.outlineWidth.max), coreMm * MAX_OUTLINE_SHARE);
  const glyphMm = coreMm - outlineMm * 2;

  let density = dpmm;
  let L = computeLayout(text, face, settings, density, outlineMm, glyphMm);
  for (let i = 0; i < 3; i++) {
    const factor = Math.min(MAX_SIDE_PX / Math.max(L.width, L.height), Math.sqrt(MAX_SAMPLES / (L.width * L.height)));
    if (factor >= 1) break;
    density *= factor * 0.97;
    L = computeLayout(text, face, settings, density, outlineMm, glyphMm);
  }

  const { width: w, height: h, cy } = L;
  const ctx = createContext(w, h);
  const originX = L.inkX + L.ink.left;

  // 1. Outlined text alone, to find where the ring can tuck in.
  setTextStyle(ctx, face, L.fontPx);
  ctx.lineWidth = L.outlinePx * 2;
  ctx.strokeText(text, originX, L.baseline);
  ctx.fillText(text, originX, L.baseline);
  const overlap = Math.max(1, (L.ringPx - L.holePx) * 0.5);
  const cx = ringCentreX(readSolid(ctx, w, h), L, overlap);

  // 2. Ring disc + outlined text (+ bridges if needed), counters filled, then the hole cut.
  ctx.beginPath();
  ctx.arc(cx, cy, L.ringPx, 0, Math.PI * 2);
  ctx.fill();
  bridgeIslands(ctx, L);
  const plate = readAlpha(ctx, w, h);
  fillEnclosed(plate, w, h);
  cutHole(plate, w, h, cx, cy, L.holePx);
  const baseFull = gaussianBlur(plate, w, h, L.bevelPx);

  // 3. Glyphs only.
  ctx.clearRect(0, 0, w, h);
  setTextStyle(ctx, face, L.fontPx);
  ctx.fillText(text, originX, L.baseline);
  const textFull = gaussianBlur(readAlpha(ctx, w, h), w, h, L.bevelPx);

  // 4. Crop to the printed footprint so widthMm / heightMm are the real plate size.
  let x0 = w;
  let y0 = h;
  let x1 = -1;
  let y1 = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (baseFull[y * w + x] > MASK_THRESHOLD) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
  }
  if (x1 < x0 || y1 < y0) throw new Error(EMPTY_TEXT_MESSAGE);
  const cw = Math.max(2, x1 - x0 + 1);
  const ch = Math.max(2, y1 - y0 + 1);
  const base = new Float32Array(cw * ch);
  const glyphs = new Float32Array(cw * ch);
  for (let y = 0; y < ch; y++) {
    const sy = Math.min(h - 1, y0 + y);
    for (let x = 0; x < cw; x++) {
      const sx = Math.min(w - 1, x0 + x);
      base[y * cw + x] = baseFull[sy * w + sx];
      glyphs[y * cw + x] = textFull[sy * w + sx];
    }
  }

  return {
    baseAlpha: { width: cw, height: ch, values: base },
    textAlpha: { width: cw, height: ch, values: glyphs },
    widthMm: (cw - 1) / L.dpmm,
    heightMm: (ch - 1) / L.dpmm,
    outlineMm,
    outline: buildOutline(base, glyphs, cw, ch),
  };
}
