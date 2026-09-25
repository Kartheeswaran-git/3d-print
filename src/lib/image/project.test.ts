import { describe, expect, it } from "vitest";
import { buildFlatJob } from "@/lib/geometry/jobs";
import { luminanceToHeights } from "@/lib/geometry/heightfield";
import { createShapeTest } from "@/lib/geometry/shapes";
import { buildSphereMesh } from "@/lib/geometry/sphere";
import type { FlatShape, ShapeParams } from "@/lib/geometry/types";
import { getPhotoPixels, type SourceImage } from "./load";
import { sampleMoon, type GrayMap } from "./moon";
import {
  decalCentre,
  frontViewToLamp,
  gridSpacing,
  lampToFrontView,
  lampToPlacement,
  makeSampler,
  photoCropRect,
  photoOutline,
  renderGrid,
  SAMPLE_SIZE,
  sphereColumnTheta,
  sphereRowPhi,
  wrapDegrees,
  type Domain,
  type PhotoPixels,
  type ProjectionSettings,
} from "./project";
import { composeLuminance, flatFootprint } from "./render";
import { applyTone, type ToneSettings } from "./tone";

const DEG = Math.PI / 180;

const BASE: ProjectionSettings = {
  imageScale: 60,
  imageX: 0,
  imageY: 0,
  rotation: 0,
  edgeBlend: 0,
  moonBackground: true,
  cropRatio: "original",
  cropScale: 1,
  cropX: 0,
  cropY: 0,
  moonLongitude: 0,
  moonRotation: 0,
};

const NEUTRAL_TONE: ToneSettings = { brightness: 0, contrast: 1, gamma: 1, blur: 0, sharpen: 0, autoLevels: false, invert: false };

const SPHERE: Domain = { kind: "sphere", openingDeg: 22 };

function shape(kind: FlatShape, extra: Partial<ShapeParams> = {}): ShapeParams {
  return { shape: kind, crescent: 0.4, outerRadius: 0.9, innerRadius: 0.82, offsetX: 0.36, offsetY: 0, rotationDeg: 0, ...extra };
}

type FlatDomain = Extract<Domain, { kind: "flat" }>;

function flat(kind: FlatShape, widthMm = 100, heightMm = 100, extra: Partial<ShapeParams> = {}): FlatDomain {
  return { kind: "flat", widthMm, heightMm, shape: shape(kind, extra) };
}

function makeMap(width: number, height: number, fn: (lon: number, lat: number) => number): GrayMap {
  const data = new Uint8Array(width * height);
  for (let j = 0; j < height; j++) {
    const lat = 90 - (180 * (j + 0.5)) / height;
    for (let i = 0; i < width; i++) data[j * width + i] = fn(-180 + (360 * (i + 0.5)) / width, lat);
  }
  return { width, height, data };
}

/** Great-circle distance in degrees. */
function angularDistance(lon1: number, lat1: number, lon2: number, lat2: number): number {
  const c =
    Math.sin(lat1 * DEG) * Math.sin(lat2 * DEG) + Math.cos(lat1 * DEG) * Math.cos(lat2 * DEG) * Math.cos((lon1 - lon2) * DEG);
  return Math.acos(Math.min(1, Math.max(-1, c))) / DEG;
}

/** Dark map with one bright spot (Mare Crisium sits at about 59° E, 17° N). */
function spotMap(lon0 = 59, lat0 = 17): GrayMap {
  return makeMap(720, 360, (lon, lat) => Math.round(40 + 200 * Math.exp(-((angularDistance(lon, lat, lon0, lat0) / 4) ** 2))));
}

/** Light map with one dark spot (flat pieces are white outside the disc, so look for the darkest sample). */
function darkSpotMap(lon0 = 59, lat0 = 17): GrayMap {
  return makeMap(720, 360, (lon, lat) => Math.round(220 - 200 * Math.exp(-((angularDistance(lon, lat, lon0, lat0) / 4) ** 2))));
}

function noiseMap(width = 64, height = 32): GrayMap {
  let seed = 7;
  return makeMap(width, height, () => {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    return seed % 256;
  });
}

const constantMap = (value: number): GrayMap => makeMap(16, 8, () => value);

function photo(width: number, height: number, fn: (x: number, y: number) => [number, number, number, number?]): PhotoPixels {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const [r, g, b, a = 255] = fn(x, y);
      data.set([r, g, b, a], (y * width + x) * 4);
    }
  }
  return { width, height, data };
}

