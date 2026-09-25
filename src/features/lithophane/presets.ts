import { computeCropRect } from "@/lib/image/compose";
import { NUMERIC, type LithophaneSettings } from "./settings";

/**
 * One-click photo placements and starter designs. Pure: they only read settings and the photo's
 * size, and return patches for the settings store (apply each with one `setMany`, i.e. one undo step).
 *
 * Placement model (FEATURE.md §1):
 * - Flat: the photo is `imageScale` % of the piece width wide, its height follows the crop aspect,
 *   centred + offset by imageX/imageY and rotated by `rotation`.
 * - Sphere: an orthographic decal on the front; `imageScale / 100` is its half-width in sphere radii
 *   (100 % spans the whole front view) and cropRatio "model" means 1:1.
 */

export type PlacementPreset = "center" | "fit" | "fill" | "badge";

export interface PlacementPresetInfo {
  id: PlacementPreset;
  label: string;
  /** Tooltip / accessible description. */
  description: string;
  /** False when the preset only makes sense with a photo loaded. */
  worksWithoutPhoto: boolean;
}

/** The chips shown in the Placement section and the layout editor toolbar, in display order. */
export const PLACEMENT_PRESETS: readonly PlacementPresetInfo[] = [
  { id: "center", label: "Center", description: "Move the photo to the middle and straighten it.", worksWithoutPhoto: true },
  { id: "fit", label: "Fit", description: "Show the whole photo on the piece.", worksWithoutPhoto: false },
  { id: "fill", label: "Fill", description: "Cover the whole piece with the photo.", worksWithoutPhoto: false },
  { id: "badge", label: "Badge", description: "A small photo in the middle.", worksWithoutPhoto: false },
];

/** The photo as placement needs it: its aspect (w / h), its pixel size, or null when none is loaded. */
export type PhotoSize = number | { width: number; height: number } | null;

/** Sphere decals are fitted so their corners stay within this fraction of the front disc. */
export const SPHERE_FIT_RADIUS = 0.92;
/** Minimum edge blend (%) after "Fill" on the sphere, so the photo's edges melt into the moon. */
export const SPHERE_FILL_MIN_EDGE_BLEND = 20;
/** Photo size (%) of the "Badge" preset. */
export const BADGE_IMAGE_SCALE = 35;

/** Aspect (w / h) that cropRatio "model" crops to: the piece for flat shapes, 1:1 for the sphere decal. */
export function placementModelAspect(s: Pick<LithophaneSettings, "shape" | "width" | "height">): number {
  return s.shape === "sphere" ? 1 : s.width / s.height;
}

/**
 * Aspect (w / h) of the placed photo, i.e. of its crop rectangle (`computeCropRect`). Without a photo
 * it is still known for fixed ratios and "model"; for "original" it is null.
 */
export function placedPhotoAspect(s: LithophaneSettings, photo: PhotoSize): number | null {
  let width = 1;
  let height = 1;
  if (photo === null) {
    if (s.cropRatio === "original") return null;
  } else if (typeof photo === "number") {
    width = photo;
  } else {
    width = photo.width;
    height = photo.height;
  }
  const rect = computeCropRect(width, height, s, placementModelAspect(s));
  const aspect = rect.w / rect.h;
  return rect.w > 0 && rect.h > 0 && Number.isFinite(aspect) ? aspect : null;
}

/** imageScale (%) for a size factor, rounded towards "still fits" (down) or "still covers" (up), within range. */
function toImageScale(factor: number, round: "down" | "up"): number {
  const { min, max } = NUMERIC.imageScale;
  const percent = factor * 100;
  // The epsilon keeps exact fits (e.g. 1.0000000002) from rounding past their integer.
  const value = round === "down" ? Math.floor(percent + 1e-6) : Math.ceil(percent - 1e-6);
  return Math.min(max, Math.max(min, value));
}

/**
 * Flat size factor k (photo width = k × piece width) for a crop of `aspect` rotated by `rotation`:
 * "fit" → the rotated photo's bounding box lies inside W × H (largest k);
 * "fill" → the rotated photo covers W × H (smallest k).
 */
