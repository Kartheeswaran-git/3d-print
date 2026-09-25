import type { CoverageMask } from "@/lib/geometry/types";
import { formatBytes } from "@/lib/utils";
import { createCanvas, get2d } from "./canvas";
import type { PhotoPixels } from "./project";

/** A decoded photo, EXIF-corrected and downsized once to a working copy. */
export interface SourceImage {
  /** Working copy (longest side ≤ WORKING_MAX_SIDE). */
  canvas: HTMLCanvasElement;
  width: number;
  height: number;
  /** Size of the file as decoded (after EXIF orientation). */
  originalWidth: number;
  originalHeight: number;
  name: string;
}

/**
 * `accept` strings for photo / mask pickers. Extensions are listed too, because drag-dropped
 * files (and some OS pickers) report an empty MIME type (FIXES L16).
 */
export const PHOTO_ACCEPT = "image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp";
export const MASK_ACCEPT = "image/svg+xml,image/png,.svg,.png";
export const MAX_PHOTO_BYTES = 25 * 1024 * 1024;
export const MAX_PHOTO_SIDE = 12000;
export const WORKING_MAX_SIDE = 2400;

const MAX_MASK_BYTES = 10 * 1024 * 1024;
/** Draw size for SVG masks that have no intrinsic width/height (FIXES L15). */
const SVG_FALLBACK_SIZE = 1024;

/** True when the file matches any MIME type (`image/png`, `image/*`) or extension (`.png`) in `accept`. */
function matchesAccept(file: File, accept: string): boolean {
  const type = file.type.toLowerCase();
  const name = file.name.toLowerCase();
  return accept
    .split(",")
    .map((token) => token.trim().toLowerCase())
    .filter(Boolean)
    .some((token) => {
      if (token.startsWith(".")) return name.endsWith(token);
      if (token.endsWith("/*")) return type.startsWith(token.slice(0, -1));
      return type === token;
    });
}

function isHeic(file: File): boolean {
  return /image\/hei[cf]/i.test(file.type) || /\.hei[cf]$/i.test(file.name);
}

interface Decoded {
  image: CanvasImageSource;
  width: number;
  height: number;
  release: () => void;
}

function loadImageElement(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.decoding = "async";
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("decode failed"));
    img.src = src;
  });
}

/** Decode with EXIF orientation applied (FIXES L14): ImageBitmap first, <img> as the fallback. */
async function decodeRaster(file: Blob): Promise<Decoded> {
  if (typeof createImageBitmap === "function") {
    try {
      const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
      return { image: bitmap, width: bitmap.width, height: bitmap.height, release: () => bitmap.close() };
    } catch {
      // Unsupported option or decoder — fall through to <img>, which also honours EXIF orientation.
    }
  }
  const url = URL.createObjectURL(file);
  try {
    const img = await loadImageElement(url);
    return { image: img, width: img.naturalWidth, height: img.naturalHeight, release: () => URL.revokeObjectURL(url) };
  } catch (error) {
    URL.revokeObjectURL(url);
    throw error;
  }
}

/**
 * Resample `src` into a new canvas of `tw × th`, halving in steps first so large reductions
 * stay smooth in browsers whose single-step downscale aliases.
 */
function resample(src: CanvasImageSource, sw: number, sh: number, tw: number, th: number): HTMLCanvasElement {
  let current: CanvasImageSource = src;
  let cw = sw;
  let ch = sh;
  while (cw >= tw * 2 && ch >= th * 2) {
    const nw = Math.max(tw, Math.round(cw / 2));
    const nh = Math.max(th, Math.round(ch / 2));
    const step = createCanvas(nw, nh);
    const sctx = get2d(step);
    sctx.imageSmoothingEnabled = true;
    sctx.imageSmoothingQuality = "high";
    sctx.drawImage(current, 0, 0, nw, nh);
    if (current instanceof HTMLCanvasElement && current !== src) current.width = current.height = 1;
    current = step;
    cw = nw;
    ch = nh;
  }
  const out = createCanvas(tw, th);
  const ctx = get2d(out);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(current, 0, 0, tw, th);
  if (current instanceof HTMLCanvasElement && current !== src) current.width = current.height = 1;
  return out;
}