const RED: [number, number, number] = [255, 0, 0];
const GREEN: [number, number, number] = [0, 255, 0];
const BLUE: [number, number, number] = [0, 0, 255];
const WHITE: [number, number, number] = [255, 255, 255];
const solid = (rgb: [number, number, number], w = 8, h = 8) => photo(w, h, () => rgb);
/** Quadrants: top-left red, top-right green, bottom-right blue, bottom-left white. */
const quadrants = photo(64, 64, (x, y) => (y < 32 ? (x < 32 ? RED : GREEN) : x < 32 ? WHITE : BLUE));

const out = new Float32Array(SAMPLE_SIZE);
const rgbOf = (o: Float32Array) => [Math.round(o[0]), Math.round(o[1]), Math.round(o[2])];

function lampAtFront(sampler: ReturnType<typeof makeSampler>, x: number, y: number): number[] {
  const lamp = frontViewToLamp(x, y);
  if (!lamp) throw new Error("outside the disc");
  sampler.lamp(lamp.thetaDeg, lamp.phiDeg, out);
  return rgbOf(out);
}

function brightest(lum: Float32Array): number {
  let best = 0;
  for (let i = 1; i < lum.length; i++) if (lum[i] > lum[best]) best = i;
  return best;
}

function darkest(lum: Float32Array): number {
  let best = 0;
  for (let i = 1; i < lum.length; i++) if (lum[i] < lum[best]) best = i;
  return best;
}

