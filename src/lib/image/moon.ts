/**
 * Lunar surface maps. The maps are equirectangular: longitude −180°…+180° left → right (0° = the
 * centre of the near side) and latitude +90° (top row) … −90° (bottom row), pixel-is-area.
 * Sampling is pure (runs in Node, a worker or the page); only `loadMoonMap` touches the browser.
 */

export type MoonSurface = "lro" | "shaded";

/** Single-channel equirectangular map, row-major, row 0 = latitude +90°. */
export interface GrayMap {
  width: number;
  height: number;
  data: Uint8Array;
}

/** Texture per surface and quality. The shaded relief map has a single size. */
export const MOON_MAP_URLS: Record<MoonSurface, Record<"preview" | "export", string>> = {
  lro: { preview: "/moon/lro-albedo-2k.jpg", export: "/moon/lro-albedo-4k.jpg" },
  shaded: { preview: "/moon/shaded-relief-1k.jpg", export: "/moon/shaded-relief-1k.jpg" },
};

/** Smallest mip level kept (width in texels). */
const MIN_LEVEL_WIDTH = 8;

/**
 * Bilinear sample of `map` at a selenographic position, 0..1. Longitude wraps (any value is
 * accepted), latitude clamps to the first/last row. Pixel centres sit at
 * lon = −180 + 360·(i + ½)/width and lat = 90 − 180·(j + ½)/height.
 */
export function sampleMoon(map: GrayMap, lonDeg: number, latDeg: number): number {
  const w = map.width;
  const h = map.height;
  const data = map.data;
  let fx = ((lonDeg + 180) / 360) * w - 0.5;
  fx -= Math.floor(fx / w) * w;
  if (!(fx >= 0 && fx < w)) fx = 0; // NaN / Infinity guard
  const x0 = Math.floor(fx);
  const tx = fx - x0;
  const x1 = x0 + 1 === w ? 0 : x0 + 1;

  let fy = ((90 - latDeg) / 180) * h - 0.5;
  if (!(fy > 0)) fy = 0;
  else if (fy > h - 1) fy = h - 1;
  const y0 = Math.floor(fy);
  const ty = fy - y0;
  const y1 = y0 + 1 < h ? y0 + 1 : y0;

  const r0 = y0 * w;
  const r1 = y1 * w;
  const top = data[r0 + x0] + (data[r0 + x1] - data[r0 + x0]) * tx;
  const bottom = data[r1 + x0] + (data[r1 + x1] - data[r1 + x0]) * tx;
  return (top + (bottom - top) * ty) / 255;
}

/** Rec. 709 luma of an RGBA buffer as a GrayMap (alpha ignored; the maps are opaque). */
export function grayMapFromRgba(rgba: Uint8ClampedArray | Uint8Array, width: number, height: number): GrayMap {
  const count = width * height;
  if (!(width >= 1) || !(height >= 1) || rgba.length < count * 4) {
    throw new Error("The moon map pixels don't match its size.");
  }
  const data = new Uint8Array(count);
  for (let i = 0, p = 0; i < count; i++, p += 4) {
    data[i] = Math.round(0.2126 * rgba[p] + 0.7152 * rgba[p + 1] + 0.0722 * rgba[p + 2]);
  }
  return { width, height, data };
}

/** 2×2 box downsample (edge texels repeat for odd sizes). */
function halveGray(map: GrayMap): GrayMap {
  const { width: w, height: h, data } = map;
  const nw = Math.max(1, Math.ceil(w / 2));
  const nh = Math.max(1, Math.ceil(h / 2));
  const out = new Uint8Array(nw * nh);
  for (let y = 0; y < nh; y++) {
    const r0 = Math.min(h - 1, y * 2) * w;
    const r1 = Math.min(h - 1, y * 2 + 1) * w;
    for (let x = 0; x < nw; x++) {
      const c0 = Math.min(w - 1, x * 2);
      const c1 = Math.min(w - 1, x * 2 + 1);
      out[y * nw + x] = (data[r0 + c0] + data[r0 + c1] + data[r1 + c0] + data[r1 + c1] + 2) >> 2;
    }
  }
  return { width: nw, height: nh, data: out };
}

