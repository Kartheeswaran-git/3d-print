import type { LithophaneSettings } from "@/features/lithophane/settings";

/*
 * Crop maths (PURE — safe without a DOM). The composition itself is sampled per point by
 * makeSampler / renderGrid in ./project.
 */

/** Placement + crop settings that decide how the photo lands on the model. */
export type CompositionSettings = Pick<
  LithophaneSettings,
  "imageScale" | "imageX" | "imageY" | "rotation" | "edgeBlend" | "moonBackground" | "cropRatio" | "cropScale" | "cropX" | "cropY"
>;

const clampNum = (n: number, min: number, max: number) => (Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : min);

/** Aspect (w / h) requested by a crop ratio, or null when it isn't usable. */
function cropAspect(ratio: CompositionSettings["cropRatio"], sourceAspect: number, modelAspect: number): number {
  let aspect: number;
  if (ratio === "original") aspect = sourceAspect;
  else if (ratio === "model") aspect = modelAspect;
  else {
    const [a, b] = ratio.split(":").map(Number);
    aspect = a / b;
  }
  return Number.isFinite(aspect) && aspect > 0 ? aspect : sourceAspect;
}

/**
 * Source rectangle (in source pixels) to sample from. cropRatio: "original" → source aspect,
 * "model" → `modelAspect`, "a:b" → a/b. The largest rect of that aspect is scaled by cropScale and
 * offset by cropX/cropY (−1..1) inside the remaining gap. Pure — safe to call without a DOM.
 */
export function computeCropRect(
  srcW: number,
  srcH: number,
  s: CompositionSettings,
  modelAspect: number,
): { x: number; y: number; w: number; h: number } {
  if (!(srcW > 0) || !(srcH > 0)) return { x: 0, y: 0, w: 0, h: 0 };
  const aspect = cropAspect(s.cropRatio, srcW / srcH, modelAspect);
  let w = srcW;
  let h = w / aspect;
  if (h > srcH) {
    h = srcH;
    w = h * aspect;
  }
  const scale = clampNum(s.cropScale, 0.01, 1);
  w *= scale;
  h *= scale;
  const xGap = Math.max(0, srcW - w);
  const yGap = Math.max(0, srcH - h);
  const cx = clampNum(s.cropX, -1, 1);
  const cy = clampNum(s.cropY, -1, 1);
  return { x: xGap / 2 + (cx * xGap) / 2, y: yGap / 2 + (cy * yGap) / 2, w, h };
}