describe("sphere projection", () => {
  it("wraps the moon 1:1 — lamp(θ, φ) samples the map at (θ + moonLongitude, φ), no vertical squash", () => {
    const map = noiseMap();
    for (const moonLongitude of [0, 37, -120, 180]) {
      const sampler = makeSampler(SPHERE, { ...BASE, moonLongitude }, null, map);
      for (const theta of [-180, -90, 0, 45, 179]) {
        for (const phi of [-60, 0, 30, 85]) {
          sampler.lamp(theta, phi, out);
          const expected = sampleMoon(map, theta + moonLongitude, phi);
          expect(out[4]).toBeCloseTo(expected, 5);
          expect(out[0]).toBeCloseTo(expected * 255, 3);
          expect(out[1]).toBeCloseTo(out[0], 6);
          expect(out[3]).toBe(255);
        }
      }
    }
  });

  it("shows a spot at 59° E, 17° N on the right-hand, upper half of the front view", () => {
    const map = spotMap();
    const sampler = makeSampler(SPHERE, BASE, null, map);
    const N = 121;
    let best = { lum: -1, x: 0, y: 0 };
    for (let j = 0; j < N; j++) {
      for (let i = 0; i < N; i++) {
        const x = (2 * i) / (N - 1) - 1;
        const y = 1 - (2 * j) / (N - 1);
        const lamp = frontViewToLamp(x, y);
        if (!lamp) continue;
        sampler.lamp(lamp.thetaDeg, lamp.phiDeg, out);
        if (out[4] > best.lum) best = { lum: out[4], x, y };
      }
    }
    expect(best.x).toBeGreaterThan(0);
    expect(best.y).toBeGreaterThan(0);
    expect(best.x).toBeCloseTo(Math.cos(17 * DEG) * Math.sin(59 * DEG), 1);
    expect(best.y).toBeCloseTo(Math.sin(17 * DEG), 1);

    // Turning the moon by +59° brings the spot to the front centre.
    const turned = makeSampler(SPHERE, { ...BASE, moonLongitude: 59 }, null, map);
    turned.lamp(0, 17, out);
    expect(out[4]).toBeCloseTo(sampleMoon(map, 59, 17), 6);
    expect(out[4]).toBeGreaterThan(0.9);
  });

  it("renderGrid samples the mesh grid: θ = 360°(c/C − ½), φ = 90° − r/(R−1)(180° − opening)", () => {
    const map = spotMap();
    const sampler = makeSampler(SPHERE, BASE, null, map);
    const C = 360;
    const R = 181;
    const { lum, rgba } = renderGrid(SPHERE, sampler, C, R);
    expect(lum.length).toBe(C * R);
    expect(rgba.length).toBe(C * R * 4);
    const best = brightest(lum);
    const c = best % C;
    const r = Math.floor(best / C);
    expect(c).toBeGreaterThan(C / 2);
    expect(sphereColumnTheta(c, C)).toBeCloseTo(59, -0.5);
    expect(sphereRowPhi(r, R, 22)).toBeCloseTo(17, -0.5);
    expect(sphereColumnTheta(C / 2, C)).toBe(0);
    expect(sphereRowPhi(0, R, 22)).toBe(90);
    expect(sphereRowPhi(R - 1, R, 22)).toBeCloseTo(-68, 9);
    for (const [cc, rr] of [[0, 0], [C / 2, 90], [17, 180], [C - 1, 33]]) {
      sampler.lamp(sphereColumnTheta(cc, C), sphereRowPhi(rr, R, 22), out);
      expect(lum[rr * C + cc]).toBeCloseTo(out[4], 6);
      expect(rgba[(rr * C + cc) * 4]).toBe(Math.round(out[0]));
    }
  });

  it("end to end: the built lamp is thinnest at the spot, on the front-right, upper side", () => {
    const sampler = makeSampler(SPHERE, BASE, null, spotMap());
    const C = 240;
    const R = 121;
    const { lum } = renderGrid(SPHERE, sampler, C, R);
    const heights = luminanceToHeights({ width: C, height: R, values: lum }, { minThickness: 0.8, maxThickness: 3, gamma: 1 });
    const mesh = buildSphereMesh({ heights, diameterMm: 120, openingDeg: 22, withThickness: true });
    const perSurface = 1 + (R - 1) * C;
    let best = 1;
    for (let k = 2; k < perSurface; k++) if (mesh.thickness![k] < mesh.thickness![best]) best = k;
    const [x, y, z] = mesh.positions.slice(best * 3, best * 3 + 3);
    const len = Math.hypot(x, y, z);
    const expected = [Math.cos(17 * DEG) * Math.sin(59 * DEG), Math.sin(17 * DEG), Math.cos(17 * DEG) * Math.cos(59 * DEG)];
    expect((x * expected[0] + y * expected[1] + z * expected[2]) / len).toBeGreaterThan(0.998);
  });

  it("puts a centred photo on the front (θ ≈ 0), 60 % of the front-view width", () => {
    const sampler = makeSampler(SPHERE, BASE, solid(RED), constantMap(100));
    sampler.lamp(0, 0, out);
    expect(rgbOf(out)).toEqual(RED);
    sampler.lamp(180, 0, out);
    expect(rgbOf(out)).toEqual([100, 100, 100]);
    // Half-width 0.6 of the radius: covered while sin θ ≤ 0.6 on the equator.
    sampler.lamp(36, 0, out);
    expect(rgbOf(out)).toEqual(RED);
    sampler.lamp(-36, 0, out);
    expect(rgbOf(out)).toEqual(RED);
    sampler.lamp(38, 0, out);
    expect(rgbOf(out)).toEqual([100, 100, 100]);
  });

  it("is undistorted head-on: front-view position maps linearly to photo pixels", () => {
    const gradient = photo(256, 256, (x, y) => [x, y, 0]);
    const sampler = makeSampler(SPHERE, { ...BASE, moonBackground: false }, gradient, null);
    for (const x of [-0.5, -0.2, 0, 0.25, 0.55]) {
      for (const y of [-0.45, 0, 0.3]) {
        const [r, g] = lampAtFront(sampler, x, y);
        expect(r).toBeCloseTo((x / 1.2 + 0.5) * 256 - 0.5, -0.5);
        expect(g).toBeCloseTo((0.5 - y / 1.2) * 256 - 0.5, -0.5);
      }
    }
  });

  it("moves the decal with imageX (longitude) and imageY (latitude, negative = up), clear of the opening", () => {
    const red = solid(RED);
    const right = makeSampler(SPHERE, { ...BASE, imageScale: 20, imageX: 50 }, red, null);
    right.lamp(90, 0, out);
    expect(rgbOf(out)).toEqual(RED);
    right.lamp(0, 0, out);
    expect(rgbOf(out)).toEqual(WHITE);

    const up = makeSampler(SPHERE, { ...BASE, imageScale: 20, imageY: -50 }, red, null);
    up.lamp(0, 45, out);
    expect(rgbOf(out)).toEqual(RED);

    expect(decalCentre({ imageX: 0, imageY: 100 }, 22).phiDeg).toBeCloseTo(-63, 9);
    expect(decalCentre({ imageX: 0, imageY: -100 }, 22).phiDeg).toBe(80);
    expect(decalCentre({ imageX: -100, imageY: 0 }, 22).thetaDeg).toBe(-180);
    const low = makeSampler(SPHERE, { ...BASE, imageScale: 20, imageY: 100 }, red, null);
    low.lamp(0, -63, out);
    expect(rgbOf(out)).toEqual(RED);
  });

  it("rotates the photo clockwise on screen", () => {
    const upright = makeSampler(SPHERE, { ...BASE, moonBackground: false }, quadrants, null);
    expect(lampAtFront(upright, -0.3, 0.3)).toEqual(RED);
    expect(lampAtFront(upright, 0.3, 0.3)).toEqual(GREEN);
    const turned = makeSampler(SPHERE, { ...BASE, moonBackground: false, rotation: 90 }, quadrants, null);
    expect(lampAtFront(turned, 0.3, 0.3)).toEqual(RED);
    expect(lampAtFront(turned, 0.3, -0.3)).toEqual(GREEN);
    expect(lampAtFront(turned, -0.3, -0.3)).toEqual(BLUE);
    expect(lampAtFront(turned, -0.3, 0.3)).toEqual(WHITE);
  });

  it("crops to 1:1 for cropRatio \"model\" on the sphere", () => {
    const wide = solid(RED, 200, 100);
    expect(photoCropRect(SPHERE, { ...BASE, cropRatio: "model" }, wide)).toEqual({ x: 50, y: 0, w: 100, h: 100 });
    const model = makeSampler(SPHERE, { ...BASE, moonBackground: false, cropRatio: "model" }, wide, null);
    expect(lampAtFront(model, 0, 0.55)).toEqual(RED);
    const original = makeSampler(SPHERE, { ...BASE, moonBackground: false }, wide, null);
    expect(lampAtFront(original, 0, 0.55)).toEqual(WHITE);
    expect(lampAtFront(original, 0, 0.25)).toEqual(RED);
  });

  it("feathers the photo edge into the moon over edgeBlend (smoothstep), and not without the moon", () => {
    const black = solid([0, 0, 0]);
    const feathered = makeSampler(SPHERE, { ...BASE, edgeBlend: 50 }, black, constantMap(100));
    // hw = 0.6, feather f = 0.5 · 0.6 = 0.3; head-on the tangent x equals the front-view x.
    expect(lampAtFront(feathered, 0, 0)[0]).toBe(0);
    expect(lampAtFront(feathered, 0.3, 0)[0]).toBe(0);
    expect(lampAtFront(feathered, 0.45, 0)[0]).toBe(50);
    const t = 0.05 / 0.3;
    expect(lampAtFront(feathered, 0.55, 0)[0]).toBe(Math.round(100 * (1 - t * t * (3 - 2 * t))));
    expect(lampAtFront(feathered, 0.62, 0)[0]).toBe(100);

    const hard = makeSampler(SPHERE, { ...BASE, edgeBlend: 50, moonBackground: false }, black, constantMap(100));
    expect(lampAtFront(hard, 0.59, 0)[0]).toBe(0);
    expect(lampAtFront(hard, 0.61, 0)[0]).toBe(255);
  });

  it("lets transparent photo pixels show the background", () => {
    const clear = photo(8, 8, () => [255, 0, 0, 0]);
    const sampler = makeSampler(SPHERE, BASE, clear, constantMap(90));
    sampler.lamp(0, 0, out);
    expect(rgbOf(out)).toEqual([90, 90, 90]);
  });

  it("uses a white background (luminance 1) with the moon off or not loaded", () => {
    makeSampler(SPHERE, { ...BASE, moonBackground: false }, null, spotMap()).lamp(59, 17, out);
    expect(out[4]).toBeCloseTo(1, 6);
    makeSampler(SPHERE, BASE, null, null).lamp(0, 0, out);
    expect(out[4]).toBeCloseTo(1, 6);
  });
});

