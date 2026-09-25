import { describe, expect, it } from "vitest";
import { CROP_RATIOS, DEFAULTS } from "@/features/lithophane/settings";
import { computeCropRect, type CompositionSettings } from "./compose";

const base: CompositionSettings = {
  imageScale: DEFAULTS.imageScale,
  imageX: DEFAULTS.imageX,
  imageY: DEFAULTS.imageY,
  rotation: DEFAULTS.rotation,
  edgeBlend: DEFAULTS.edgeBlend,
  moonBackground: DEFAULTS.moonBackground,
  cropRatio: "original",
  cropScale: 1,
  cropX: 0,
  cropY: 0,
};

const W = 4000;
const H = 3000;

describe("computeCropRect", () => {
  it("original keeps the whole source", () => {
    expect(computeCropRect(W, H, base, 1)).toEqual({ x: 0, y: 0, w: W, h: H });
  });

  it("model matches the model aspect (not the source) — FIXES L4", () => {
    const flatWide = computeCropRect(W, H, { ...base, cropRatio: "model" }, 2);
    expect(flatWide.w / flatWide.h).toBeCloseTo(2, 6);
    expect(flatWide).toMatchObject({ w: W, h: 2000, x: 0, y: 500 });

    const tall = computeCropRect(W, H, { ...base, cropRatio: "model" }, 0.5);
    expect(tall).toMatchObject({ w: 1500, h: H, x: 1250, y: 0 });
  });

  it.each([
    ["1:1", 1, { w: 3000, h: 3000, x: 500, y: 0 }],
    ["4:3", 4 / 3, { w: 4000, h: 3000, x: 0, y: 0 }],
    ["3:4", 3 / 4, { w: 2250, h: 3000, x: 875, y: 0 }],
    ["16:9", 16 / 9, { w: 4000, h: 2250, x: 0, y: 375 }],
    ["9:16", 9 / 16, { w: 1687.5, h: 3000, x: 1156.25, y: 0 }],
  ] as const)("%s crops the largest centred rect of that aspect", (ratio, aspect, expected) => {
    const rect = computeCropRect(W, H, { ...base, cropRatio: ratio }, 1);
    expect(rect.w / rect.h).toBeCloseTo(aspect, 6);
    expect(rect.w).toBeCloseTo(expected.w, 6);
    expect(rect.h).toBeCloseTo(expected.h, 6);
    expect(rect.x).toBeCloseTo(expected.x, 6);
    expect(rect.y).toBeCloseTo(expected.y, 6);
  });

  it("every ratio stays inside the source for any scale and offset", () => {
    for (const cropRatio of CROP_RATIOS) {
      for (const cropScale of [0.5, 0.73, 1]) {
        for (const cropX of [-1, -0.3, 0, 1]) {
          for (const cropY of [-1, 0.6, 1]) {
            const r = computeCropRect(W, H, { ...base, cropRatio, cropScale, cropX, cropY }, 1.6);
            expect(r.x).toBeGreaterThanOrEqual(-1e-9);
            expect(r.y).toBeGreaterThanOrEqual(-1e-9);
            expect(r.x + r.w).toBeLessThanOrEqual(W + 1e-9);
            expect(r.y + r.h).toBeLessThanOrEqual(H + 1e-9);
          }
        }
      }
    }
  });

  it("scales by cropScale and offsets within the free gap", () => {
    const centred = computeCropRect(W, H, { ...base, cropScale: 0.5 }, 1);
    expect(centred).toEqual({ x: 1000, y: 750, w: 2000, h: 1500 });

    const topLeft = computeCropRect(W, H, { ...base, cropScale: 0.5, cropX: -1, cropY: -1 }, 1);
    expect(topLeft).toEqual({ x: 0, y: 0, w: 2000, h: 1500 });

    const bottomRight = computeCropRect(W, H, { ...base, cropScale: 0.5, cropX: 1, cropY: 1 }, 1);
    expect(bottomRight).toEqual({ x: 2000, y: 1500, w: 2000, h: 1500 });

    const halfway = computeCropRect(W, H, { ...base, cropScale: 0.5, cropX: 0.5 }, 1);
    expect(halfway.x).toBe(1500);
  });

  it("falls back to the source aspect for an unusable model aspect", () => {
    expect(computeCropRect(W, H, { ...base, cropRatio: "model" }, 0)).toEqual({ x: 0, y: 0, w: W, h: H });
    expect(computeCropRect(W, H, { ...base, cropRatio: "model" }, Number.NaN)).toEqual({ x: 0, y: 0, w: W, h: H });
  });

  it("returns an empty rect for an empty source", () => {
    expect(computeCropRect(0, 100, base, 1)).toEqual({ x: 0, y: 0, w: 0, h: 0 });
  });
});
