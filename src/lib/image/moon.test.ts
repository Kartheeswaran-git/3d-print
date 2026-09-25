import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULTS,
  formatMoonLongitude,
  MOON_SURFACE_LABELS,
  MOON_SURFACES,
  NUMERIC,
  parseProjectFile,
  sanitizeSettings,
} from "@/features/lithophane/settings";
import { grayMapFromRgba, loadMoonMap, MOON_MAP_URLS, moonMipLevels, sampleMoon, type GrayMap } from "./moon";

/** 4 × 2 map: row 0 (lat +45° centres) = 0, 40, 80, 120; row 1 (lat −45°) = 200, 210, 220, 230. */
const small: GrayMap = { width: 4, height: 2, data: Uint8Array.from([0, 40, 80, 120, 200, 210, 220, 230]) };
/** Texel centres of `small`: lon −135, −45, 45, 135; lat 45, −45. */
const LONS = [-135, -45, 45, 135];

describe("sampleMoon", () => {
  it("returns texel values at texel centres (pixel-is-area)", () => {
    for (let i = 0; i < 4; i++) {
      expect(sampleMoon(small, LONS[i], 45)).toBeCloseTo(small.data[i] / 255, 6);
      expect(sampleMoon(small, LONS[i], -45)).toBeCloseTo(small.data[4 + i] / 255, 6);
    }
  });

  it("interpolates bilinearly between texel centres", () => {
    expect(sampleMoon(small, 0, 45)).toBeCloseTo(60 / 255, 6);
    expect(sampleMoon(small, -135, 0)).toBeCloseTo(100 / 255, 6);
    expect(sampleMoon(small, 0, 0)).toBeCloseTo((40 + 80 + 210 + 220) / 4 / 255, 6);
  });

  it("wraps longitude across the ±180° seam and for any multiple of 360°", () => {
    // Halfway between the last column (135°) and the first (−135° ≡ 225°).
    expect(sampleMoon(small, 180, 45)).toBeCloseTo(60 / 255, 6);
    expect(sampleMoon(small, -180, 45)).toBeCloseTo(60 / 255, 6);
    expect(sampleMoon(small, 157.5, 45)).toBeCloseTo((120 * 0.75 + 0 * 0.25) / 255, 6);
    for (const lon of [-170, -20, 33, 179.9]) {
      expect(sampleMoon(small, lon + 360, -10)).toBeCloseTo(sampleMoon(small, lon, -10), 6);
      expect(sampleMoon(small, lon - 720, -10)).toBeCloseTo(sampleMoon(small, lon, -10), 6);
    }
  });

  it("clamps latitude to the first and last rows", () => {
    expect(sampleMoon(small, -45, 90)).toBeCloseTo(40 / 255, 6);
    expect(sampleMoon(small, -45, 120)).toBeCloseTo(40 / 255, 6);
    expect(sampleMoon(small, -45, -90)).toBeCloseTo(210 / 255, 6);
    expect(sampleMoon(small, -45, -400)).toBeCloseTo(210 / 255, 6);
  });

  it("never returns NaN for non-finite input", () => {
    expect(Number.isFinite(sampleMoon(small, Number.NaN, Number.NaN))).toBe(true);
    expect(Number.isFinite(sampleMoon(small, Number.POSITIVE_INFINITY, 0))).toBe(true);
  });
});

describe("grayMapFromRgba", () => {
  it("uses Rec. 709 luma and ignores alpha", () => {
    const rgba = Uint8ClampedArray.from([255, 0, 0, 0, 0, 255, 0, 255, 0, 0, 255, 255, 90, 90, 90, 255]);
    const map = grayMapFromRgba(rgba, 2, 2);
    expect(Array.from(map.data)).toEqual([54, 182, 18, 90]);
    expect(() => grayMapFromRgba(rgba, 3, 2)).toThrow();
  });
});

describe("moonMipLevels", () => {
  it("halves each level with a box filter, down to ~8 texels wide, and caches the chain", () => {
    const data = new Uint8Array(64 * 32);
    for (let i = 0; i < data.length; i++) data[i] = (i * 37) % 256;
    const map: GrayMap = { width: 64, height: 32, data };
    const levels = moonMipLevels(map);
    expect(levels[0]).toBe(map);
    expect(levels.map((l) => l.width)).toEqual([64, 32, 16, 8]);
    expect(levels.map((l) => l.height)).toEqual([32, 16, 8, 4]);
    expect(levels[1].data[0]).toBe(Math.round((data[0] + data[1] + data[64] + data[65]) / 4));
    const mean = (m: GrayMap) => m.data.reduce((s, v) => s + v, 0) / m.data.length;
    expect(Math.abs(mean(levels[3]) - mean(map))).toBeLessThan(1);
    expect(moonMipLevels(map)).toBe(levels);
  });
});