describe("flat projection", () => {
  it("circle: the disc centre samples the map at (moonLongitude, 0); outside the disc is white", () => {
    const map = noiseMap();
    const sampler = makeSampler(flat("circle"), { ...BASE, moonLongitude: 25 }, null, map);
    sampler.flat(0.5, 0.5, out);
    expect(out[4]).toBeCloseTo(sampleMoon(map, 25, 0), 6);
    sampler.flat(0.02, 0.02, out);
    expect(out[4]).toBeCloseTo(1, 6);
    // On the equator near the limb: lon = λ0 + asin(x / R).
    const x = 0.89;
    sampler.flat((x + 1) / 2, 0.5, out);
    expect(out[4]).toBeCloseTo(sampleMoon(map, 25 + Math.asin(x / 0.9) / DEG, 0), 5);
    // Straight up: lat = asin(y / R), lon = λ0.
    sampler.flat(0.5, 0.5 - 0.3 / 2, out);
    expect(out[4]).toBeCloseTo(sampleMoon(map, 25, Math.asin(0.3 / 0.9) / DEG), 5);
  });

  it("shows the moon as seen from Earth: 59° E, 17° N lands right and up on the disc", () => {
    const map = darkSpotMap();
    const domain = flat("circle");
    const w = 201;
    const { lum } = renderGrid(domain, makeSampler(domain, BASE, null, map), w, w);
    const best = darkest(lum);
    const u = (best % w) / (w - 1);
    const v = Math.floor(best / w) / (w - 1);
    expect(u).toBeCloseTo(0.5 + (0.9 * Math.cos(17 * DEG) * Math.sin(59 * DEG)) / 2, 2);
    expect(v).toBeCloseTo(0.5 - (0.9 * Math.sin(17 * DEG)) / 2, 2);

    const turned = makeSampler(domain, { ...BASE, moonLongitude: 59 }, null, map);
    const centred = renderGrid(domain, turned, w, w).lum;
    const c = darkest(centred);
    expect(Math.abs((c % w) - 100)).toBeLessThanOrEqual(1);
    expect(Math.floor(c / w)).toBeLessThan(100);
  });

  it("end to end: the flat crescent is thickest where the dark spot is (x right, y up in mm)", () => {
    const domain = flat("crescent", 100, 100, { crescent: 0.15, offsetX: -0.6 });
    const w = 161;
    const { lum } = renderGrid(domain, makeSampler(domain, BASE, null, darkSpotMap()), w, w);
    const mesh = buildFlatJob(
      {
        kind: "flat",
        luminance: { width: w, height: w, values: lum },
        mapping: { minThickness: 0.8, maxThickness: 3, gamma: 1 },
        widthMm: 100,
        heightMm: 100,
        baseMm: 0.8,
        shape: domain.shape,
      },
      { withThickness: true },
    );
    let best = 0;
    const t = mesh.thickness!;
    for (let k = 1; k < t.length; k++) if (t[k] > t[best]) best = k;
    const x = mesh.positions[best * 3];
    const y = mesh.positions[best * 3 + 1];
    expect(x).toBeCloseTo(50 * 0.9 * Math.cos(17 * DEG) * Math.sin(59 * DEG), -0.5);
    expect(y).toBeCloseTo(50 * 0.9 * Math.sin(17 * DEG), -0.5);
  });

  it("turns the disc with moonRotation exactly like the shape outline", () => {
    const map = noiseMap(256, 128);
    const r = 40;
    const plain = makeSampler(flat("crescent"), BASE, null, map);
    const rotatedDomain = flat("crescent", 100, 100, { rotationDeg: r });
    const rotated = makeSampler(rotatedDomain, { ...BASE, moonRotation: r }, null, map);
    const inPlain = createShapeTest(100, 100, shape("crescent"));
    const inRotated = createShapeTest(100, 100, shape("crescent", { rotationDeg: r }));
    const a = new Float32Array(SAMPLE_SIZE);
    for (const [u, v] of [[0.5, 0.5], [0.2, 0.4], [0.7, 0.8], [0.35, 0.15], [0.9, 0.5]]) {
      // Clockwise on screen (y down): (x, y) → (x cos r − y sin r, x sin r + y cos r) about the centre.
      const x = u - 0.5;
      const y = v - 0.5;
      const u2 = 0.5 + x * Math.cos(r * DEG) - y * Math.sin(r * DEG);
      const v2 = 0.5 + x * Math.sin(r * DEG) + y * Math.cos(r * DEG);
      expect(inRotated(u2, v2)).toBe(inPlain(u, v));
      plain.flat(u, v, a);
      rotated.flat(u2, v2, out);
      expect(out[4]).toBeCloseTo(a[4], 5);
    }
  });

  it("covers the whole piece for other shapes; rectangle and custom ignore moonRotation", () => {
    const grey = constantMap(100);
    const heart = makeSampler(flat("heart", 100, 60), BASE, null, grey);
    heart.flat(0.01, 0.01, out);
    expect(Math.round(out[0])).toBe(100);
    heart.flat(0.99, 0.99, out);
    expect(Math.round(out[0])).toBe(100);

    const map = noiseMap(128, 64);
    for (const kind of ["rectangle", "custom"] as const) {
      const a = makeSampler(flat(kind, 150, 100), BASE, null, map);
      const b = makeSampler(flat(kind, 150, 100), { ...BASE, moonRotation: 45 }, null, map);
      const va = new Float32Array(SAMPLE_SIZE);
      for (const [u, v] of [[0.3, 0.2], [0.8, 0.6]]) {
        a.flat(u, v, va);
        b.flat(u, v, out);
        expect(out[4]).toBeCloseTo(va[4], 6);
      }
    }
  });

  it("renderGrid samples the mesh points u = col/(w − 1), v = row/(h − 1)", () => {
    const domain = flat("circle");
    const sampler = makeSampler(domain, { ...BASE, imageX: 10 }, quadrants, noiseMap());
    const w = 5;
    const h = 4;
    const { lum, rgba } = renderGrid(domain, sampler, w, h);
    for (let r = 0; r < h; r++) {
      for (let c = 0; c < w; c++) {
        sampler.flat(c / (w - 1), r / (h - 1), out);
        expect(lum[r * w + c]).toBeCloseTo(out[4], 6);
        expect(rgba[(r * w + c) * 4 + 1]).toBe(Math.round(out[1]));
        expect(rgba[(r * w + c) * 4 + 3]).toBe(255);
      }
    }
    expect(() => renderGrid(domain, sampler, 0, 3)).toThrow(/at least 1 × 1/);
  });

  it("places the photo: imageScale % of the width, offsets in % of W / H (positive Y = down)", () => {
    const domain = flat("rectangle", 200, 100);
    const s = { ...BASE, moonBackground: false, imageScale: 25, imageX: 25, imageY: 20 };
    const sampler = makeSampler(domain, s, solid(RED, 100, 100), null);
    // 50 × 50 mm photo centred at (150, 70) mm.
    const at = (xMm: number, yMm: number) => {
      sampler.flat(xMm / 200, yMm / 100, out);
      return rgbOf(out);
    };
    expect(at(150, 70)).toEqual(RED);
    expect(at(174, 70)).toEqual(RED);
    expect(at(176, 70)).toEqual(WHITE);
    expect(at(150, 94)).toEqual(RED);
    expect(at(150, 96)).toEqual(WHITE);
    expect(at(126, 46)).toEqual(RED);
    expect(at(124, 46)).toEqual(WHITE);

    // "model" crops to the piece aspect (2:1) → 50 × 25 mm.
    const model = makeSampler(domain, { ...s, cropRatio: "model" }, solid(RED, 100, 100), null);
    model.flat(150 / 200, 82 / 100, out);
    expect(rgbOf(out)).toEqual(RED);
    model.flat(150 / 200, 83.5 / 100, out);
    expect(rgbOf(out)).toEqual(WHITE);
  });

  it("rotates the photo clockwise and honours the crop rect", () => {
    const domain = flat("square");
    const upright = makeSampler(domain, { ...BASE, moonBackground: false }, quadrants, null);
    upright.flat(0.35, 0.35, out);
    expect(rgbOf(out)).toEqual(RED);
    const turned = makeSampler(domain, { ...BASE, moonBackground: false, rotation: 90 }, quadrants, null);
    turned.flat(0.65, 0.35, out);
    expect(rgbOf(out)).toEqual(RED);
    turned.flat(0.65, 0.65, out);
    expect(rgbOf(out)).toEqual(GREEN);

    // Crop the top-left quadrant only: the whole photo area is red.
    const cropped = makeSampler(domain, { ...BASE, moonBackground: false, cropRatio: "1:1", cropScale: 0.5, cropX: -1, cropY: -1 }, quadrants, null);
    for (const [u, v] of [[0.25, 0.25], [0.75, 0.75], [0.5, 0.5]]) {
      cropped.flat(u, v, out);
      expect(rgbOf(out)).toEqual(RED);
    }
  });

  it("feathers in piece units: f = edgeBlend % of half the shorter photo side", () => {
    const domain = flat("rectangle");
    const sampler = makeSampler(domain, { ...BASE, edgeBlend: 50 }, solid([0, 0, 0]), constantMap(100));
    // hw = 30 mm, f = 15 mm; 7.5 mm inside the edge → smoothstep(0.5) = 0.5.
    sampler.flat((50 + 22.5) / 100, 0.5, out);
    expect(Math.round(out[0])).toBe(50);
    sampler.flat(0.5, 0.5, out);
    expect(Math.round(out[0])).toBe(0);
  });
});

