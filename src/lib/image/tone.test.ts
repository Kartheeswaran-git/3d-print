import { describe, expect, it } from "vitest";
import type { GrayMap } from "./moon";
import { gridSpacing, makeSampler, renderGrid, type Domain, type ProjectionSettings } from "./project";
import { composeLuminance } from "./render";
import { applyTone, gaussianBlur, rgbaToLuminance, type ToneSettings } from "./tone";

const NEUTRAL: ToneSettings = {
  brightness: 0,
  contrast: 1,
  gamma: 1,
  blur: 0,
  sharpen: 0,
  autoLevels: false,
  invert: false,
};

const field = (values: number[]) => Float32Array.from(values);
const mean = (a: Float32Array) => a.reduce((s, v) => s + v, 0) / a.length;

describe("rgbaToLuminance", () => {
  it("uses Rec. 709 weights and ignores alpha", () => {
    const rgba = new Uint8ClampedArray([255, 0, 0, 255, 0, 255, 0, 0, 0, 0, 255, 128, 255, 255, 255, 255]);
    const lum = rgbaToLuminance(rgba, 2, 2);
    expect(lum[0]).toBeCloseTo(0.2126, 5);
    expect(lum[1]).toBeCloseTo(0.7152, 5);
    expect(lum[2]).toBeCloseTo(0.0722, 5);
    expect(lum[3]).toBeCloseTo(1, 5);
  });

  it("rejects a short buffer", () => {
    expect(() => rgbaToLuminance(new Uint8ClampedArray(4), 2, 1)).toThrow();
  });
});

describe("gaussianBlur", () => {
  it("keeps a constant field constant (mean preserved)", () => {
    const w = 37;
    const h = 23;
    const src = new Float32Array(w * h).fill(0.42);
    for (const radius of [0.6, 2, 7.5, 30]) {
      const out = gaussianBlur(src, w, h, radius);
      expect(out).not.toBe(src);
      expect(mean(out)).toBeCloseTo(0.42, 5);
      for (const v of out) expect(v).toBeCloseTo(0.42, 5);
    }
  });

  it("spreads an impulse symmetrically and conserves its mass away from the edges", () => {
    const w = 41;
    const h = 41;
    const src = new Float32Array(w * h);
    src[20 * w + 20] = 1;
    const out = gaussianBlur(src, w, h, 2);
    const total = out.reduce((s, v) => s + v, 0);
    expect(total).toBeCloseTo(1, 4);
    expect(out[20 * w + 17]).toBeCloseTo(out[20 * w + 23], 6);
    expect(out[17 * w + 20]).toBeCloseTo(out[23 * w + 20], 6);
    expect(out[20 * w + 20]).toBeLessThan(1);
    expect(out[20 * w + 20]).toBeGreaterThan(out[20 * w + 21]);
  });

  it("wraps columns with wrapX: a seam impulse spreads to both sides and nothing is lost at the edges", () => {
    const w = 40;
    const h = 21;
    const mid = 10 * w;
    const src = new Float32Array(w * h);
    src[mid] = 1; // Column 0, middle row.
    const out = gaussianBlur(src, w, h, 2, { wrapX: true });
    expect(out.reduce((s, v) => s + v, 0)).toBeCloseTo(1, 4);
    expect(out[mid + w - 1]).toBeCloseTo(out[mid + 1], 6);
    expect(out[mid + w - 3]).toBeCloseTo(out[mid + 3], 6);
    // Without wrapping the mass piles up against the left edge and never reaches the last column.
    const clamped = gaussianBlur(src, w, h, 2);
    expect(clamped[mid + w - 1]).toBe(0);
    expect(clamped[mid]).toBeGreaterThan(out[mid]);
  });

  it("with wrapX commutes with rotating the columns (circular convolution), even for kernels wider than the grid", () => {
    const w = 12;
    const h = 5;
    const src = Float32Array.from({ length: w * h }, (_, i) => ((i * 37) % 11) / 10);
    const roll = (a: Float32Array, k: number) => {
      const r = new Float32Array(a.length);
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) r[y * w + ((x + k) % w)] = a[y * w + x];
      return r;
    };
    for (const radius of [1.5, 9]) {
      const a = roll(gaussianBlur(src, w, h, radius, { wrapX: true }), 5);
      const b = gaussianBlur(roll(src, 5), w, h, radius, { wrapX: true });
      a.forEach((v, i) => expect(v).toBeCloseTo(b[i], 5));
      // Identical rows: the vertical pass changes nothing and each row keeps its mean all the way round.
      const rows = Float32Array.from({ length: w * h }, (_, i) => src[i % w]);
      const blurred = gaussianBlur(rows, w, h, radius, { wrapX: true });
      for (let y = 0; y < h; y++) expect(mean(blurred.subarray(y * w, y * w + w))).toBeCloseTo(mean(rows.subarray(0, w)), 5);
    }
  });

  it("returns an unchanged copy for radius 0", () => {
    const src = field([0, 0.5, 1, 0.25]);
    const out = gaussianBlur(src, 2, 2, 0);
    expect(out).not.toBe(src);
    expect(Array.from(out)).toEqual(Array.from(src));
  });
});