/**
 * Validate and decode a photo, then keep a working copy whose longest side is ≤ 2400 px
 * (FIXES L13). Throws an Error whose message can be shown to the user as-is.
 */
export async function loadPhoto(file: File): Promise<SourceImage> {
  if (!matchesAccept(file, PHOTO_ACCEPT)) {
    if (isHeic(file)) {
      throw new Error("HEIC photos can't be read here. Save it as JPG (or set your camera to “Most compatible”) and try again.");
    }
    throw new Error("That file isn't a JPG, PNG or WebP image. Choose a photo in one of those formats.");
  }
  if (file.size === 0) throw new Error("This file is empty. Choose another photo.");
  if (file.size > MAX_PHOTO_BYTES) {
    throw new Error(`This photo is ${formatBytes(file.size)}. Choose one under 25 MB, or export a smaller copy.`);
  }

  let decoded: Decoded;
  try {
    decoded = await decodeRaster(file);
  } catch {
    throw new Error("This image couldn't be read. It may be damaged — try saving it again as JPG or PNG.");
  }

  try {
    const { width: ow, height: oh } = decoded;
    if (!(ow > 0) || !(oh > 0)) {
      throw new Error("This image couldn't be read. It may be damaged — try saving it again as JPG or PNG.");
    }
    if (ow > MAX_PHOTO_SIDE || oh > MAX_PHOTO_SIDE) {
      throw new Error(`This photo is ${ow.toLocaleString("en")} × ${oh.toLocaleString("en")} px. Use one no larger than 12,000 px on each side.`);
    }
    const scale = Math.min(1, WORKING_MAX_SIDE / Math.max(ow, oh));
    const width = Math.max(1, Math.round(ow * scale));
    const height = Math.max(1, Math.round(oh * scale));
    const canvas = resample(decoded.image, ow, oh, width, height);
    return { canvas, width, height, originalWidth: ow, originalHeight: oh, name: file.name };
  } finally {
    decoded.release();
  }
}

const pixelCache = new WeakMap<SourceImage, PhotoPixels>();

/**
 * RGBA pixels of a photo's working copy, read once per SourceImage and cached (the projection samples
 * these directly). Treat the returned data as read-only: it is shared by every caller.
 */
export function getPhotoPixels(source: SourceImage): PhotoPixels {
  const cached = pixelCache.get(source);
  if (cached) return cached;
  const { width, height } = source.canvas;
  const pixels: PhotoPixels = { width, height, data: get2d(source.canvas, true).getImageData(0, 0, width, height).data };
  pixelCache.set(source, pixels);
  return pixels;
}

/** Give an SVG without an absolute intrinsic size explicit width/height so every browser rasterises it. */
function withIntrinsicSize(markup: string): string {
  const doc = new DOMParser().parseFromString(markup, "image/svg+xml");
  const root = doc.documentElement;
  if (doc.getElementsByTagName("parsererror").length > 0 || root.localName !== "svg") {
    throw new Error("This SVG couldn't be read. Export it again from your design tool and try once more.");
  }
  const isAbsolute = (v: string | null) => v !== null && /^\s*[\d.]+\s*(px|pt|pc|mm|cm|in)?\s*$/i.test(v) && parseFloat(v) > 0;
  if (isAbsolute(root.getAttribute("width")) && isAbsolute(root.getAttribute("height"))) return markup;

  const box = (root.getAttribute("viewBox") ?? "").trim().split(/[\s,]+/).map(Number);
  const vbW = box.length === 4 ? box[2] : NaN;
  const vbH = box.length === 4 ? box[3] : NaN;
  let w = SVG_FALLBACK_SIZE;
  let h = SVG_FALLBACK_SIZE;
  if (vbW > 0 && vbH > 0) {
    if (vbW >= vbH) h = Math.max(1, Math.round((SVG_FALLBACK_SIZE * vbH) / vbW));
    else w = Math.max(1, Math.round((SVG_FALLBACK_SIZE * vbW) / vbH));
  }
  root.setAttribute("width", String(w));
  root.setAttribute("height", String(h));
  return new XMLSerializer().serializeToString(doc);
}