describe("prefiltering", () => {
  it("averages detail finer than the sample spacing (moon and photo), exact without a spacing", () => {
    const checker = makeMap(512, 256, (lon, lat) => ((Math.floor((lon + 180) / (360 / 512)) + Math.floor((90 - lat) / (180 / 256))) % 2) * 255);
    const sharp = makeSampler(SPHERE, BASE, null, checker);
    sharp.lamp(-180 + 360 * (10.5 / 512), 90 - 180 * (20.5 / 256), out);
    expect([0, 1]).toContain(Math.round(out[4] * 1000) / 1000);
    const spacing = (8 * 2 * Math.PI) / 512;
    const soft = makeSampler(SPHERE, BASE, null, checker, { spacing });
    for (const [t, p] of [[3, 5], [40, -20], [-100, 60]]) {
      soft.lamp(t, p, out);
      expect(out[4]).toBeGreaterThan(0.4);
      expect(out[4]).toBeLessThan(0.6);
    }

    const grain = photo(1024, 1024, (x, y) => ((x + y) % 2 ? WHITE : [0, 0, 0]));
    const noMoon = { ...BASE, moonBackground: false };
    const photoSoft = makeSampler(SPHERE, noMoon, grain, null, { spacing: gridSpacing(SPHERE, 64, 33) });
    photoSoft.lamp(0, 0, out);
    expect(out[4]).toBeGreaterThan(0.4);
    expect(out[4]).toBeLessThan(0.6);
  });

  it("gridSpacing is the larger of the two sample distances", () => {
    expect(gridSpacing(flat("rectangle", 200, 100), 201, 51)).toBeCloseTo(2, 9);
    expect(gridSpacing(SPHERE, 360, 181)).toBeCloseTo((2 * Math.PI) / 360, 9);
    expect(gridSpacing({ kind: "sphere", openingDeg: 22 }, 720, 91)).toBeCloseTo((158 * DEG) / 90, 9);
  });
});