const mipCache = new WeakMap<GrayMap, GrayMap[]>();

/**
 * Mip chain of a map: level 0 is the map itself, each further level halves both sides (2×2 box
 * filter) down to about 8 texels wide. Built once per map and cached. Sampling a coarser level when
 * the samples are far apart keeps craters from aliasing into noise.
 */
export function moonMipLevels(map: GrayMap): readonly GrayMap[] {
  const cached = mipCache.get(map);
  if (cached) return cached;
  const levels: GrayMap[] = [map];
  let current = map;
  while (current.width > MIN_LEVEL_WIDTH && current.height > 1) {
    current = halveGray(current);
    levels.push(current);
  }
  mipCache.set(map, levels);
  return levels;
}

interface DecodedImage {
  source: CanvasImageSource;
  width: number;
  height: number;
  release: () => void;
}

/**
 * Decode with colour management to sRGB, like photos: the LRO files carry a gamma-1.8 "Generic Gray"
 * profile, so raw file values would print the maria too dark. ImageBitmap first, <img> as the fallback.
 */
async function decodeImage(blob: Blob): Promise<DecodedImage> {
  if (typeof createImageBitmap === "function") {
    try {
      const bitmap = await createImageBitmap(blob);
      return { source: bitmap, width: bitmap.width, height: bitmap.height, release: () => bitmap.close() };
    } catch {
      // Decoder unavailable here — fall through to <img>.
    }
  }
  if (typeof Image === "undefined") throw new Error("no image decoder");
  const url = URL.createObjectURL(blob);
  try {
    const img = new Image();
    img.decoding = "async";
    img.src = url;
    await img.decode();
    return { source: img, width: img.naturalWidth, height: img.naturalHeight, release: () => {} };
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Draw the image and read its pixels (OffscreenCanvas where it has a 2D context, else a DOM canvas). */
function readPixels(image: DecodedImage): Uint8ClampedArray {
  const { source, width, height } = image;
  const offscreen =
    typeof OffscreenCanvas === "function"
      ? new OffscreenCanvas(width, height).getContext("2d", { willReadFrequently: true })
      : null;
  if (offscreen) {
    offscreen.drawImage(source, 0, 0);
    return offscreen.getImageData(0, 0, width, height).data;
  }
  if (typeof document === "undefined") throw new Error("no 2d context");
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("no 2d context");
  ctx.drawImage(source, 0, 0);
  const data = ctx.getImageData(0, 0, width, height).data;
  canvas.width = canvas.height = 1;
  return data;
}

async function decodeToGray(blob: Blob): Promise<GrayMap> {
  const image = await decodeImage(blob);
  try {
    if (!(image.width > 0) || !(image.height > 0)) throw new Error("empty image");
    return grayMapFromRgba(readPixels(image), image.width, image.height);
  } finally {
    image.release();
  }
}

const loadCache = new Map<string, Promise<GrayMap>>();

/**
 * Load a lunar surface map (browser or worker). "preview" is the 2k LRO map, "export" the 4k one;
 * the shaded relief map has one size. The promise is cached per file; a failure is forgotten so a
 * retry can succeed. Rejects with a message that can be shown to the user.
 */
export function loadMoonMap(surface: MoonSurface, quality: "preview" | "export"): Promise<GrayMap> {
  const url = (MOON_MAP_URLS[surface] ?? MOON_MAP_URLS.lro)[quality];
  const cached = loadCache.get(url);
  if (cached) return cached;
  const promise = (async () => {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return decodeToGray(await response.blob());
  })().catch(() => {
    loadCache.delete(url);
    throw new Error("The moon surface couldn't be loaded. Check your connection and try again.");
  });
  loadCache.set(url, promise);
  return promise;
}
