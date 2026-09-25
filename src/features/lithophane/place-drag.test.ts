import { describe, expect, it } from "vitest";
import { decalCentre } from "@/lib/image/project";
import {
  continuePlaceDrag,
  placementBounds,
  startPlaceDrag,
  surfaceToPlacement,
  wheelToScale,
  type SurfacePoint,
} from "./place-drag";
import { DEFAULTS, type LithophaneSettings } from "./settings";

const settings = (patch: Partial<LithophaneSettings> = {}): LithophaneSettings => ({ ...DEFAULTS, ...patch });

const DEG = Math.PI / 180;
/** Point on a sphere of radius r at longitude θ (0 = front, +Z) and latitude φ, as buildSphereMesh places it. */
function spherePoint(thetaDeg: number, phiDeg: number, r = 60): SurfacePoint {
  const t = thetaDeg * DEG;
  const p = phiDeg * DEG;
  return [r * Math.cos(p) * Math.sin(t), r * Math.sin(p), r * Math.cos(p) * Math.cos(t)];
}

describe("surfaceToPlacement", () => {
  it("maps sphere hits through θ = atan2(x, z), φ = asin(y/|p|)", () => {
    const s = settings();
    const front = surfaceToPlacement(spherePoint(0, 0), s);
    expect(front?.x).toBeCloseTo(0);
    expect(front?.y).toBeCloseTo(0);
    const right = surfaceToPlacement(spherePoint(90, 0), s);
    expect(right?.x).toBeCloseTo(50);
    const upper = surfaceToPlacement(spherePoint(-45, 45, 75), s);
    expect(upper?.x).toBeCloseTo(-25);
    expect(upper?.y).toBeCloseTo(-50);
  });

  it("is the inverse of the decal centre on the sphere", () => {
    const s = settings({ imageX: 30, imageY: -40 });
    const c = decalCentre(s, s.sphereOpening);
    const p = surfaceToPlacement(spherePoint(c.thetaDeg, c.phiDeg), s);
    expect(p?.x).toBeCloseTo(30);
    expect(p?.y).toBeCloseTo(-40);
  });

  it("maps flat hits to % of the piece with +y up", () => {
    const s = settings({ shape: "rectangle", width: 150, height: 100 });
    expect(surfaceToPlacement([30, 20, 2], s)).toEqual({ x: 20, y: -20 });
    expect(surfaceToPlacement([-75, -50, 0], s)).toEqual({ x: -50, y: 50 });
  });

  it("rejects degenerate points", () => {
    expect(surfaceToPlacement([0, 0, 0], settings())).toBeNull();
    expect(surfaceToPlacement([Number.NaN, 1, 1], settings({ shape: "heart" }))).toBeNull();
  });
});

describe("place drag", () => {
  it("moves the photo by the travel of the grabbed point, never jumping on press", () => {
    const s = settings({ imageX: 10, imageY: 5 });
    const drag = startPlaceDrag(spherePoint(40, 20), s);
    expect(drag?.current).toEqual({ imageX: 10, imageY: 5 });
    if (!drag) return;
    const step = continuePlaceDrag(drag, spherePoint(58, 11), s);
    expect(step.placement.imageX).toBeCloseTo(20);
    expect(step.placement.imageY).toBeCloseTo(15);
  });

  it("takes the short way across the back seam of the sphere", () => {
    const s = settings({ imageX: 0 });
    const drag = startPlaceDrag(spherePoint(170, 0), s);
    if (!drag) throw new Error("expected a drag");
    const step = continuePlaceDrag(drag, spherePoint(-170, 0), s);
    expect(step.placement.imageX).toBeCloseTo((20 / 180) * 100);
  });

  it("keeps the sphere decal inside the band it can reach, and responds at once when reversed", () => {
    const s = settings({ sphereOpening: 22 });
    const bounds = placementBounds(s);
    expect(bounds.y).toEqual([-88, 70]);
    const drag = startPlaceDrag(spherePoint(0, 0), s);
    if (!drag) throw new Error("expected a drag");
    const down = continuePlaceDrag(drag, spherePoint(0, -80), s);
    expect(down.placement.imageY).toBe(70);
    const back = continuePlaceDrag(down.drag, spherePoint(0, -71), s);
    expect(back.placement.imageY).toBeCloseTo(60);
  });

  it("clamps flat placements to ±100 %", () => {
    const s = settings({ shape: "circle", width: 100, height: 100, imageX: 90 });
    const drag = startPlaceDrag([0, 0, 1], s);
    if (!drag) throw new Error("expected a drag");
    const step = continuePlaceDrag(drag, [30, -10, 1], s);
    expect(step.placement).toEqual({ imageX: 100, imageY: 10 });
  });

  it("ignores hits that can't be mapped", () => {
    const s = settings();
    const drag = startPlaceDrag(spherePoint(0, 0), s);
    if (!drag) throw new Error("expected a drag");
    const step = continuePlaceDrag(drag, [0, 0, 0], s);
    expect(step.drag).toBe(drag);
    expect(step.placement).toEqual({ imageX: 0, imageY: 0 });
  });
});

describe("wheelToScale", () => {
  it("shrinks on scroll down and grows on scroll up", () => {
    expect(wheelToScale(60, 0, 100).imageScale).toBe(52);
    expect(wheelToScale(60, 0, -100).imageScale).toBe(70);
  });

  it("adds up small trackpad deltas instead of losing them", () => {
    let scale = 60;
    let pending = 0;
    for (let i = 0; i < 50; i++) ({ imageScale: scale, pending } = wheelToScale(scale, pending, 2));
    // 50 × 2 px = one 100 px notch.
    expect(scale).toBe(wheelToScale(60, 0, 100).imageScale);
  });

  it("stops at the limits without building up scroll there", () => {
    const top = wheelToScale(150, 0, -5000);
    expect(top).toEqual({ imageScale: 150, pending: 0 });
    // Scrolling back down responds straight away.
    expect(wheelToScale(top.imageScale, top.pending, 100).imageScale).toBeLessThan(150);
    expect(wheelToScale(10, 0, 5000).imageScale).toBe(10);
  });
});
