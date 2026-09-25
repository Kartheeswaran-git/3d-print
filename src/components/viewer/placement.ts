import { MOUSE } from "three";
import type { InteractionMode } from "./types";

/** OrbitControls action per mouse button. */
export type MouseButtons = Readonly<{ LEFT: MOUSE; MIDDLE: MOUSE; RIGHT: MOUSE }>;

/** OrbitControls' own mapping: left rotates, middle zooms, right pans (shift/ctrl/cmd + left pans too). */
export const ORBIT_MOUSE_BUTTONS: MouseButtons = Object.freeze({ LEFT: MOUSE.ROTATE, MIDDLE: MOUSE.DOLLY, RIGHT: MOUSE.PAN });

/** Place mode: a left press on the model places, so the right button rotates too. Shift/ctrl/cmd + drag still pans. */
export const PLACE_MOUSE_BUTTONS: MouseButtons = Object.freeze({ LEFT: MOUSE.ROTATE, MIDDLE: MOUSE.DOLLY, RIGHT: MOUSE.ROTATE });

export function mouseButtonsFor(mode: InteractionMode): MouseButtons {
  return mode === "place" ? PLACE_MOUSE_BUTTONS : ORBIT_MOUSE_BUTTONS;
}

/** The parts of a pointer event that decide whether a press may start a placement. */
export interface PressLike {
  button: number;
  isPrimary: boolean;
  shiftKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
}

/**
 * A placement starts from a plain primary press (mouse left button, first finger, pen tip). Other buttons,
 * extra fingers and modifier presses stay with the camera controls, which pan on shift/ctrl/cmd + drag.
 */
export function startsPlacement(press: PressLike): boolean {
  return press.button === 0 && press.isPrimary && !press.shiftKey && !press.ctrlKey && !press.metaKey;
}

/** Client coordinates → normalised device coordinates (−1…1, +y up) of `rect`; null outside it or for an empty rect. */
export function pointerToNdc(
  clientX: number,
  clientY: number,
  rect: { left: number; top: number; width: number; height: number },
): { x: number; y: number } | null {
  if (!(rect.width > 0) || !(rect.height > 0)) return null;
  const u = (clientX - rect.left) / rect.width;
  const v = (clientY - rect.top) / rect.height;
  if (!(u >= 0 && u <= 1 && v >= 0 && v <= 1)) return null;
  return { x: u * 2 - 1, y: 1 - v * 2 };
}

/** WheelEvent.deltaMode values. */
const DELTA_LINE = 1;
const DELTA_PAGE = 2;
/** Pixels per line / page, and the pinch boost, as three's OrbitControls uses them. */
const LINE_PX = 16;
const PAGE_PX = 100;
const PINCH_BOOST = 10;

/**
 * Wheel delta in pixels. `pinch` is a trackpad pinch (the browser reports it as ctrl + wheel while the Control
 * key is not actually held); its deltas are about ten times smaller than scrolling, so they are scaled up.
 */
export function normalizeWheelDelta(deltaY: number, deltaMode: number, pinch: boolean): number {
  const px = deltaMode === DELTA_LINE ? deltaY * LINE_PX : deltaMode === DELTA_PAGE ? deltaY * PAGE_PX : deltaY;
  return pinch ? px * PINCH_BOOST : px;
}

export function samePoint(a: readonly [number, number, number], b: readonly [number, number, number]): boolean {
  return a[0] === b[0] && a[1] === b[1] && a[2] === b[2];
}