describe("editor helpers", () => {
  it("frontViewToLamp maps the unit disc onto the facing hemisphere", () => {
    expect(frontViewToLamp(0, 0)).toEqual({ thetaDeg: 0, phiDeg: 0 });
    expect(frontViewToLamp(1, 0)?.thetaDeg).toBeCloseTo(90, 9);
    expect(frontViewToLamp(0, 1)?.phiDeg).toBeCloseTo(90, 9);
    expect(frontViewToLamp(-0.5, 0)?.thetaDeg).toBeCloseTo(-30, 9);
    expect(frontViewToLamp(0.8, 0.7)).toBeNull();
    const p = lampToFrontView(59, 17);
    expect(p.x).toBeCloseTo(Math.cos(17 * DEG) * Math.sin(59 * DEG), 9);
    expect(p.y).toBeCloseTo(Math.sin(17 * DEG), 9);
    expect(p.visible).toBe(true);
    expect(lampToFrontView(120, 0).visible).toBe(false);
  });

  it("frontViewToLamp → lampToPlacement → decal centre round-trips", () => {
    for (let x = -0.95; x <= 0.95; x += 0.19) {
      for (let y = -0.8; y <= 0.95; y += 0.25) {
        const lamp = frontViewToLamp(x, y);
        if (!lamp) continue;
        const placement = lampToPlacement(lamp.thetaDeg, lamp.phiDeg);
        const centre = decalCentre(placement, 22);
        const back = lampToFrontView(centre.thetaDeg, centre.phiDeg);
        expect(back.x).toBeCloseTo(x, 9);
        expect(back.y).toBeCloseTo(y, 9);
      }
    }
    expect(lampToPlacement(90, 45)).toEqual({ imageX: 50, imageY: -50 });
    expect(lampToPlacement(0, 0)).toEqual({ imageX: 0, imageY: 0 });
    expect(lampToPlacement(200, -120).imageX).toBeCloseTo((-160 / 180) * 100, 9);
    expect(lampToPlacement(200, -120).imageY).toBe(100);
    expect(wrapDegrees(-180)).toBe(180);
    expect(wrapDegrees(540)).toBe(180);
    expect(wrapDegrees(-190)).toBe(170);
  });

  it("photoOutline (flat): rotated corners in piece coords, TL → TR → BR → BL", () => {
    const domain = flat("square");
    const { points, visible } = photoOutline(domain, BASE, 1.5, 4);
    expect(points.length).toBe(16);
    const corner = (k: number) => points[k * 4].map((n) => Math.round(n * 1e6) / 1e6);
    expect(corner(0)).toEqual([0.2, 0.3]);
    expect(corner(1)).toEqual([0.8, 0.3]);
    expect(corner(2)).toEqual([0.8, 0.7]);
    expect(corner(3)).toEqual([0.2, 0.7]);
    expect(visible.every(Boolean)).toBe(true);

    const turned = photoOutline(domain, { ...BASE, rotation: 90 }, 1.5, 4);
    expect(turned.points[0][0]).toBeCloseTo(0.7, 9);
    expect(turned.points[0][1]).toBeCloseTo(0.2, 9);

    const off = photoOutline(domain, { ...BASE, imageX: 40 }, 1, 4);
    expect(off.visible[4]).toBe(false); // TR corner at u = 1.2
    expect(off.visible[0]).toBe(true);
  });

  it("photoOutline (sphere): head-on the outline is the plain rectangle; beyond the hemisphere it is hidden", () => {
    const { points, visible } = photoOutline(SPHERE, BASE, 1, 8);
    expect(points[0][0]).toBeCloseTo(-0.6, 9);
    expect(points[0][1]).toBeCloseTo(0.6, 9);
    expect(points[16][0]).toBeCloseTo(0.6, 9);
    expect(points[16][1]).toBeCloseTo(-0.6, 9);
    expect(visible.every(Boolean)).toBe(true);
    const big = photoOutline(SPHERE, { ...BASE, imageScale: 100 }, 1, 8);
    expect(big.points[8]).toEqual([1, 1]);
    expect(big.visible[8]).toBe(false);
  });

  it("photoOutline agrees with the sampler for an off-centre, rotated decal and piece", () => {
    const s = { ...BASE, moonBackground: false, imageX: 30, imageY: -20, rotation: 25, imageScale: 40 };
    const pic = solid(RED, 150, 100);
    const sphere = makeSampler(SPHERE, s, pic, null);
    const centre = decalCentre(s, 22);
    const c = lampToFrontView(centre.thetaDeg, centre.phiDeg);
    const outline = photoOutline(SPHERE, s, 1.5, 12);
    let checked = 0;
    outline.points.forEach(([x, y], i) => {
      if (!outline.visible[i]) return;
      const inside = [c.x + (x - c.x) * 0.97, c.y + (y - c.y) * 0.97];
      const outside = [c.x + (x - c.x) * 1.03, c.y + (y - c.y) * 1.03];
      if (Math.hypot(outside[0], outside[1]) >= 1) return;
      expect(lampAtFront(sphere, inside[0], inside[1])).toEqual(RED);
      expect(lampAtFront(sphere, outside[0], outside[1])).toEqual(WHITE);
      checked++;
    });
    expect(checked).toBeGreaterThan(30);

    const piece = flat("rectangle", 160, 100);
    const flatSampler = makeSampler(piece, s, pic, null);
    const flatOutline = photoOutline(piece, s, 1.5, 12);
    const cu = 0.8;
    const cv = 0.3;
    flatOutline.points.forEach(([u, v]) => {
      flatSampler.flat(cu + (u - cu) * 0.97, cv + (v - cv) * 0.97, out);
      expect(rgbOf(out)).toEqual(RED);
      flatSampler.flat(cu + (u - cu) * 1.03, cv + (v - cv) * 1.03, out);
      expect(rgbOf(out)).toEqual(WHITE);
    });
  });
});

