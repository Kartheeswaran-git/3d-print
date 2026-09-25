import type { CompositionSettings } from "@/lib/image/compose";
import {
  decalCentre,
  frontViewToLamp,
  lampToPlacement,
  photoCropRect,
  wrapDegrees,
  type Domain,
} from "@/lib/image/project";
import { snap } from "@/lib/utils";
import { placementPreset } from "../presets";
import { formatMoonLongitude, NUMERIC, type LithophaneSettings, type NumericKey } from "../settings";

/**
 * Pure geometry of the Layout editor (FEATURE.md §3): where the piece sits in the editor, where the
 * photo's outline and handles are on screen, what a pointer is over, and how a drag, the wheel or a
 * key changes the placement. Screen coordinates are CSS pixels relative to the editor, y down.
 *
 * Flat pieces are drawn at aspect W:H; the photo keeps its settings semantics (imageScale % of the piece
 * width, offsets in % of the width/height, clockwise rotation). The sphere is drawn as its front view
 * (orthographic from +Z, a disc) and the photo is the orthographic decal from `@/lib/image/project`.
 */

export interface Point {
  x: number;
  y: number;
}

export interface Size {
  width: number;
  height: number;
}

export interface Rect {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface Insets {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

/** Where the piece (flat) or the front-view disc (sphere) is drawn inside the editor. */
export type EditorView =
  | { kind: "flat"; frame: Rect; widthMm: number; heightMm: number }
  | { kind: "sphere"; frame: Rect; cx: number; cy: number; radius: number; openingDeg: number };

export type SphereView = Extract<EditorView, { kind: "sphere" }>;

export type Corner = "tl" | "tr" | "br" | "bl";
export const CORNERS: readonly Corner[] = ["tl", "tr", "br", "bl"];

/** What a press starts: move / scale (a corner) / rotate the photo, or turn the moon. */
export type EditorTarget = "move" | "rotate" | "moon" | `scale-${Corner}`;

/** Placement values the editor reads. */
export type PlacementSettings = Pick<LithophaneSettings, "imageScale" | "imageX" | "imageY" | "rotation">;

/** Values a gesture starts from. */
export type DragSettings = PlacementSettings & Pick<LithophaneSettings, "moonLongitude">;

/** Values the editor may change. */
export type LayoutPatch = Partial<DragSettings>;

/**
 * Room kept around the piece: the hint sits in the top inset, the stage's size chip in the bottom one,
 * and the photo's rotation handle needs space above a photo that fills the piece.
 */
export const EDITOR_INSETS: Insets = { top: 44, right: 32, bottom: 52, left: 32 };
/** Each inset takes at most this fraction of the editor's width or height (small stages). */
const MAX_INSET_FRACTION = 0.12;
/** Below this size (px) there is nothing useful to draw. */
const MIN_FRAME_PX = 16;

/** Corner handles are squares of this size (px). */
export const HANDLE_SIZE = 8;
/** The rotation handle sits this far (px) above the photo's top edge. */
export const ROTATE_HANDLE_OFFSET = 20;
/** Radius (px) of the rotation handle's circle. */
export const ROTATE_HANDLE_RADIUS = 5;
/** Grab distance (px) around handles. */
export const HIT_RADIUS = { fine: 10, coarse: 18 } as const;

/** Keyboard steps. */
export const NUDGE_STEP = 1;
export const NUDGE_STEP_LARGE = 10;
export const SCALE_KEY_STEP = 2;
export const ROTATE_KEY_STEP = 5;
export const ROTATE_KEY_STEP_LARGE = 15;
export const MOON_KEY_STEP = 5;
export const MOON_KEY_STEP_LARGE = 15;
/** Shift + rotate snaps to this angle. */
export const ROTATE_SNAP_DEG = 15;

const DEG = Math.PI / 180;
const RAD = 180 / Math.PI;
/** Tolerance for "facing the viewer" (front-view depth). */
const FACING_EPS = 1e-6;

/** Shapes whose moon disc turns with moonRotation (matches the flat sampler in project.ts). */
const ROTATING_SHAPES = new Set(["crescent", "circle", "heart", "rounded", "square"]);

const clampNum = (n: number, min: number, max: number) => (n < min ? min : n > max ? max : n);
const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);

/** Snap a value to a setting's range and step. */
export function snapSetting(key: NumericKey, value: number): number {
  const spec = NUMERIC[key];
  return snap(value, spec.min, spec.max, spec.step);
}

/** Snap an angle to whole degrees in (−180°, 180°] (−180 becomes 180). */
function snapAngle(key: "rotation" | "moonLongitude", deg: number): number {
  return wrapDegrees(snapSetting(key, wrapDegrees(deg)));
}

// ---------------------------------------------------------------------------------------------
// Layout

/** Fit the piece (aspect W:H) or the sphere's front-view disc into the editor, centred inside the insets. */
export function editorView(domain: Domain, container: Size, insets: Insets = EDITOR_INSETS): EditorView | null {
  const cw = container.width;
  const ch = container.height;
  if (!(cw > 0) || !(ch > 0)) return null;
  const top = Math.min(insets.top, ch * MAX_INSET_FRACTION);
  const bottom = Math.min(insets.bottom, ch * MAX_INSET_FRACTION);
  const left = Math.min(insets.left, cw * MAX_INSET_FRACTION);
  const right = Math.min(insets.right, cw * MAX_INSET_FRACTION);
  const aw = cw - left - right;
  const ah = ch - top - bottom;
  if (aw < MIN_FRAME_PX || ah < MIN_FRAME_PX) return null;

  const aspect = domain.kind === "sphere" ? 1 : domain.widthMm / domain.heightMm;
  if (!(aspect > 0) || !Number.isFinite(aspect)) return null;
  let w = aw;
  let h = aw / aspect;
  if (h > ah) {
    h = ah;
    w = ah * aspect;
  }
  w = Math.max(1, Math.round(w));
  h = Math.max(1, Math.round(h));
  if (domain.kind === "sphere") w = h = Math.min(w, h);
  const frame: Rect = {
    left: Math.round(left + (aw - w) / 2),
    top: Math.round(top + (ah - h) / 2),
    width: w,
    height: h,
  };
  if (domain.kind === "sphere") {
    const radius = w / 2;
    return { kind: "sphere", frame, cx: frame.left + radius, cy: frame.top + radius, radius, openingDeg: domain.openingDeg };
  }
  return { kind: "flat", frame, widthMm: domain.widthMm, heightMm: domain.heightMm };
}

/** Screen point → sphere front-view coords (x right, y up, unit disc = the silhouette). */
export function screenToFront(view: SphereView, p: Point): Point {
  return { x: (p.x - view.cx) / view.radius, y: (view.cy - p.y) / view.radius };
}

/** Sphere front-view coords → screen point. */
export function frontToScreen(view: SphereView, x: number, y: number): Point {
  return { x: view.cx + x * view.radius, y: view.cy - y * view.radius };
}

/** Screen point → normalised piece coords (u right, v down; 0..1 across the piece). */
export function screenToPiece(view: Extract<EditorView, { kind: "flat" }>, p: Point): { u: number; v: number } {
  return { u: (p.x - view.frame.left) / view.frame.width, v: (p.y - view.frame.top) / view.frame.height };
}

/** Aspect (w / h) of the placed photo (its crop rectangle), or null without a usable photo. */
export function photoAspectFor(
  domain: Domain,
  s: CompositionSettings,
  photo: { width: number; height: number } | null,
): number | null {
  if (!photo) return null;
  const rect = photoCropRect(domain, s, photo);
  const aspect = rect.w / rect.h;
  return rect.w > 0 && rect.h > 0 && Number.isFinite(aspect) ? aspect : null;
}

/** True when two domains describe the same piece (the custom mask is compared by identity). */
export function sameDomain(a: Domain, b: Domain): boolean {
  if (a === b) return true;
  if (a.kind === "sphere" || b.kind === "sphere") {
    return a.kind === "sphere" && b.kind === "sphere" && a.openingDeg === b.openingDeg;
  }
  const s = a.shape;
  const t = b.shape;
  return (
    a.widthMm === b.widthMm &&
    a.heightMm === b.heightMm &&
    s.shape === t.shape &&
    s.crescent === t.crescent &&
    s.outerRadius === t.outerRadius &&
    s.innerRadius === t.innerRadius &&
    s.offsetX === t.offsetX &&
    s.offsetY === t.offsetY &&
    s.rotationDeg === t.rotationDeg &&
    (s.mask ?? null) === (t.mask ?? null) &&
    s.maskThreshold === t.maskThreshold
  );
}

// ---------------------------------------------------------------------------------------------
// Sphere decal frame (same maths as photoOutline / the sphere sampler in project.ts)

interface DecalFrame {
  thetaDeg: number;
  phiDeg: number;
  sinPhi: number;
  cosPhi: number;
  /** Front-view basis of the tangent plane: centre C, east E, north N (x, y, z). */
  C: [number, number, number];
  E: [number, number, number];
  N: [number, number, number];
}

function decalFrame(s: Pick<PlacementSettings, "imageX" | "imageY">, openingDeg: number): DecalFrame {
  const c = decalCentre(s, openingDeg);
  const l = c.thetaDeg * DEG;
  const p = c.phiDeg * DEG;
  const sl = Math.sin(l);
  const cl = Math.cos(l);
  const sp = Math.sin(p);
  const cp = Math.cos(p);
  return {
    thetaDeg: c.thetaDeg,
    phiDeg: c.phiDeg,
    sinPhi: sp,
    cosPhi: cp,
    C: [cp * sl, sp, cp * cl],
    E: [cl, 0, -sl],
    N: [-sp * sl, cp, -sp * cl],
  };
}

/**
 * Photo-local point (lx right, ly UP, sphere radii) → screen point + front-view depth z (z ≥ 0 faces the
 * viewer). Points beyond the decal's hemisphere continue linearly in the tangent plane (as photoOutline).
 */
function projectDecal(view: SphereView, f: DecalFrame, cos: number, sin: number, lx: number, lyUp: number) {
  const x = lx * cos + lyUp * sin;
  const y = -lx * sin + lyUp * cos;
  const rho2 = x * x + y * y;
  const z = rho2 <= 1 ? Math.sqrt(1 - rho2) : 0;
  const px = x * f.E[0] + y * f.N[0] + z * f.C[0];
  const py = x * f.E[1] + y * f.N[1] + z * f.C[1];
  const pz = x * f.E[2] + y * f.N[2] + z * f.C[2];
  return { ...frontToScreen(view, px, py), z: pz };
}

/** Lamp coords → photo-local coords (lx right, ly UP) of the decal; null on the far side of the decal. */
function lampToDecalLocal(f: DecalFrame, cos: number, sin: number, thetaDeg: number, phiDeg: number): Point | null {
  const d = (thetaDeg - f.thetaDeg) * DEG;
  const p = phiDeg * DEG;
  const sp = Math.sin(p);
  const cp = Math.cos(p);
  const cd = Math.cos(d);
  if (!(f.sinPhi * sp + f.cosPhi * cp * cd > 0)) return null;
  const x = cp * Math.sin(d);
  const y = f.cosPhi * sp - f.sinPhi * cp * cd;
  return { x: x * cos - y * sin, y: x * sin + y * cos };
}

/** Screen point → lamp coords under it; points beside the disc snap to its rim. */
function lampUnder(view: SphereView, p: Point): { thetaDeg: number; phiDeg: number } {
  let { x, y } = screenToFront(view, p);
  const r = Math.hypot(x, y);
  const rim = 0.9999;
  if (r > rim) {
    x *= rim / r;
    y *= rim / r;
  }
  return frontViewToLamp(x, y) ?? { thetaDeg: 0, phiDeg: 0 };
}

// ---------------------------------------------------------------------------------------------
// Photo outline + handles on screen

export interface ScreenHandle {
  at: Point;
  /** False when the handle isn't on the side facing the viewer (sphere). */
  visible: boolean;
}

export interface PhotoGeometry {
  /** Photo centre on screen. */
  centre: ScreenHandle;
  corners: Record<Corner, ScreenHandle>;
  /** Rotation handle: `anchor` = middle of the top edge, `at` = the circle's centre. */
  rotate: ScreenHandle & { anchor: Point };
  /** Clockwise angle (deg) to draw the corner squares at. */
  angleDeg: number;
}

/** Screen positions of the photo's centre, corners and rotation handle. */
export function photoGeometry(view: EditorView, s: PlacementSettings, aspect: number): PhotoGeometry {
  const r = (Number.isFinite(s.rotation) ? s.rotation : 0) * DEG;
  const cos = Math.cos(r);
  const sin = Math.sin(r);
  const angleDeg = s.rotation;

  if (view.kind === "flat") {
    const { frame, widthMm: W, heightMm: H } = view;
    const cx = W / 2 + (s.imageX / 100) * W;
    const cy = H / 2 + (s.imageY / 100) * H;
    const hw = ((s.imageScale / 100) * W) / 2;
    const hh = hw / aspect;
    // Photo-local mm (y down) → piece mm (clockwise rotation) → screen, as the canvas maps u, v.
    const at = (lx: number, ly: number): Point => ({
      x: frame.left + ((cx + cos * lx - sin * ly) / W) * frame.width,
      y: frame.top + ((cy + sin * lx + cos * ly) / H) * frame.height,
    });
    const handle = (lx: number, ly: number): ScreenHandle => ({ at: at(lx, ly), visible: true });
    const anchor = at(0, -hh);
    // The photo's "up" on screen.
    const ux = (sin / W) * frame.width;
    const uy = (-cos / H) * frame.height;
    const len = Math.hypot(ux, uy) || 1;
    return {
      centre: { at: at(0, 0), visible: true },
      corners: { tl: handle(-hw, -hh), tr: handle(hw, -hh), br: handle(hw, hh), bl: handle(-hw, hh) },
      rotate: {
        anchor,
        at: { x: anchor.x + (ux / len) * ROTATE_HANDLE_OFFSET, y: anchor.y + (uy / len) * ROTATE_HANDLE_OFFSET },
        visible: true,
      },
      angleDeg,
    };
  }

  const f = decalFrame(s, view.openingDeg);
  const hw = s.imageScale / 100;
  const hh = hw / aspect;
  const project = (lx: number, lyUp: number) => projectDecal(view, f, cos, sin, lx, lyUp);
  const handle = (lx: number, lyUp: number): ScreenHandle => {
    const p = project(lx, lyUp);
    return { at: { x: p.x, y: p.y }, visible: p.z >= -FACING_EPS };
  };
  const centre = project(0, 0);
  const anchor = project(0, hh);
  // "Up" out of the top edge on screen: towards a point just above it in the tangent plane.
  const beyond = project(0, hh + 0.02);
  let dx = beyond.x - anchor.x;
  let dy = beyond.y - anchor.y;
  let len = Math.hypot(dx, dy);
  if (len < 1e-6) {
    dx = anchor.x - centre.x;
    dy = anchor.y - centre.y;
    len = Math.hypot(dx, dy);
  }
  if (len < 1e-6) {
    dx = 0;
    dy = -1;
    len = 1;
  }
  return {
    centre: { at: { x: centre.x, y: centre.y }, visible: centre.z >= -FACING_EPS },
    corners: { tl: handle(-hw, hh), tr: handle(hw, hh), br: handle(hw, -hh), bl: handle(-hw, -hh) },
    rotate: {
      anchor: { x: anchor.x, y: anchor.y },
      at: { x: anchor.x + (dx / len) * ROTATE_HANDLE_OFFSET, y: anchor.y + (dy / len) * ROTATE_HANDLE_OFFSET },
      visible: anchor.z >= -FACING_EPS,
    },
    angleDeg,
  };
}

/** True when the screen point lies on the photo (sphere: on its visible part). */
export function photoContains(view: EditorView, s: PlacementSettings, aspect: number, p: Point): boolean {
  const r = s.rotation * DEG;
  const cos = Math.cos(r);
  const sin = Math.sin(r);
  if (view.kind === "flat") {
    const { frame, widthMm: W, heightMm: H } = view;
    const hw = ((s.imageScale / 100) * W) / 2;
    const hh = hw / aspect;
    const dx = ((p.x - frame.left) / frame.width) * W - (W / 2 + (s.imageX / 100) * W);
    const dy = ((p.y - frame.top) / frame.height) * H - (H / 2 + (s.imageY / 100) * H);
    const lx = cos * dx + sin * dy;
    const ly = -sin * dx + cos * dy;
    return Math.abs(lx) <= hw && Math.abs(ly) <= hh;
  }
  const front = screenToFront(view, p);
  if (front.x * front.x + front.y * front.y > 1) return false;
  const lamp = frontViewToLamp(front.x, front.y);
  if (!lamp) return false;
  const local = lampToDecalLocal(decalFrame(s, view.openingDeg), cos, sin, lamp.thetaDeg, lamp.phiDeg);
  if (!local) return false;
  const hw = s.imageScale / 100;
  return Math.abs(local.x) <= hw && Math.abs(local.y) <= hw / aspect;
}

/** Everything a hit test needs. `aspect` is null without a photo. */
export interface HitScene {
  view: EditorView;
  settings: PlacementSettings;
  aspect: number | null;
  geometry: PhotoGeometry | null;
  /** The moon background is shown, so dragging beside the photo turns it. */
  moonOn: boolean;
}

/** What a press at `p` would drag: handles first, then the photo, then the moon (null: nothing). */
export function hitTest(scene: HitScene, p: Point, radius: number): EditorTarget | null {
  const { geometry, aspect } = scene;
  if (geometry && aspect !== null) {
    if (geometry.rotate.visible && distance(p, geometry.rotate.at) <= radius) return "rotate";
    let best: Corner | null = null;
    let bestDistance = radius;
    for (const corner of CORNERS) {
      const handle = geometry.corners[corner];
      if (!handle.visible) continue;
      const d = distance(p, handle.at);
      if (d <= bestDistance) {
        best = corner;
        bestDistance = d;
      }
    }
    if (best) return `scale-${best}`;
    if (photoContains(scene.view, scene.settings, aspect, p)) return "move";
  }
  return scene.moonOn ? "moon" : null;
}

/** CSS cursor for a target (resize cursors follow the corner's direction on screen). */
export function cursorFor(target: EditorTarget | null, geometry: PhotoGeometry | null, active: boolean): string {
  if (!target) return "default";
  if (target === "move") return "move";
  if (target === "moon") return active ? "grabbing" : "grab";
  if (target === "rotate") return "crosshair";
  if (!geometry) return "default";
  const corner = geometry.corners[target.slice(6) as Corner].at;
  const angle = Math.atan2(corner.y - geometry.centre.at.y, corner.x - geometry.centre.at.x) * RAD;
  const bucket = Math.round((((angle % 180) + 180) % 180) / 45) % 4;
  return ["ew-resize", "nwse-resize", "ns-resize", "nesw-resize"][bucket];
}

// ---------------------------------------------------------------------------------------------
// Moon disc

export interface MoonDisc {
  /** Radius (px) over which one radian of longitude passes at the disc centre. */
  radius: number;
  /** Screen direction of increasing longitude (east), unit length, y down. */
  east: Point;
}

/** The moon as it's drawn: the sphere's disc, or a flat piece's orthographic moon disc (turned with moonRotation). */
export function moonDisc(view: EditorView, domain: Domain, moonRotationDeg: number): MoonDisc {
  if (view.kind === "sphere" || domain.kind === "sphere") {
    return { radius: view.kind === "sphere" ? view.radius : view.frame.width / 2, east: { x: 1, y: 0 } };
  }
  const W = domain.widthMm;
  const H = domain.heightMm;
  const m = Math.min(W, H);
  const shape = domain.shape;
  const discRadius = shape.shape === "crescent" || shape.shape === "circle" ? shape.outerRadius : Math.hypot(W / m, H / m);
  // One normalised unit is half the shorter side.
  const unitPx = ((m / 2) * view.frame.width) / W;
  const a = ROTATING_SHAPES.has(shape.shape) ? (Number.isFinite(moonRotationDeg) ? moonRotationDeg : 0) * DEG : 0;
  return { radius: discRadius * unitPx, east: { x: Math.cos(a), y: Math.sin(a) } };
}

// ---------------------------------------------------------------------------------------------
// Gestures

export interface DragStart {
  target: EditorTarget;
  /** Pointer position at the press. */
  pointer: Point;
  /** Photo centre on screen at the press (scale and rotate pivot around it). */
  centre: Point;
  settings: DragSettings;
}

/**
 * New values for a drag from `start` to `p`. Always derived from the start values (never accumulated),
 * snapped to each setting's step. `shift`: move along one axis only / rotate in 15° steps.
 */
export function dragPatch(view: EditorView, disc: MoonDisc | null, start: DragStart, p: Point, shift: boolean): LayoutPatch {
  const s0 = start.settings;
  switch (start.target) {
    case "move":
      return movePatch(view, start, p, shift);
    case "rotate": {
      const c = start.centre;
      if (distance(p, c) < 1 || distance(start.pointer, c) < 1) return {};
      const a0 = Math.atan2(start.pointer.y - c.y, start.pointer.x - c.x);
      const a = Math.atan2(p.y - c.y, p.x - c.x);
      let deg = wrapDegrees(s0.rotation + (a - a0) * RAD);
      if (shift) deg = Math.round(deg / ROTATE_SNAP_DEG) * ROTATE_SNAP_DEG;
      return { rotation: snapAngle("rotation", deg) };
    }
    case "moon": {
      if (!disc || !(disc.radius > 0)) return {};
      // Grab-and-spin: the surface under the pointer follows it (east = increasing longitude on screen).
      const along = (p.x - start.pointer.x) * disc.east.x + (p.y - start.pointer.y) * disc.east.y;
      return { moonLongitude: snapAngle("moonLongitude", s0.moonLongitude - (along / disc.radius) * RAD) };
    }
    default: {
      const r0 = distance(start.pointer, start.centre);
      if (r0 < 1) return {};
      return { imageScale: snapSetting("imageScale", (s0.imageScale * distance(p, start.centre)) / r0) };
    }
  }
}

function movePatch(view: EditorView, start: DragStart, p: Point, shift: boolean): LayoutPatch {
  const s0 = start.settings;
  const lockX = shift && Math.abs(p.y - start.pointer.y) > Math.abs(p.x - start.pointer.x);
  const lockY = shift && !lockX;
  if (view.kind === "flat") {
    const dx = lockX ? 0 : p.x - start.pointer.x;
    const dy = lockY ? 0 : p.y - start.pointer.y;
    return {
      imageX: snapSetting("imageX", s0.imageX + (dx / view.frame.width) * 100),
      imageY: snapSetting("imageY", s0.imageY + (dy / view.frame.height) * 100),
    };
  }
  // Sphere: shift the decal centre by the lamp-angle change under the pointer.
  const from = lampUnder(view, start.pointer);
  const to = lampUnder(view, p);
  const dTheta = lockX ? 0 : to.thetaDeg - from.thetaDeg;
  const dPhi = lockY ? 0 : to.phiDeg - from.phiDeg;
  const c0 = decalCentre(s0, view.openingDeg);
  // Clamp the latitude to where the decal can go, so dragging back never has a dead zone.
  const c1 = decalCentre(lampToPlacement(c0.thetaDeg + dTheta, c0.phiDeg + dPhi), view.openingDeg);
  const placement = lampToPlacement(c1.thetaDeg, c1.phiDeg);
  return { imageX: snapSetting("imageX", placement.imageX), imageY: snapSetting("imageY", placement.imageY) };
}

export interface PinchStart {
  a: Point;
  b: Point;
  imageScale: number;
  rotation: number;
}

/** Two-finger pinch: scale by the change in finger distance, rotate by the change in angle. */
export function pinchPatch(start: PinchStart, a: Point, b: Point): LayoutPatch {
  const d0 = distance(start.a, start.b);
  const d = distance(a, b);
  if (d0 < 1 || d < 1) return {};
  const a0 = Math.atan2(start.b.y - start.a.y, start.b.x - start.a.x);
  const a1 = Math.atan2(b.y - a.y, b.x - a.x);
  return {
    imageScale: snapSetting("imageScale", (start.imageScale * d) / d0),
    rotation: snapAngle("rotation", start.rotation + (a1 - a0) * RAD),
  };
}

/** WheelEvent.deltaMode values → pixels. */
const LINE_PX = 16;
const PAGE_PX = 100;
/** Scale change per wheel pixel (scroll) and per pinch pixel (trackpad pinch arrives as ctrl + wheel). */
const WHEEL_RATE = 0.0015;
const PINCH_RATE = 0.01;
/** One wheel event changes the size by at most ~10 %. */
const MAX_WHEEL_STEP = 0.1;

/** Multiplier for the photo size from one wheel event (scroll down / pinch in → smaller). */
export function wheelZoomFactor(deltaY: number, deltaMode: number, ctrlKey: boolean): number {
  if (!Number.isFinite(deltaY)) return 1;
  const px = deltaMode === 1 ? deltaY * LINE_PX : deltaMode === 2 ? deltaY * PAGE_PX : deltaY;
  const step = clampNum(px * (ctrlKey ? PINCH_RATE : WHEEL_RATE), -MAX_WHEEL_STEP, MAX_WHEEL_STEP);
  return Math.exp(-step);
}

/** Unrounded photo size after a wheel step, kept inside the setting's range (the caller rounds for the store). */
export function wheelScale(current: number, factor: number): number {
  const { min, max } = NUMERIC.imageScale;
  return clampNum(current * factor, min, max);
}

/**
 * Keyboard editing (the editor has focus). Returns the new values, `{}` for a handled key that changes
 * nothing (e.g. at a limit), or null when the key isn't the editor's.
 * Arrows move the photo 1 % (Shift 10 %) — or, without a photo, turn the moon; + / − resize; [ ] rotate
 * 5° ({ } or Shift 15°); , . (< >) turn the moon 5° (15°); 0 centres and straightens the photo.
 */
export function keyPatch(
  key: string,
  shift: boolean,
  s: LithophaneSettings,
  opts: { hasPhoto: boolean; moonOn: boolean },
): LayoutPatch | null {
  const moon = (direction: 1 | -1, large: boolean): LayoutPatch | null =>
    opts.moonOn
      ? { moonLongitude: snapAngle("moonLongitude", s.moonLongitude - direction * (large ? MOON_KEY_STEP_LARGE : MOON_KEY_STEP)) }
      : null;
  const nudge = shift ? NUDGE_STEP_LARGE : NUDGE_STEP;
  switch (key) {
    case "ArrowLeft":
    case "ArrowRight": {
      const direction = key === "ArrowRight" ? 1 : -1;
      if (!opts.hasPhoto) return moon(direction, shift);
      return { imageX: snapSetting("imageX", s.imageX + direction * nudge) };
    }
    case "ArrowUp":
    case "ArrowDown":
      if (!opts.hasPhoto) return null;
      return { imageY: snapSetting("imageY", s.imageY + (key === "ArrowDown" ? 1 : -1) * nudge) };
    case "+":
    case "=":
      return opts.hasPhoto ? { imageScale: snapSetting("imageScale", s.imageScale + SCALE_KEY_STEP) } : null;
    case "-":
    case "_":
      return opts.hasPhoto ? { imageScale: snapSetting("imageScale", s.imageScale - SCALE_KEY_STEP) } : null;
    case "[":
    case "]":
    case "{":
    case "}": {
      if (!opts.hasPhoto) return null;
      const step = shift || key === "{" || key === "}" ? ROTATE_KEY_STEP_LARGE : ROTATE_KEY_STEP;
      const direction = key === "]" || key === "}" ? 1 : -1;
      return { rotation: snapAngle("rotation", s.rotation + direction * step) };
    }
    case ",":
    case "<":
      return moon(-1, shift || key === "<");
    case ".":
    case ">":
      return moon(1, shift || key === ">");
    case "0": {
      if (!opts.hasPhoto) return null;
      const { imageX, imageY, rotation } = placementPreset("center", s, null);
      return { imageX, imageY, rotation };
    }
    default:
      return null;
  }
}

/** The entries of `patch` that differ from `current`, or null when nothing changes. */
export function diffPatch(current: DragSettings, patch: LayoutPatch): LayoutPatch | null {
  const out: LayoutPatch = {};
  let changed = false;
  for (const key of Object.keys(patch) as (keyof DragSettings)[]) {
    const value = patch[key];
    if (value !== undefined && value !== current[key]) {
      out[key] = value;
      changed = true;
    }
  }
  return changed ? out : null;
}

/** True when both patches set the same keys to the same values. */
export function samePatch(a: LayoutPatch, b: LayoutPatch): boolean {
  const keys = Object.keys(a) as (keyof DragSettings)[];
  if (keys.length !== Object.keys(b).length) return false;
  return keys.every((key) => a[key] === b[key]);
}

// ---------------------------------------------------------------------------------------------
// SVG paths

/** Photo outline (from photoOutline) → SVG path data: `solid` for visible runs, `hidden` for the rest (sphere). */
export function outlinePaths(
  view: EditorView,
  outline: { points: [number, number][]; visible: boolean[] },
): { solid: string; hidden: string } {
  const { points, visible } = outline;
  const n = points.length;
  if (n < 2) return { solid: "", hidden: "" };
  const screen = points.map(([a, b]): Point =>
    view.kind === "flat"
      ? { x: view.frame.left + a * view.frame.width, y: view.frame.top + b * view.frame.height }
      : frontToScreen(view, a, b),
  );
  const fmt = (p: Point) => `${p.x.toFixed(2)} ${p.y.toFixed(2)}`;
  if (view.kind === "flat") {
    return { solid: `M${screen.map(fmt).join("L")}Z`, hidden: "" };
  }
  let solid = "";
  let hidden = "";
  let run: "solid" | "hidden" | null = null;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const kind = visible[i] && visible[j] ? "solid" : "hidden";
    if (kind !== run) {
      if (kind === "solid") solid += `M${fmt(screen[i])}`;
      else hidden += `M${fmt(screen[i])}`;
      run = kind;
    }
    if (kind === "solid") solid += `L${fmt(screen[j])}`;
    else hidden += `L${fmt(screen[j])}`;
  }
  return { solid, hidden };
}

