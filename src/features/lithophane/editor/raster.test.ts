import { describe, expect, it } from "vitest";
import { createShapeTest } from "@/lib/geometry/shapes";
import type { FlatShape, ShapeParams } from "@/lib/geometry/types";
import type { GrayMap } from "@/lib/image/moon";
import {
  frontViewToLamp,
  makeSampler,
  SAMPLE_SIZE,
  type Domain,
  type PhotoPixels,
  type ProjectionSettings,
} from "@/lib/image/project";
import { MAX_RASTER_SIZE, OUTSIDE_ALPHA, rasterSize, renderEditorRaster } from "./raster";

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

function shape(kind: FlatShape, extra: Partial<ShapeParams> = {}): ShapeParams {
  return { shape: kind, crescent: 0.4, outerRadius: 0.9, innerRadius: 0.82, offsetX: 0.36, offsetY: 0, rotationDeg: 0, ...extra };
}

function noiseMap(width = 128, height = 64): GrayMap {
  let seed = 11;
  const data = new Uint8Array(width * height);
  for (let i = 0; i < data.length; i++) {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    data[i] = seed % 256;
  }
  return { width, height, data };
}

function solidPhoto(rgb: [number, number, number], w = 16, h = 12): PhotoPixels {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) data.set([...rgb, 255], i * 4);
  return { width: w, height: h, data };
}

const pixel = (out: Uint8ClampedArray, width: number, x: number, y: number) => Array.from(out.subarray((y * width + x) * 4, (y * width + x) * 4 + 4));

describe("rasterSize", () => {
  it("uses device pixels, capped on the longest side", () => {
    expect(rasterSize(200, 100, 1)).toEqual({ width: 200, height: 100 });
    expect(rasterSize(200, 100, 2)).toEqual({ width: 400, height: 200 });
    expect(rasterSize(600, 300, 2)).toEqual({ width: MAX_RASTER_SIZE, height: MAX_RASTER_SIZE / 2 });
    expect(rasterSize(600, 300, 2, 0.5)).toEqual({ width: MAX_RASTER_SIZE / 2, height: MAX_RASTER_SIZE / 4 });
    expect(rasterSize(4, 4, Number.NaN)).toEqual({ width: 16, height: 16 });
  });
});

describe("renderEditorRaster", () => {
  it("draws the flat composite and dims everything outside the shape", () => {
    const domain: Domain = { kind: "flat", widthMm: 120, heightMm: 90, shape: shape("crescent", { rotationDeg: 20 }) };
    const settings = { ...BASE, moonRotation: 20 };
    const moon = noiseMap();
    const photo = solidPhoto([200, 40, 10]);
    const width = 60;
    const height = 45;
    const out = new Uint8ClampedArray(width * height * 4);
    renderEditorRaster({ domain, settings, photo, moon, width, height }, out);

    const sampler = makeSampler(domain, settings, photo, moon, { spacing: 120 / width });
    const inside = createShapeTest(120, 90, domain.shape);
    const sample = new Float32Array(SAMPLE_SIZE);
    let dimmed = 0;
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const u = (x + 0.5) / width;
        const v = (y + 0.5) / height;
        sampler.flat(u, v, sample);
        const [r, g, b, a] = pixel(out, width, x, y);
        expect([r, g, b]).toEqual([Math.round(sample[0]), Math.round(sample[1]), Math.round(sample[2])]);
        expect(a).toBe(inside(u, v) ? 255 : OUTSIDE_ALPHA);
        if (a === OUTSIDE_ALPHA) dimmed++;
      }
    }
    expect(dimmed).toBeGreaterThan(0);
    expect(dimmed).toBeLessThan(width * height);
  });

  it("is white without the moon", () => {
    const domain: Domain = { kind: "flat", widthMm: 100, heightMm: 100, shape: shape("rectangle") };
    const out = new Uint8ClampedArray(8 * 8 * 4);
    renderEditorRaster({ domain, settings: { ...BASE, moonBackground: false }, photo: null, moon: noiseMap(), width: 8, height: 8 }, out);
    for (let i = 0; i < out.length; i += 4) expect(Array.from(out.subarray(i, i + 4))).toEqual([255, 255, 255, 255]);
  });

  it("draws the sphere's front view with a soft rim and an empty opening", () => {
    const domain: Domain = { kind: "sphere", openingDeg: 30 };
    const moon = noiseMap();
    const photo = solidPhoto([20, 180, 60]);
    const size = 64;
    const out = new Uint8ClampedArray(size * size * 4);
    renderEditorRaster({ domain, settings: BASE, photo, moon, width: size, height: size }, out);

    // Corners are outside the disc.
    expect(pixel(out, size, 0, 0)[3]).toBe(0);
    expect(pixel(out, size, size - 1, 0)[3]).toBe(0);
    // The bottom opening (below y = −cos 30°) is left empty for the hatch.
    expect(pixel(out, size, size / 2, size - 2)[3]).toBe(0);
    // Each disc pixel is the lamp sample under it.
    const sampler = makeSampler(domain, BASE, photo, moon, { spacing: 2 / size });
    const sample = new Float32Array(SAMPLE_SIZE);
    for (const [x, y] of [
      [32, 32],
      [20, 12],
      [45, 40],
    ]) {
      const fx = ((x + 0.5) / size) * 2 - 1;
      const fy = 1 - ((y + 0.5) / size) * 2;
      const lamp = frontViewToLamp(fx, fy)!;
      sampler.lamp(lamp.thetaDeg, lamp.phiDeg, sample);
      expect(pixel(out, size, x, y)).toEqual([Math.round(sample[0]), Math.round(sample[1]), Math.round(sample[2]), 255]);
    }
    // The centre is the (green) photo.
    expect(pixel(out, size, 32, 32).slice(0, 3)).toEqual([20, 180, 60]);
    // Rim pixels are partly transparent.
    const rim = Array.from({ length: size }, (_, x) => pixel(out, size, x, size / 2)[3]).filter((a) => a > 0 && a < 255);
    expect(rim.length).toBeGreaterThan(0);
  });

  it("rejects bad sizes and small buffers", () => {
    const domain: Domain = { kind: "sphere", openingDeg: 20 };
    const request = { domain, settings: BASE, photo: null, moon: null };
    expect(() => renderEditorRaster({ ...request, width: 0, height: 4 }, new Uint8ClampedArray(64))).toThrow();
    expect(() => renderEditorRaster({ ...request, width: 4, height: 4 }, new Uint8ClampedArray(16))).toThrow();
  });
});
