import type { LithophaneSettings } from "@/features/lithophane/settings";

/**
 * Pure luminance tone pipeline (no DOM). Runs identically for the preview grid and the
 * export grid, so every setting that depends on pixel distances is scaled by the grid width.
 */

export type ToneSettings = Pick<
  LithophaneSettings,
  "brightness" | "contrast" | "gamma" | "blur" | "sharpen" | "autoLevels" | "invert"
>;

/** Grid topology for the neighbourhood steps (blur and sharpen). */
export interface ToneOptions {
  /**
   * Columns wrap around: column 0 and column width − 1 are neighbours (the sphere's 360° longitude grid, so
   * the seam at the back gets no visible edge). Rows always clamp.
   */
  wrapX?: boolean;
}

/** Blur radius is expressed relative to a 160-sample-wide grid (the prototype's preview width). */
const BLUR_REFERENCE_WIDTH = 160;
/** Auto levels maps these percentiles to 0 and 1, so a few outlier pixels don't pin the range. */
const AUTO_LEVELS_LOW = 0.005;
const AUTO_LEVELS_HIGH = 0.995;

const clamp01 = (n: number) => (n < 0 ? 0 : n > 1 ? 1 : n);

/** Rec. 709 luma of an RGBA buffer, 0..1 (alpha is ignored; composites are opaque). */
export function rgbaToLuminance(data: Uint8ClampedArray, width: number, height: number): Float32Array {
  const count = width * height;
  if (data.length < count * 4) throw new Error("Pixel buffer is smaller than width × height.");
  const out = new Float32Array(count);
  for (let i = 0, p = 0; i < count; i++, p += 4) {
    out[i] = (0.2126 * data[p] + 0.7152 * data[p + 1] + 0.0722 * data[p + 2]) / 255;
  }
  return out;
}

/** Normalised 1-D Gaussian kernel (sigma = radiusPx, truncated at 3σ). */
function gaussianKernel(sigma: number): Float32Array {
  const half = Math.max(1, Math.ceil(sigma * 3));
  const kernel = new Float32Array(half * 2 + 1);
  const denom = 2 * sigma * sigma;
  let sum = 0;
  for (let i = -half; i <= half; i++) {
    const w = Math.exp(-(i * i) / denom);
    kernel[i + half] = w;
    sum += w;
  }
  for (let i = 0; i < kernel.length; i++) kernel[i] /= sum;
  return kernel;
}

/** Convolve `line` (length n) into `out` using a padded scratch buffer (edge clamp, or periodic with `wrap`). */
function convolveLine(
  line: Float32Array,
  n: number,
  kernel: Float32Array,
  padded: Float32Array,
  out: Float32Array,
  wrap = false,
) {
  const half = (kernel.length - 1) >> 1;
  const first = line[0];
  const last = line[n - 1];
  for (let i = 0; i < half; i++) {
    // Padding slot i stands for sample i − half, slot half + n + i for sample n + i (the kernel may be wider than n).
    padded[i] = wrap ? line[(((i - half) % n) + n) % n] : first;
    padded[half + n + i] = wrap ? line[i % n] : last;
  }
  padded.set(line.subarray(0, n), half);
  const k = kernel.length;
  for (let i = 0; i < n; i++) {
    let acc = 0;
    for (let j = 0; j < k; j++) acc += padded[i + j] * kernel[j];
    out[i] = acc;
  }
}

/**
 * Separable Gaussian blur with edge clamping (columns wrap with `wrapX`). `radiusPx` is the standard deviation
 * in samples (same meaning as CSS `blur()`). Returns a new array; radius ≤ 0 returns a copy.
 */