describe("composeLuminance", () => {
  it("tones the grid luminance and marks the flat footprint like the mesh", () => {
    const domain = flat("circle");
    const settings = { ...BASE, ...NEUTRAL_TONE, invert: true };
    const map = noiseMap();
    const data = composeLuminance({ domain, width: 41, height: 41, photo: null, moon: map, settings });
    const grid = renderGrid(domain, makeSampler(domain, settings, null, map, { spacing: gridSpacing(domain, 41, 41) }), 41, 41);
    expect(Array.from(data.field.values)).toEqual(Array.from(applyTone(grid.lum, 41, 41, settings)));
    expect(Array.from(data.rgba)).toEqual(Array.from(grid.rgba));
    expect(data.footprint![20 * 41 + 20]).toBe(1);
    expect(data.footprint![0]).toBe(0);
    expect(Array.from(flatFootprint(flat("rectangle"), 6, 5))).toEqual(new Array(30).fill(1));

    const sphere = composeLuminance({ domain: SPHERE, width: 24, height: 13, photo: null, moon: map, settings });
    expect(sphere.footprint).toBeNull();
    expect(sphere.field).toMatchObject({ width: 24, height: 13 });
  });
});

describe("getPhotoPixels", () => {
  it("reads the working copy once per source", () => {
    let reads = 0;
    const data = new Uint8ClampedArray(3 * 2 * 4).fill(9);
    const canvas = {
      width: 3,
      height: 2,
      getContext: () => ({
        getImageData: () => {
          reads++;
          return { data };
        },
      }),
    } as unknown as HTMLCanvasElement;
    const source: SourceImage = { canvas, width: 3, height: 2, originalWidth: 3, originalHeight: 2, name: "a.png" };
    const first = getPhotoPixels(source);
    expect(first).toEqual({ width: 3, height: 2, data });
    expect(getPhotoPixels(source)).toBe(first);
    expect(reads).toBe(1);
  });
});

