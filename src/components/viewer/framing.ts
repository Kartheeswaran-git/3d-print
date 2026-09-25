import { MathUtils, Spherical, Vector3 } from "three";
import type { SceneBounds } from "./geometry";
import type { CameraView } from "./types";

export const CAMERA_FOV = 34;
/** Extra room around the framed model (1 = touching the edges). */
export const FIT_MARGIN = 1.15;
export const VIEW_TRANSITION_MS = 300;

/** Unit vectors from the target towards the camera (+Y up, +Z towards the viewer). */
const VIEW_DIRECTIONS: Record<CameraView, readonly [number, number, number]> = {
  perspective: [0.62, 0.4, 1],
  front: [0, 0, 1],
  side: [1, 0, 0],
  // A hair of +Z keeps "up" defined, so the front edge sits at the bottom of the screen.
  top: [0, 1, 0.02],
};

export function viewDirection(view: CameraView): Vector3 {
  const [x, y, z] = VIEW_DIRECTIONS[view];
  return new Vector3(x, y, z).normalize();
}

const WORLD_UP = new Vector3(0, 1, 0);

/**
 * Camera distance from `bounds.center` along `direction` that keeps the whole model in view.
 * Uses the tighter of the bounding-sphere fit and the projected bounding-box fit (both always contain the model).
 */
export function fitDistance(
  bounds: Pick<SceneBounds, "min" | "max" | "center" | "radius">,
  direction: Vector3,
  fovDeg: number,
  aspect: number,
  margin = FIT_MARGIN,
): number {
  const vHalf = MathUtils.degToRad(fovDeg) / 2;
  const tanV = Math.tan(vHalf);
  const tanH = tanV * Math.max(aspect, 1e-3);
  const hHalf = Math.atan(tanH);

  const sphereFit = (bounds.radius * margin) / Math.sin(Math.min(vHalf, hHalf));

  const z = direction.clone().normalize();
  const x = new Vector3().crossVectors(WORLD_UP, z);
  if (x.lengthSq() < 1e-10) x.set(1, 0, 0);
  x.normalize();
  const y = new Vector3().crossVectors(z, x).normalize();

  let boxFit = 0;
  const corner = new Vector3();
  for (let i = 0; i < 8; i++) {
    corner.set(
      i & 1 ? bounds.max.x : bounds.min.x,
      i & 2 ? bounds.max.y : bounds.min.y,
      i & 4 ? bounds.max.z : bounds.min.z,
    );
    corner.sub(bounds.center);
    const px = Math.abs(corner.dot(x)) * margin;
    const py = Math.abs(corner.dot(y)) * margin;
    const pz = corner.dot(z);
    boxFit = Math.max(boxFit, pz + px / tanH, pz + py / tanV);
  }

  return Math.max(Math.min(sphereFit, boxFit), bounds.radius * 0.5);
}

/** Orbit zoom limits relative to the model size. Plates allow a close look at the relief; shells keep the camera outside. */
export function distanceLimits(bounds: Pick<SceneBounds, "radius" | "isPlate">): { min: number; max: number } {
  return {
    min: bounds.radius * (bounds.isPlate ? 0.35 : 1.15),
    max: bounds.radius * 8,
  };
}

/** Near/far planes that keep depth precision good at every allowed zoom level. */
export function clipPlanes(radius: number): { near: number; far: number } {
  return { near: Math.max(radius * 0.01, 0.01), far: radius * 24 };
}

/**
 * Whether a parts/fitKey update moves the camera (FIXES L2): the first mesh is framed at once; a new
 * fitKey is framed (animated) when its mesh arrives; anything else keeps the user's view.
 */
export function fitDecision(
  fittedKey: string | null,
  fitKey: string,
  hasModel: boolean,
  geometryChanged: boolean,
): "keep" | "frame" | "animate" {
  if (!hasModel) return "keep";
  if (fittedKey === null) return "frame";
  return fittedKey !== fitKey && geometryChanged ? "animate" : "keep";
}

export function easeInOutCubic(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

export interface CameraPose {
  position: Vector3;
  target: Vector3;
}

const fromSph = new Spherical();
const toSph = new Spherical();
const offset = new Vector3();

/**
 * Blend two camera poses: the target moves linearly, the camera swings around it on the shortest
 * azimuth path with a log-space zoom, so view changes never cut through the model.
 */
export function interpolatePose(from: CameraPose, to: CameraPose, t: number, out: CameraPose): CameraPose {
  out.target.lerpVectors(from.target, to.target, t);
  fromSph.setFromVector3(offset.subVectors(from.position, from.target));
  toSph.setFromVector3(offset.subVectors(to.position, to.target));
  let dTheta = (toSph.theta - fromSph.theta) % (Math.PI * 2);
  if (dTheta > Math.PI) dTheta -= Math.PI * 2;
  if (dTheta < -Math.PI) dTheta += Math.PI * 2;
  const radius = Math.exp(MathUtils.lerp(Math.log(Math.max(fromSph.radius, 1e-6)), Math.log(Math.max(toSph.radius, 1e-6)), t));
  const phi = MathUtils.lerp(fromSph.phi, toSph.phi, t);
  const theta = fromSph.theta + dTheta * t;
  offset.setFromSphericalCoords(radius, phi, theta);
  out.position.copy(out.target).add(offset);
  return out;
}

export function prefersReducedMotion(): boolean {
  return typeof window !== "undefined" && typeof window.matchMedia === "function"
    ? window.matchMedia("(prefers-reduced-motion: reduce)").matches
    : false;
}