export function gaussianBlur(
  values: Float32Array,
  width: number,
  height: number,
  radiusPx: number,
  options: ToneOptions = {},
): Float32Array {
  const out = new Float32Array(values);
  if (!(radiusPx > 0) || width < 1 || height < 1) return out;
  const kernel = gaussianKernel(radiusPx);
  const half = (kernel.length - 1) >> 1;

  // Horizontal pass (in place on `out`, row by row).
  const rowIn = new Float32Array(width);
  const rowOut = new Float32Array(width);
  const rowPad = new Float32Array(width + half * 2);
  for (let y = 0; y < height; y++) {
    const offset = y * width;
    rowIn.set(out.subarray(offset, offset + width));
    convolveLine(rowIn, width, kernel, rowPad, rowOut, options.wrapX);
    out.set(rowOut, offset);
  }

  // Vertical pass.
  const colIn = new Float32Array(height);
  const colOut = new Float32Array(height);
  const colPad = new Float32Array(height + half * 2);
  for (let x = 0; x < width; x++) {
    for (let y = 0; y < height; y++) colIn[y] = out[y * width + x];
    convolveLine(colIn, height, kernel, colPad, colOut);
    for (let y = 0; y < height; y++) out[y * width + x] = colOut[y];
  }
  return out;
}

/** Linear-interpolated percentile of an ascending array. */
function percentile(sorted: Float32Array, p: number): number {
  const pos = p * (sorted.length - 1);
  const lo = Math.floor(pos);
  const hi = Math.min(sorted.length - 1, lo + 1);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

/** Stretch so the 0.5th / 99.5th percentiles map to 0 / 1 (in place). Flat fields are left alone. */
function autoLevelsInPlace(values: Float32Array) {
  if (values.length < 2) return;
  const sorted = new Float32Array(values).sort();
  const low = percentile(sorted, AUTO_LEVELS_LOW);
  const high = percentile(sorted, AUTO_LEVELS_HIGH);
  const range = high - low;
  if (!(range > 1e-4)) return;
  for (let i = 0; i < values.length; i++) values[i] = clamp01((values[i] - low) / range);
}

/** Prototype 4-neighbour unsharp step: l + amount·(4l − left − right − up − down), edge-clamped (or wrapped in x). */
function sharpen(values: Float32Array, width: number, height: number, amount: number, wrapX = false): Float32Array {
  const out = new Float32Array(values.length);
  const lastX = width - 1;
  for (let y = 0; y < height; y++) {
    const row = y * width;
    const up = Math.max(0, y - 1) * width;
    const down = Math.min(height - 1, y + 1) * width;
    for (let x = 0; x < width; x++) {
      const l = values[row + x];
      const left = values[row + (x > 0 ? x - 1 : wrapX ? lastX : 0)];
      const right = values[row + (x < lastX ? x + 1 : wrapX ? 0 : lastX)];
      out[row + x] = clamp01(l + amount * (4 * l - left - right - values[up + x] - values[down + x]));
    }
  }
  return out;
}

/**
 * Apply the tone pipeline to a luminance grid and return a NEW array:
 * blur (σ = blur · width / 160) → auto levels (0.5 / 99.5 percentiles) → sharpen →
 * brightness/contrast `clamp(((l + b/100) − .5) · c + .5)` → gamma `l^(1/g)` → invert.
 * With `wrapX` (the sphere), blur and sharpen treat the first and last columns as neighbours.
 */
export function applyTone(
  lum: Float32Array,
  width: number,
  height: number,
  t: ToneSettings,
  options: ToneOptions = {},
): Float32Array {
  if (lum.length !== width * height) throw new Error("Luminance length doesn't match width × height.");
  let values =
    t.blur > 0
      ? gaussianBlur(lum, width, height, (t.blur * width) / BLUR_REFERENCE_WIDTH, options)
      : new Float32Array(lum);
  if (t.autoLevels) autoLevelsInPlace(values);
  if (t.sharpen > 0) values = sharpen(values, width, height, t.sharpen, options.wrapX);

  const offset = t.brightness / 100;
  const contrast = t.contrast;
  const invGamma = t.gamma > 0 ? 1 / t.gamma : 1;
  const applyGamma = invGamma !== 1;
  for (let i = 0; i < values.length; i++) {
    let l = clamp01((values[i] + offset - 0.5) * contrast + 0.5);
    if (applyGamma) l = Math.pow(l, invGamma);
    values[i] = t.invert ? 1 - l : l;
  }
  return values;
}