function flatFactor(mode: "fit" | "fill", aspect: number, s: LithophaneSettings): number {
  const theta = (s.rotation * Math.PI) / 180;
  const c = Math.abs(Math.cos(theta));
  const sn = Math.abs(Math.sin(theta));
  const r = s.height / s.width;
  if (mode === "fit") return Math.min(1 / (c + sn / aspect), r / (sn + c / aspect));
  return Math.max(c + r * sn, aspect * (sn + r * c));
}

/**
 * Settings patch for a placement preset. Presets centre the photo; "center" also straightens it,
 * the others keep its rotation. Without a known photo aspect "fit" (and flat "fill") only centre it.
 */
export function placementPreset(p: PlacementPreset, s: LithophaneSettings, photoAspect: PhotoSize): Partial<LithophaneSettings> {
  const centred = { imageX: 0, imageY: 0 };
  if (p === "center") return { ...centred, rotation: 0 };
  if (p === "badge") return { ...centred, imageScale: BADGE_IMAGE_SCALE };

  const sphere = s.shape === "sphere";
  if (sphere && p === "fill") {
    return {
      ...centred,
      imageScale: toImageScale(SPHERE_FIT_RADIUS, "down"),
      edgeBlend: Math.max(s.edgeBlend, SPHERE_FILL_MIN_EDGE_BLEND),
    };
  }
  const aspect = placedPhotoAspect(s, photoAspect);
  if (aspect === null) return centred;
  if (sphere) {
    // Corners at (±hw, ±hh) with hh = hw / aspect: hw² + hh² ≤ R².
    return { ...centred, imageScale: toImageScale(SPHERE_FIT_RADIUS / Math.hypot(1, 1 / aspect), "down") };
  }
  return { ...centred, imageScale: toImageScale(flatFactor(p, aspect, s), p === "fit" ? "down" : "up") };
}

export interface StarterDesign {
  id: string;
  label: string;
  description: string;
  settings: Partial<LithophaneSettings>;
  /** Placement preset applied on top of `settings` (with the loaded photo) — see `starterDesignPatch`. */
  placement?: PlacementPreset;
}

/** "Start from…" designs. Every value is already valid, so `sanitizeSettings` keeps them unchanged. */
export const STARTER_DESIGNS: StarterDesign[] = [
  {
    id: "classic-moon",
    label: "Classic moon",
    description: "Ø 120 mm moon lamp showing the real near side of the moon. No photo needed.",
    settings: { shape: "sphere", sphereDiameter: 120, moonBackground: true, moonSurface: "lro", moonLongitude: 0 },
  },
  {
    id: "photo-moon",
    label: "Photo moon",
    description: "Ø 140 mm moon lamp with your photo on the front, blended into the craters.",
    settings: { shape: "sphere", sphereDiameter: 140, moonBackground: true, imageScale: 60, imageX: 0, imageY: 0, edgeBlend: 30 },
  },
  {
    id: "crescent-keepsake",
    label: "Crescent keepsake",
    description: "100 × 100 mm crescent with the whole photo fitted inside.",
    settings: { shape: "crescent", width: 100, height: 100 },
    placement: "fit",
  },
  {
    id: "heart-frame",
    label: "Heart frame",
    description: "110 × 100 mm heart-shaped frame for a portrait.",
    settings: { shape: "heart", width: 110, height: 100 },
  },
  {
    id: "photo-panel",
    label: "Photo panel",
    description: "150 × 100 mm flat panel filled edge to edge with your photo, no moon.",
    settings: { shape: "rectangle", width: 150, height: 100, moonBackground: false, cropRatio: "model" },
    placement: "fill",
  },
];

/**
 * Everything a starter design changes, including its placement preset worked out for the new
 * shape and the loaded photo. Apply it with one `setMany` so it is a single undo step.
 */
export function starterDesignPatch(design: StarterDesign, current: LithophaneSettings, photo: PhotoSize): Partial<LithophaneSettings> {
  if (!design.placement) return { ...design.settings };
  const next = { ...current, ...design.settings };
  return { ...design.settings, ...placementPreset(design.placement, next, photo) };
}