async function decodeSvg(file: File): Promise<Decoded> {
  const markup = withIntrinsicSize(await file.text());
  const url = URL.createObjectURL(new Blob([markup], { type: "image/svg+xml" }));
  try {
    const img = await loadImageElement(url);
    // Some engines still report 0 for SVGs; fall back to a fixed draw size (FIXES L15).
    const width = img.naturalWidth || SVG_FALLBACK_SIZE;
    const height = img.naturalHeight || SVG_FALLBACK_SIZE;
    return { image: img, width, height, release: () => URL.revokeObjectURL(url) };
  } catch {
    URL.revokeObjectURL(url);
    throw new Error("This SVG couldn't be drawn. Remove external images or fonts from it, or export it as PNG.");
  }
}

/**
 * Load a custom-shape mask as a `size × size` coverage grid stretched over the whole piece.
 * coverage = alpha × luminance (white = solid). Black-on-transparent icons, whose luminance
 * would give an empty mask, fall back to alpha alone.
 */
export async function loadMaskFile(
  file: File,
  size = 512,
): Promise<{ mask: CoverageMask; preview: HTMLCanvasElement; name: string }> {
  if (!matchesAccept(file, MASK_ACCEPT)) throw new Error("Choose an SVG or PNG mask. White areas become the lamp.");
  if (file.size === 0) throw new Error("This file is empty. Choose another mask.");
  if (file.size > MAX_MASK_BYTES) {
    throw new Error(`This mask is ${formatBytes(file.size)}. Use one under 10 MB — simplify the SVG or export a smaller PNG.`);
  }
  const n = Math.max(16, Math.min(2048, Math.round(size)));
  const isSvg = file.type === "image/svg+xml" || /\.svg$/i.test(file.name);

  let decoded: Decoded;
  if (isSvg) {
    decoded = await decodeSvg(file);
  } else {
    try {
      decoded = await decodeRaster(file);
    } catch {
      throw new Error("This mask couldn't be read. It may be damaged — try exporting it again as PNG.");
    }
  }

  let pixels: Uint8ClampedArray;
  try {
    let canvas: HTMLCanvasElement;
    if (isSvg) {
      // Vector: rasterise straight at the target size for crisp edges.
      canvas = createCanvas(n, n);
      const ctx = get2d(canvas, true);
      ctx.drawImage(decoded.image, 0, 0, n, n);
    } else {
      canvas = resample(decoded.image, decoded.width, decoded.height, n, n);
    }
    pixels = get2d(canvas, true).getImageData(0, 0, n, n).data;
  } finally {
    decoded.release();
  }

  const count = n * n;
  const values = new Float32Array(count);
  let maxCoverage = 0;
  let opaque = 0;
  let clear = 0;
  for (let i = 0, p = 0; i < count; i++, p += 4) {
    const alpha = pixels[p + 3] / 255;
    const lum = (0.2126 * pixels[p] + 0.7152 * pixels[p + 1] + 0.0722 * pixels[p + 2]) / 255;
    const c = alpha * lum;
    values[i] = c;
    if (c > maxCoverage) maxCoverage = c;
    if (alpha > 0.5) opaque++;
    else clear++;
  }
  if (maxCoverage < 0.05 && opaque > 0 && clear > 0) {
    // Dark shape on a transparent background: the silhouette is what the user drew.
    for (let i = 0, p = 3; i < count; i++, p += 4) values[i] = pixels[p] / 255;
    maxCoverage = 1;
  }
  if (maxCoverage < 0.05) {
    throw new Error("This mask has no white or opaque areas, so there's nothing to print. White areas become the lamp.");
  }

  const preview = createCanvas(n, n);
  const pctx = get2d(preview);
  const image = pctx.createImageData(n, n);
  for (let i = 0, p = 0; i < count; i++, p += 4) {
    const shade = Math.round(values[i] * 255);
    image.data[p] = shade;
    image.data[p + 1] = shade;
    image.data[p + 2] = shade;
    image.data[p + 3] = 255;
  }
  pctx.putImageData(image, 0, 0);

  return { mask: { width: n, height: n, values }, preview, name: file.name };
}