describe("performance", () => {
  it("renders a 1024 × 513 sphere and a 720 × 720 flat grid quickly", () => {
    const moon = makeMap(4096, 2048, (lon, lat) => (Math.abs(Math.round(lon * 7 + lat * 3)) % 200) + 30);
    const pic = photo(2400, 1800, (x, y) => [(x * 7) % 256, (y * 3) % 256, (x + y) % 256]);
    const s = { ...BASE, edgeBlend: 20, rotation: 12 };
    const run = (domain: Domain, w: number, h: number) => {
      const sampler = makeSampler(domain, s, pic, moon, { spacing: gridSpacing(domain, w, h) });
      const t0 = performance.now();
      renderGrid(domain, sampler, w, h);
      return performance.now() - t0;
    };
    const crescent = flat("crescent");
    // Warm up (JIT, and the one-off mip levels of this photo and map).
    run(SPHERE, 256, 129);
    run(crescent, 180, 180);
    const sphereMs = run(SPHERE, 1024, 513);
    const flatMs = run(crescent, 720, 720);
    console.info(`renderGrid: sphere 1024×513 ${sphereMs.toFixed(0)} ms, flat 720×720 ${flatMs.toFixed(0)} ms`);
    expect(sphereMs).toBeLessThan(1000);
    expect(flatMs).toBeLessThan(1000);
  });
});