describe("loadMoonMap", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function stubDecoder(width: number, height: number, fill: (i: number) => number) {
    const rgba = new Uint8ClampedArray(width * height * 4);
    for (let i = 0; i < width * height; i++) {
      rgba.fill(fill(i), i * 4, i * 4 + 3);
      rgba[i * 4 + 3] = 255;
    }
    const close = vi.fn();
    vi.stubGlobal("createImageBitmap", vi.fn(async () => ({ width, height, close })));
    vi.stubGlobal(
      "OffscreenCanvas",
      class {
        getContext() {
          return { drawImage: () => {}, getImageData: () => ({ data: rgba }) };
        }
      },
    );
    return { close };
  }

  it("fetches the right file per surface and quality, decodes to gray and caches the promise", async () => {
    const fetchMock = vi.fn(async () => new Response(new Blob([new Uint8Array(4)])));
    vi.stubGlobal("fetch", fetchMock);
    const { close } = stubDecoder(4, 2, (i) => i * 10);
    const first = loadMoonMap("shaded", "preview");
    expect(loadMoonMap("shaded", "export")).toBe(first); // one file for both qualities
    const map = await first;
    expect(map).toMatchObject({ width: 4, height: 2 });
    expect(Array.from(map.data)).toEqual([0, 10, 20, 30, 40, 50, 60, 70]);
    expect(close).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(MOON_MAP_URLS.shaded.preview);
    expect(MOON_MAP_URLS.lro).toEqual({ preview: "/moon/lro-albedo-2k.jpg", export: "/moon/lro-albedo-4k.jpg" });
  });

  it("rejects with a readable message and retries after a failure", async () => {
    const fetchMock = vi.fn(async () => new Response("missing", { status: 404 }));
    vi.stubGlobal("fetch", fetchMock);
    stubDecoder(2, 1, () => 0);
    await expect(loadMoonMap("lro", "export")).rejects.toThrow(/moon surface couldn't be loaded/);
    await expect(loadMoonMap("lro", "export")).rejects.toThrow(/moon surface couldn't be loaded/);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

describe("moon settings", () => {
  it("defaults: LRO surface, near side, photo at 60 % so the moon shows around it", () => {
    expect(DEFAULTS.moonSurface).toBe("lro");
    expect(DEFAULTS.moonLongitude).toBe(0);
    expect(DEFAULTS.imageScale).toBe(60);
    expect(MOON_SURFACES).toEqual(["lro", "shaded"]);
    expect(MOON_SURFACE_LABELS).toEqual({ lro: "True to life (NASA LRO)", shaded: "Shaded craters" });
    expect(NUMERIC.moonLongitude).toMatchObject({ min: -180, max: 180, step: 1 });
  });

  it("formats the moon side", () => {
    expect(formatMoonLongitude(0)).toBe("Near side");
    expect(formatMoonLongitude(180)).toBe("Far side");
    expect(formatMoonLongitude(-180)).toBe("Far side");
    expect(formatMoonLongitude(30)).toBe("30° E");
    expect(formatMoonLongitude(-45)).toBe("45° W");
    expect(NUMERIC.moonLongitude.format(12)).toBe("12° E");
  });

  it("sanitises the surface and wraps + snaps the longitude", () => {
    expect(sanitizeSettings({ moonSurface: "shaded" }).moonSurface).toBe("shaded");
    expect(sanitizeSettings({ moonSurface: "cheese" }).moonSurface).toBe("lro");
    expect(sanitizeSettings({ moonLongitude: 45.4 }).moonLongitude).toBe(45);
    expect(sanitizeSettings({ moonLongitude: 190 }).moonLongitude).toBe(-170);
    expect(sanitizeSettings({ moonLongitude: -200 }).moonLongitude).toBe(160);
    expect(sanitizeSettings({ moonLongitude: 540 }).moonLongitude).toBe(180);
    expect(sanitizeSettings({ moonLongitude: "abc" }).moonLongitude).toBe(0);
  });

  it("keeps v1 prototype files loading, with the new moon settings at their defaults", () => {
    const v1 = JSON.stringify({ shape: "crescent", imageScale: 100, moonBg: false, rotation: 270, format: "ascii" });
    const s = parseProjectFile(v1);
    expect(s).toMatchObject({ shape: "crescent", imageScale: 100, moonBackground: false, rotation: -90, format: "stl-ascii" });
    expect(s.moonSurface).toBe("lro");
    expect(s.moonLongitude).toBe(0);
  });
});