describe("applyTone", () => {
  it("returns a new array and is the identity with neutral settings", () => {
    const src = field([0, 0.2, 0.5, 0.9]);
    const out = applyTone(src, 2, 2, NEUTRAL);
    expect(out).not.toBe(src);
    Array.from(out).forEach((v, i) => expect(v).toBeCloseTo(src[i], 6));
    expect(Array.from(src)).toEqual(Array.from(field([0, 0.2, 0.5, 0.9])));
  });

  it("applies brightness and contrast as clamp(((l + b/100) - .5) * c + .5)", () => {
    const src = field([0.1, 0.4, 0.6, 0.95]);
    const out = applyTone(src, 4, 1, { ...NEUTRAL, brightness: 20, contrast: 1.5 });
    const expected = Array.from(src).map((l) => Math.min(1, Math.max(0, (l + 0.2 - 0.5) * 1.5 + 0.5)));
    Array.from(out).forEach((v, i) => expect(v).toBeCloseTo(expected[i], 6));
    expect(out[3]).toBe(1);
  });

  it("applies gamma as l^(1/g) and then inverts", () => {
    const src = field([0.25, 0.5, 0.81, 1]);
    const out = applyTone(src, 2, 2, { ...NEUTRAL, gamma: 2 });
    Array.from(out).forEach((v, i) => expect(v).toBeCloseTo(Math.sqrt(src[i]), 6));
    const inverted = applyTone(src, 2, 2, { ...NEUTRAL, gamma: 2, invert: true });
    Array.from(inverted).forEach((v, i) => expect(v).toBeCloseTo(1 - Math.sqrt(src[i]), 6));
  });

  it("auto levels stretches the 0.5/99.5 percentiles to 0..1", () => {
    const n = 1000;
    const src = new Float32Array(n);
    for (let i = 0; i < n; i++) src[i] = 0.3 + (0.4 * i) / (n - 1);
    const out = applyTone(src, n, 1, { ...NEUTRAL, autoLevels: true });
    const sorted = Float32Array.from(out).sort();
    expect(sorted[0]).toBe(0);
    expect(sorted[n - 1]).toBe(1);
    // Monotonic and linear in the middle.
    expect(out[n / 2]).toBeCloseTo(0.5, 2);
    for (let i = 1; i < n; i++) expect(out[i]).toBeGreaterThanOrEqual(out[i - 1]);
  });

  it("auto levels ignores outliers below 0.5% / above 99.5%", () => {
    const n = 1000;
    const src = new Float32Array(n).fill(0.5);
    for (let i = 0; i < n; i++) src[i] = 0.4 + (0.2 * i) / (n - 1);
    src[0] = 0;
    src[n - 1] = 1;
    const out = applyTone(src, n, 1, { ...NEUTRAL, autoLevels: true });
    // The bulk (0.4..0.6) spans nearly the whole range instead of staying at 0.4..0.6.
    expect(out[10]).toBeLessThan(0.05);
    expect(out[n - 11]).toBeGreaterThan(0.95);
  });

  it("auto levels leaves a flat field alone", () => {
    const src = new Float32Array(16).fill(0.3);
    const out = applyTone(src, 4, 4, { ...NEUTRAL, autoLevels: true });
    for (const v of out) expect(v).toBeCloseTo(0.3, 6);
  });

  it("auto levels runs before brightness/contrast", () => {
    const src = field([0.4, 0.45, 0.55, 0.6]);
    const out = applyTone(src, 4, 1, { ...NEUTRAL, autoLevels: true, brightness: -50 });
    // Stretched first (≈ 0, .25, .75, 1), then shifted by -0.5 and clamped.
    expect(out[0]).toBe(0);
    expect(out[1]).toBe(0);
    expect(out[2]).toBeCloseTo(0.25, 2);
    expect(out[3]).toBeCloseTo(0.5, 2);
  });

  it("sharpens with the prototype 4-neighbour kernel", () => {
    const w = 3;
    const src = field([0.5, 0.5, 0.5, 0.5, 0.6, 0.5, 0.5, 0.5, 0.5]);
    const out = applyTone(src, w, 3, { ...NEUTRAL, sharpen: 0.5 });
    expect(out[4]).toBeCloseTo(0.6 + 0.5 * (4 * 0.6 - 4 * 0.5), 6);
    // Edge pixel (0,1): left neighbour clamps to itself.
    expect(out[3]).toBeCloseTo(0.5 + 0.5 * (4 * 0.5 - 0.5 - 0.6 - 0.5 - 0.5), 6);
  });

  it("scales the blur radius with the grid width (same look at preview and export size)", () => {
    const edge = (w: number) => {
      const src = new Float32Array(w * 4);
      for (let y = 0; y < 4; y++) for (let x = 0; x < w; x++) src[y * w + x] = x < w / 2 ? 0 : 1;
      return applyTone(src, w, 4, { ...NEUTRAL, blur: 3 });
    };
    const small = edge(160);
    const large = edge(640);
    // A point 2.5% of the width right of the edge sits at the same relative blur at both sizes…
    const at = (a: Float32Array, w: number) => a[Math.round(w * 0.525)];
    expect(Math.abs(at(small, 160) - at(large, 640))).toBeLessThan(0.03);
    // …whereas an unscaled 3 px blur would leave the large grid almost crisp there.
    expect(at(large, 640)).toBeLessThan(0.97);
    // Blur preserves the mean of a constant field.
    const flat = applyTone(new Float32Array(400).fill(0.7), 20, 20, { ...NEUTRAL, blur: 5 });
    expect(mean(flat)).toBeCloseTo(0.7, 5);
  });

  it("rejects mismatched sizes", () => {
    expect(() => applyTone(new Float32Array(3), 2, 2, NEUTRAL)).toThrow();
  });

  it("wraps blur and sharpen across the first and last columns with wrapX", () => {
    const w = 3;
    const src = field([0.5, 0.5, 0.6, 0.5, 0.5, 0.6, 0.5, 0.5, 0.6]);
    const out = applyTone(src, w, 3, { ...NEUTRAL, sharpen: 0.5 }, { wrapX: true });
    // Pixel (0,1): its left neighbour is the last column (0.6), not itself.
    expect(out[3]).toBeCloseTo(0.5 + 0.5 * (4 * 0.5 - 0.6 - 0.5 - 0.5 - 0.5), 6);
    // The blur radius scales with the width exactly as without wrapping.
    const seam = new Float32Array(80 * 4);
    for (let y = 0; y < 4; y++) seam[y * 80] = 1;
    const blurred = applyTone(seam, 80, 4, { ...NEUTRAL, blur: 2 }, { wrapX: true });
    expect(blurred[79]).toBeCloseTo(blurred[1], 6);
    expect(blurred[79]).toBeGreaterThan(0);
    expect(applyTone(seam, 80, 4, { ...NEUTRAL, blur: 2 })[79]).toBe(0);
  });
});