/** Closed loops in normalised piece coords → SVG path data on screen. */
export function loopsPath(view: Extract<EditorView, { kind: "flat" }>, loops: readonly (readonly [number, number])[][]): string {
  const { left, top, width, height } = view.frame;
  let d = "";
  for (const loop of loops) {
    if (loop.length < 2) continue;
    d += "M";
    d += loop.map(([u, v]) => `${(left + u * width).toFixed(2)} ${(top + v * height).toFixed(2)}`).join("L");
    d += "Z";
  }
  return d;
}

// ---------------------------------------------------------------------------------------------
// Words

const pct = (n: number) => `${Math.abs(Math.round(n))}%`;

/** Plain-language summary of the layout for the editor's live region. */
export function describeLayout(
  domain: Domain,
  s: DragSettings,
  opts: { hasPhoto: boolean; moonOn: boolean; photoOnBack?: boolean },
): string {
  const parts: string[] = [];
  if (opts.hasPhoto) {
    const moves: string[] = [];
    if (Math.round(s.imageX) !== 0) moves.push(`${pct(s.imageX)} ${s.imageX > 0 ? "right" : "left"}`);
    if (Math.round(s.imageY) !== 0) moves.push(`${pct(s.imageY)} ${s.imageY > 0 ? "down" : "up"}`);
    const where = moves.length ? `moved ${moves.join(" and ")}` : "centred";
    const rotation = Math.round(s.rotation);
    const turn = rotation === 0 ? "not rotated" : `rotated ${Math.abs(rotation)}° ${rotation > 0 ? "clockwise" : "counter-clockwise"}`;
    const size = domain.kind === "sphere" ? `${Math.round(s.imageScale)}% of the globe's width` : `${Math.round(s.imageScale)}% of the piece's width`;
    parts.push(`Photo ${size}, ${where}, ${turn}.`);
    if (opts.photoOnBack) parts.push("It is on the back of the globe.");
  }
  if (opts.moonOn) {
    const side = formatMoonLongitude(s.moonLongitude);
    parts.push(side === "Near side" || side === "Far side" ? `The moon shows its ${side.toLowerCase()}.` : `The moon is turned to ${side}.`);
  }
  if (!parts.length) parts.push("No photo and no moon texture yet.");
  return parts.join(" ");
}

