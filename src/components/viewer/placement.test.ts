import { describe, expect, it } from "vitest";
import { MOUSE } from "three";
import {
  mouseButtonsFor,
  normalizeWheelDelta,
  ORBIT_MOUSE_BUTTONS,
  PLACE_MOUSE_BUTTONS,
  pointerToNdc,
  samePoint,
  startsPlacement,
} from "./placement";

const press = { button: 0, isPrimary: true, shiftKey: false, ctrlKey: false, metaKey: false };

describe("startsPlacement", () => {
  it("accepts a plain primary press", () => {
    expect(startsPlacement(press)).toBe(true);
  });

  it("leaves other buttons, extra fingers and modifier presses to the camera", () => {
    expect(startsPlacement({ ...press, button: 2 })).toBe(false);
    expect(startsPlacement({ ...press, button: 1 })).toBe(false);
    expect(startsPlacement({ ...press, isPrimary: false })).toBe(false);
    expect(startsPlacement({ ...press, shiftKey: true })).toBe(false);
    expect(startsPlacement({ ...press, ctrlKey: true })).toBe(false);
    expect(startsPlacement({ ...press, metaKey: true })).toBe(false);
  });
});

describe("mouseButtonsFor", () => {
  it("keeps OrbitControls' mapping in orbit mode", () => {
    expect(mouseButtonsFor("orbit")).toBe(ORBIT_MOUSE_BUTTONS);
    expect(ORBIT_MOUSE_BUTTONS).toEqual({ LEFT: MOUSE.ROTATE, MIDDLE: MOUSE.DOLLY, RIGHT: MOUSE.PAN });
  });

  it("lets the right button rotate in place mode", () => {
    expect(mouseButtonsFor("place")).toBe(PLACE_MOUSE_BUTTONS);
    expect(PLACE_MOUSE_BUTTONS.RIGHT).toBe(MOUSE.ROTATE);
    expect(PLACE_MOUSE_BUTTONS.LEFT).toBe(MOUSE.ROTATE);
  });
});

describe("pointerToNdc", () => {
  const rect = { left: 100, top: 50, width: 400, height: 200 };

  it("maps the rect to −1…1 with +y up", () => {
    expect(pointerToNdc(300, 150, rect)).toEqual({ x: 0, y: 0 });
    expect(pointerToNdc(100, 50, rect)).toEqual({ x: -1, y: 1 });
    expect(pointerToNdc(500, 250, rect)).toEqual({ x: 1, y: -1 });
    expect(pointerToNdc(200, 200, rect)).toEqual({ x: -0.5, y: -0.5 });
  });

  it("rejects points outside the rect and empty rects", () => {
    expect(pointerToNdc(99, 150, rect)).toBeNull();
    expect(pointerToNdc(300, 251, rect)).toBeNull();
    expect(pointerToNdc(0, 0, { left: 0, top: 0, width: 0, height: 10 })).toBeNull();
  });
});

describe("normalizeWheelDelta", () => {
  it("converts line and page deltas to pixels", () => {
    expect(normalizeWheelDelta(-40, 0, false)).toBe(-40);
    expect(normalizeWheelDelta(3, 1, false)).toBe(48);
    expect(normalizeWheelDelta(1, 2, false)).toBe(100);
  });

  it("boosts trackpad pinches", () => {
    expect(normalizeWheelDelta(2.5, 0, true)).toBe(25);
    expect(normalizeWheelDelta(-1, 1, true)).toBe(-160);
  });
});

describe("samePoint", () => {
  it("compares coordinates exactly", () => {
    expect(samePoint([1, 2, 3], [1, 2, 3])).toBe(true);
    expect(samePoint([1, 2, 3], [1, 2, 3.0001])).toBe(false);
  });
});