describe("composeLuminance tone wrapping (REVIEW R7)", () => {
  const settings: ProjectionSettings & ToneSettings = {
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
    ...NEUTRAL,
    blur: 6,
    sharpen: 0.3,
  };
  /** Light map with a dark band just east of the ±180° meridian, i.e. right next to the sphere's seam. */
  const map: GrayMap = (() => {
    const width = 256;
    const height = 128;
    const data = new Uint8Array(width * height).fill(220);
    for (let j = 0; j < height; j++) for (let i = 0; i < 6; i++) data[j * width + i] = 20;
    return { width, height, data };
  })();

  it("wraps the sphere across its seam and leaves flat pieces clamped", () => {
    const sphere: Domain = { kind: "sphere", openingDeg: 22 };
    const w = 64;
    const h = 33;
    const data = composeLuminance({ domain: sphere, width: w, height: h, photo: null, moon: map, settings });
    const grid = renderGrid(sphere, makeSampler(sphere, settings, null, map, { spacing: gridSpacing(sphere, w, h) }), w, h);
    expect(Array.from(data.field.values)).toEqual(Array.from(applyTone(grid.lum, w, h, settings, { wrapX: true })));
    // The last column (just west of the seam) picks up the dark band like its mirror column east of it.
    const clamped = applyTone(grid.lum, w, h, settings);
    const row = 16 * w;
    const plain = grid.lum[row + w - 1];
    expect(data.field.values[row + w - 1]).toBeLessThan(plain - 0.05);
    expect(Math.abs(data.field.values[row + w - 1] - data.field.values[row]) + 0.05).toBeLessThan(
      Math.abs(clamped[row + w - 1] - clamped[row]),
    );

    const flat: Domain = {
      kind: "flat",
      widthMm: 100,
      heightMm: 100,
      shape: { shape: "rectangle", crescent: 0.4, outerRadius: 0.9, innerRadius: 0.82, offsetX: 0, offsetY: 0, rotationDeg: 0 },
    };
    const flatData = composeLuminance({ domain: flat, width: 30, height: 30, photo: null, moon: map, settings });
    const flatGrid = renderGrid(flat, makeSampler(flat, settings, null, map, { spacing: gridSpacing(flat, 30, 30) }), 30, 30);
    expect(Array.from(flatData.field.values)).toEqual(Array.from(applyTone(flatGrid.lum, 30, 30, settings)));
  });
});
