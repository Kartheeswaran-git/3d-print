import { describe, expect, it } from "vitest";
import { createShapeTest } from "@/lib/geometry/shapes";
import type { CoverageMask, FlatShape, ShapeParams } from "@/lib/geometry/types";
import { shapeOutline, type OutlineLoop } from "./contour";

function shape(kind: FlatShape, extra: Partial<ShapeParams> = {}): ShapeParams {
  return { shape: kind, crescent: 0.4, outerRadius: 0.9, innerRadius: 0.82, offsetX: 0.36, offsetY: 0, rotationDeg: 0, ...extra };
}

/** Normalised shape coords (x right, y down, 1 = half the shorter side) of a u, v point. */
function normalised([u, v]: [number, number], W: number, H: number): [number, number] {
  const m = Math.min(W, H);
  return [((2 * u - 1) * W) / m, ((2 * v - 1) * H) / m];
}

const onPieceEdge = ([u, v]: [number, number], eps = 1e-3) => u < eps || u > 1 - eps || v < eps || v > 1 - eps;

/** Every point has both inside and outside samples within `r` (it lies on the boundary). */
function expectOnBoundary(loops: OutlineLoop[], W: number, H: number, s: ShapeParams, r = 2e-3) {
  const test = createShapeTest(W, H, s);
  const inside = (u: number, v: number) => u >= 0 && u <= 1 && v >= 0 && v <= 1 && test(u, v);
  for (const loop of loops) {
    for (const [u, v] of loop) {
      const around = [
        [r, 0],
        [-r, 0],
        [0, r],
        [0, -r],
        [r, r],
        [-r, -r],
        [r, -r],
        [-r, r],
      ].map(([du, dv]) => inside(u + du, v + dv));
      expect(around.some(Boolean), `inside near ${u}, ${v}`).toBe(true);
      expect(around.some((x) => !x), `outside near ${u}, ${v}`).toBe(true);
    }
  }
}

describe("shapeOutline", () => {
  it("outlines a rectangle along the piece edges", () => {
    const loops = shapeOutline(150, 100, shape("rectangle"));
    expect(loops).toHaveLength(1);
    const [loop] = loops;
    expect(loop.every((p) => onPieceEdge(p, 1e-6))).toBe(true);
    // Collinear points are dropped: the four corners remain.
    expect(loop.length).toBeLessThanOrEqual(8);
    const us = loop.map((p) => p[0]);
    const vs = loop.map((p) => p[1]);
    expect(Math.min(...us)).toBeCloseTo(0, 5);
    expect(Math.max(...us)).toBeCloseTo(1, 5);
    expect(Math.min(...vs)).toBeCloseTo(0, 5);
    expect(Math.max(...vs)).toBeCloseTo(1, 5);
  });

  it("puts a circle's outline on its radius", () => {
    const s = shape("circle", { outerRadius: 0.8 });
    const loops = shapeOutline(100, 100, s);
    expect(loops).toHaveLength(1);
    expect(loops[0].length).toBeGreaterThan(100);
    for (const p of loops[0]) expect(Math.hypot(...normalised(p, 100, 100))).toBeCloseTo(0.8, 2);
    expectOnBoundary(loops, 100, 100, s);
  });

  it("clips shapes to the piece", () => {
    const s = shape("circle", { outerRadius: 1.15 });
    const loops = shapeOutline(100, 100, s);
    expect(loops).toHaveLength(1);
    for (const p of loops[0]) {
      const r = Math.hypot(...normalised(p, 100, 100));
      expect(Math.abs(r - 1.15) < 5e-3 || onPieceEdge(p)).toBe(true);
    }
    expect(loops[0].some((p) => onPieceEdge(p))).toBe(true);
  });

  it("follows the crescent's two arcs", () => {
    const s = shape("crescent");
    const loops = shapeOutline(100, 100, s);
    expect(loops).toHaveLength(1);
    const innerX = s.offsetX + (s.crescent - 0.4);
    for (const p of loops[0]) {
      const [x, y] = normalised(p, 100, 100);
      const outer = Math.abs(Math.hypot(x, y) - s.outerRadius);
      const inner = Math.abs(Math.hypot(x - innerX, y - s.offsetY) - s.innerRadius);
      expect(Math.min(outer, inner)).toBeLessThan(5e-3);
    }
    expectOnBoundary(loops, 100, 100, s);
  });

  it("outlines rotated and irregular shapes on a non-square piece", () => {
    for (const s of [shape("heart", { rotationDeg: 20 }), shape("square", { rotationDeg: 45 }), shape("rounded", { rotationDeg: -30 })]) {
      const loops = shapeOutline(140, 90, s);
      expect(loops.length).toBeGreaterThanOrEqual(1);
      expectOnBoundary(loops, 140, 90, s);
    }
  });

  it("finds every island of a custom mask", () => {
    const size = 64;
    const values = new Float32Array(size * size);
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const a = Math.hypot(x - 16, y - 32) < 10;
        const b = Math.hypot(x - 48, y - 32) < 10;
        values[y * size + x] = a || b ? 1 : 0;
      }
    }
    const mask: CoverageMask = { width: size, height: size, values };
    const s = shape("custom", { mask, maskThreshold: 0.5 });
    const loops = shapeOutline(100, 100, s, 128);
    expect(loops).toHaveLength(2);
    expectOnBoundary(loops, 100, 100, s, 0.01);
  });

  it("is empty when nothing is solid or the size is invalid", () => {
    expect(shapeOutline(100, 100, shape("custom"))).toEqual([]);
    expect(shapeOutline(0, 100, shape("circle"))).toEqual([]);
    expect(shapeOutline(100, Number.NaN, shape("circle"))).toEqual([]);
  });
});
