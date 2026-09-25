import { lampToPlacement } from "@/lib/image/project";
import { clamp } from "@/lib/utils";
import { NUMERIC, type LithophaneSettings } from "./settings";

/**
 * "Move photo" on the 3D model (FEATURE.md §3), as pure maths so it can be tested.
 *
 * Surface hits map to placement units the same way the composition reads them:
 * - sphere: θ = atan2(x, z), φ = asin(y / |p|) → lampToPlacement (imageX = θ/180·100, imageY = −φ/90·100);
 * - flat pieces (centred on the origin, +y up): imageX = x / W · 100, imageY = −y / H · 100.
 * A drag moves the photo by how far the grabbed surface point travels, so grabbing it off-centre never
 * makes it jump; the result stays inside the range where the photo actually moves.
 */

type PlaceSettings = Pick<LithophaneSettings, "shape" | "width" | "height" | "sphereOpening">;

/** Surface point in mm, in the mesh's own coordinates. */
export type SurfacePoint = readonly [number, number, number];

export interface PlacementPoint {
  imageX: number;
  imageY: number;
}

export interface PlaceDrag {
  /** Placement the drag has reached (unrounded, clamped). */
  current: PlacementPoint;
  /** Last surface hit, in placement units. */
  last: { x: number; y: number };
}

const RAD = 180 / Math.PI;
/** The sphere decal centre stays this far above the bottom opening and below 80° latitude (see decalCentre). */
const DECAL_OPENING_MARGIN_DEG = 5;
const DECAL_MAX_LAT_DEG = 80;

/** Where a surface point lies in placement units, or null for a degenerate point. */
export function surfaceToPlacement(point: SurfacePoint, s: PlaceSettings): { x: number; y: number } | null {
  const [px, py, pz] = point;
  if (!Number.isFinite(px) || !Number.isFinite(py) || !Number.isFinite(pz)) return null;
  if (s.shape === "sphere") {
    const r = Math.hypot(px, py, pz);
    if (!(r > 0)) return null;
    const p = lampToPlacement(Math.atan2(px, pz) * RAD, Math.asin(clamp(py / r, -1, 1)) * RAD);
    return { x: p.imageX, y: p.imageY };
  }
  if (!(s.width > 0) || !(s.height > 0)) return null;
  return { x: (px / s.width) * 100, y: (-py / s.height) * 100 };
}

/**
 * Placement range in which the photo really moves. Flat: ±100 %. Sphere: imageX ±100 (a full turn), and imageY
 * limited to latitudes the decal centre can reach (80° N down to 5° above the bottom opening).
 */
export function placementBounds(s: PlaceSettings): { x: [number, number]; y: [number, number] } {
  const { min, max } = NUMERIC.imageX;
  if (s.shape !== "sphere") return { x: [min, max], y: [NUMERIC.imageY.min, NUMERIC.imageY.max] };
  const openingDeg = Math.max(1, s.sphereOpening);
  const lowest = Math.max(-DECAL_MAX_LAT_DEG, -(90 - openingDeg - DECAL_OPENING_MARGIN_DEG));
  return {
    x: [min, max],
    // imageY = −φ/90·100, rounded inwards so the snapped value is still inside the reachable band.
    y: [Math.ceil((-DECAL_MAX_LAT_DEG / 90) * 100), Math.floor((-lowest / 90) * 100)],
  };
}

/** Start a drag at a surface hit; null when the hit can't be mapped. */
export function startPlaceDrag(point: SurfacePoint, s: PlaceSettings & PlacementPoint): PlaceDrag | null {
  const hit = surfaceToPlacement(point, s);
  if (!hit) return null;
  return { current: { imageX: s.imageX, imageY: s.imageY }, last: hit };
}

/**
 * Follow the pointer to a new hit: the photo moves by the hit's change (on the sphere the longitude change
 * takes the short way round the back). Returns the new drag state and the placement to apply.
 */
export function continuePlaceDrag(drag: PlaceDrag, point: SurfacePoint, s: PlaceSettings): { drag: PlaceDrag; placement: PlacementPoint } {
  const hit = surfaceToPlacement(point, s);
  if (!hit) return { drag, placement: drag.current };
  let dx = hit.x - drag.last.x;
  // 200 placement units = 360° of longitude.
  if (s.shape === "sphere") dx -= 200 * Math.round(dx / 200);
  const dy = hit.y - drag.last.y;
  const bounds = placementBounds(s);
  const current = {
    imageX: clamp(drag.current.imageX + dx, bounds.x[0], bounds.x[1]),
    imageY: clamp(drag.current.imageY + dy, bounds.y[0], bounds.y[1]),
  };
  return { drag: { current, last: hit }, placement: current };
}

/** Wheel sensitivity: the photo scales by e^(−rate·deltaY), about 14 % per 100 px notch. */
export const WHEEL_SCALE_RATE = 0.0015;

/**
 * Resize the photo from the wheel. imageScale moves in whole percent, so the part of the scroll that
 * hasn't changed the value yet is carried in `pending` (small trackpad deltas add up instead of being lost,
 * and nothing builds up while the scale sits at its limit). Positive deltaY (scroll down, pinch in) shrinks.
 */
export function wheelToScale(current: number, pending: number, deltaY: number): { imageScale: number; pending: number } {
  const { min, max } = NUMERIC.imageScale;
  const base = clamp(current, min, max);
  const target = clamp(base * Math.exp(-(pending + deltaY) * WHEEL_SCALE_RATE), min, max);
  const imageScale = clamp(Math.round(target), min, max);
  const leftover = Math.log(imageScale / target) / WHEEL_SCALE_RATE;
  return { imageScale, pending: Number.isFinite(leftover) ? leftover : 0 };
}