/** The editor's on-screen hint. */
export function layoutHint(opts: { hasPhoto: boolean; moonOn: boolean; photoOnBack: boolean }): string {
  if (opts.hasPhoto && opts.photoOnBack) return "Your photo is on the back of the globe · press 0 or choose Center to bring it to the front";
  if (opts.hasPhoto && opts.moonOn) return "Drag the photo to move · corners to resize · top handle to rotate · drag the moon to turn it";
  if (opts.hasPhoto) return "Drag the photo to move · corners to resize · top handle to rotate";
  if (opts.moonOn) return "Drag the moon to turn it";
  return "Add a photo or turn on the moon texture to edit the layout";
}

/** Keyboard help for screen readers (aria-describedby). */
export function layoutKeyboardHelp(opts: { hasPhoto: boolean; moonOn: boolean }): string {
  const keys: string[] = [];
  if (opts.hasPhoto) {
    keys.push(
      "Arrow keys move the photo, with Shift for bigger steps",
      "plus and minus resize it",
      "square brackets rotate it",
      "0 centres it",
    );
  } else if (opts.moonOn) {
    keys.push("Left and right arrow keys turn the moon");
  }
  if (opts.moonOn) keys.push("comma and period turn the moon");
  return keys.length ? `${keys.join(", ")}.` : "Add a photo or turn on the moon texture to edit the layout.";
}
