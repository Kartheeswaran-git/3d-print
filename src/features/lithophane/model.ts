import type { CoverageMask, FlatShape, ScalarField, ShapeKind, ShapeParams, ThicknessMapping } from "@/lib/geometry/types";
import type { Domain } from "@/lib/image";
import type { FlatJob, MeshJob, SphereJob } from "@/lib/worker/protocol";
import { safeFileName } from "@/lib/utils";
import { effectiveMaxThickness, type LithophaneSettings } from "./settings";

/**
 * Pure helpers that turn lithophane settings into mesh jobs, camera keys and labels.
 * Everything here is DOM-free so it can be unit-tested.
 */

export const SHAPE_LABELS: Record<ShapeKind, string> = {
  sphere: "Sphere",
  crescent: "Crescent",
  circle: "Circle",
  heart: "Heart",
  rounded: "Rounded",
  rectangle: "Rectangle",
  square: "Square",
  custom: "Custom",
};

type SizeSettings = Pick<LithophaneSettings, "shape" | "width" | "height" | "sphereDiameter">;
type WallSettings = Pick<LithophaneSettings, "shape" | "base" | "minThickness" | "maxThickness">;

export function thicknessMapping(
  s: Pick<LithophaneSettings, "minThickness" | "maxThickness" | "thicknessGamma">,
): ThicknessMapping {
  return { minThickness: s.minThickness, maxThickness: effectiveMaxThickness(s), gamma: s.thicknessGamma };
}

/** Whole-wall thickness range (flat: back layer + relief), matching the mesh `thickness` attribute. */
export function wallRange(s: WallSettings): { min: number; max: number } {
  const offset = s.shape === "sphere" ? 0 : s.base;
  return { min: offset + s.minThickness, max: offset + effectiveMaxThickness(s) };
}

/** Shape parameters for the flat builders; the custom mask and threshold are shared by preview and export (FIXES G3). */
export function shapeParams(
  shape: FlatShape,
  s: Pick<
    LithophaneSettings,
    "crescent" | "outerRadius" | "innerRadius" | "moonOffsetX" | "moonOffsetY" | "moonRotation" | "maskThreshold"
  >,
  mask: CoverageMask | null,
): ShapeParams {
  return {
    shape,
    crescent: s.crescent,
    outerRadius: s.outerRadius,
    innerRadius: s.innerRadius,
    offsetX: s.moonOffsetX,
    offsetY: s.moonOffsetY,
    rotationDeg: s.moonRotation,
    mask: shape === "custom" ? mask : null,
    maskThreshold: s.maskThreshold,
  };
}

/** Camera framing key (FIXES L2): changes only with the shape kind or the physical size. */
export function fitKeyFor(s: SizeSettings): string {
  return s.shape === "sphere" ? `sphere:${s.sphereDiameter}` : `flat:${s.width}×${s.height}`;
}

const mm = (n: number) => String(Math.round(n));

/** Form section summary, e.g. "Sphere · Ø 120 mm" or "Crescent · 100 × 100 mm". */
export function formSummary(s: SizeSettings): string {
  const label = SHAPE_LABELS[s.shape];
  return s.shape === "sphere" ? `${label} · Ø ${mm(s.sphereDiameter)} mm` : `${label} · ${mm(s.width)} × ${mm(s.height)} mm`;
}

/** Stage chip, e.g. "Sphere · Ø 120 mm" or "Crescent · 100 × 100 × 3.8 mm" (depth = back layer + thickest wall). */
export function stageSizeLabel(s: SizeSettings & WallSettings): string {
  if (s.shape === "sphere") return formSummary(s);
  return `${SHAPE_LABELS[s.shape]} · ${exportSizeLabel(s)}`;
}

/** Printed size: outer diameter for the sphere ("Ø 126 mm"), W × H × depth for flat pieces. */
export function exportSizeLabel(s: SizeSettings & WallSettings): string {
  const wall = wallRange(s).max;
  if (s.shape === "sphere") return `Ø ${mm(s.sphereDiameter + 2 * wall)} mm`;
  return `${mm(s.width)} × ${mm(s.height)} × ${wall.toFixed(1)} mm`;
}

/** Mesh job for the current settings. `luminance` must be sampled on the matching preview/export grid. */
export function buildMeshJob(s: PreviewSettings, luminance: ScalarField, mask: CoverageMask | null): MeshJob {
  const mapping = thicknessMapping(s);
  if (s.shape === "sphere") {
    const job: SphereJob = {
      kind: "sphere",
      // renderGrid samples column c at θ = 360°·(c/C − ½), exactly where buildSphereMesh puts it:
      // column C/2 faces the front (+Z), so the field goes to the builder unchanged.
      luminance,
      mapping,
      diameterMm: s.sphereDiameter,
      openingDeg: Math.max(1, s.sphereOpening),
    };
    return job;
  }
  const job: FlatJob = {
    kind: "flat",
    luminance,
    mapping,
    widthMm: s.width,
    heightMm: s.height,
    baseMm: s.base,
    shape: shapeParams(s.shape, s, mask),
  };
  
  if (s.frameStyle !== "none") {
    job.frame = {
      style: s.frameStyle,
      depthMm: s.frameDepth,
      widthMm: s.frameWidth,
      overhangAngle: s.frameOverhang,
    };
  }
  
  return job;
}

/** Projection domain for the composed image: the flat piece (with its shape test) or the sphere's printable band. */
export function domainFor(
  s: Pick<
    LithophaneSettings,
    | "shape"
    | "width"
    | "height"
    | "sphereOpening"
    | "crescent"
    | "outerRadius"
    | "innerRadius"
    | "moonOffsetX"
    | "moonOffsetY"
    | "moonRotation"
    | "maskThreshold"
  >,
  mask: CoverageMask | null,
): Domain {
  if (s.shape === "sphere") return { kind: "sphere", openingDeg: Math.max(1, s.sphereOpening) };
  return { kind: "flat", widthMm: s.width, heightMm: s.height, shape: shapeParams(s.shape, s, mask) };
}

/** Settings that change the mesh or the composed image (viewer toggles and the file format don't). */
export type PreviewSettings = Omit<LithophaneSettings, "wireframe" | "backlight" | "format" | "lockRatio">;

/** Name without extension (also the STL solid name), e.g. "holiday-2024_crescent_lithophane" (FIXES L19). */
export function exportBaseName(photoName: string | null, shape: ShapeKind): string {
  const base = photoName ? safeFileName(photoName, "photo") : "moon";
  return `${base}_${shape}_lithophane`;
}

/** Download name, e.g. "holiday-2024_crescent_lithophane.stl" or "moon_sphere_lithophane.stl". */
export function exportFileName(photoName: string | null, shape: ShapeKind, extension = "stl"): string {
  return `${exportBaseName(photoName, shape)}.${extension}`;
}
