import { describe, expect, it } from "vitest";
import { createShapeTest, insideShape } from "./shapes";
import { blobMask } from "./test-helpers";
import type { FlatShape, ShapeParams } from "./types";

/** Verbatim port of the prototype worker's `shapeAt` (litho-worker.js). */
interface ProtoSettings {
  shape: FlatShape;
  width: number;
  height: number;
  moonRotation: number;
  outerRadius: number;
  innerRadius: number;
  crescent: number;
  moonOffsetX: number;
  moonOffsetY: number;
  maskWidth?: number;
  maskHeight?: number;
}
const clamp = (n: number, min = 0, max = 1) => Math.min(max, Math.max(min, n));
function prototypeShapeAt(u: number, v: number, s: ProtoSettings, customMask: Float32Array | null): boolean {
  const minDim = Math.min(s.width, s.height);
  let x = ((u * 2 - 1) * s.width) / minDim;
  let y = ((v * 2 - 1) * s.height) / minDim;
  const a = (-s.moonRotation * Math.PI) / 180;
  const rx = x * Math.cos(a) - y * Math.sin(a);
  const ry = x * Math.sin(a) + y * Math.cos(a);
  x = rx;
  y = ry;
  if (s.shape === "rectangle") return true;
  if (s.shape === "rounded") {
    const qx = Math.abs(x) - 0.7,
      qy = Math.abs(y) - 0.7;
    return Math.max(qx, qy) <= 0 || Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) <= 0.3;
  }
  if (s.shape === "square") return Math.abs(x) <= 1 && Math.abs(y) <= 1;
  if (s.shape === "circle") return x * x + y * y <= s.outerRadius * s.outerRadius;
  if (s.shape === "heart") {
    const hx = x,
      hy = -y + 0.1;
    return Math.pow(hx * hx + hy * hy - 0.82, 3) - hx * hx * Math.pow(hy, 3) <= 0;
  }
  if (s.shape === "custom") {
    if (!customMask) return false;
    const w = s.maskWidth || Math.round(Math.sqrt(customMask.length));
    const h = s.maskHeight || Math.round(Math.sqrt(customMask.length));
    return customMask[clamp(Math.round(v * (h - 1)), 0, h - 1) * w + clamp(Math.round(u * (w - 1)), 0, w - 1)] > 0.05;
  }
  const innerX = s.moonOffsetX + (s.crescent - 0.4);
  return (
    x * x + y * y <= s.outerRadius * s.outerRadius &&
    (x - innerX) * (x - innerX) + (y - s.moonOffsetY) * (y - s.moonOffsetY) > s.innerRadius * s.innerRadius
  );
}

const SHAPES: FlatShape[] = ["crescent", "circle", "heart", "rounded", "rectangle", "square", "custom"];

const PARAM_SETS = [
  { width: 100, height: 100, rot: 0, outer: 0.95, inner: 0.82, crescent: 0.4, ox: 0.18, oy: -0.08 },
  { width: 160, height: 90, rot: 30, outer: 1.1, inner: 0.6, crescent: 0.7, ox: -0.3, oy: 0.2 },
  { width: 60, height: 140, rot: -135, outer: 0.7, inner: 1.0, crescent: 0.15, ox: 0.8, oy: -0.6 },
];

describe("insideShape", () => {
  const mask = blobMask(37, 23, 7);

  for (const shape of SHAPES) {
    it(`matches the prototype formulas for ${shape}`, () => {
      for (const p of PARAM_SETS) {
        const params: ShapeParams = {
          shape,
          crescent: p.crescent,
          outerRadius: p.outer,
          innerRadius: p.inner,
          offsetX: p.ox,
          offsetY: p.oy,
          rotationDeg: p.rot,
          mask,
          maskThreshold: 0.05,
        };
        const proto: ProtoSettings = {
          shape,
          width: p.width,
          height: p.height,
          moonRotation: p.rot,
          outerRadius: p.outer,
          innerRadius: p.inner,
          crescent: p.crescent,
          moonOffsetX: p.ox,
          moonOffsetY: p.oy,
          maskWidth: mask.width,
          maskHeight: mask.height,
        };
        let inside = 0;
        const steps = 61;
        for (let j = 0; j <= steps; j++) {
          for (let i = 0; i <= steps; i++) {
            const u = i / steps;
            const v = j / steps;
            const expected = prototypeShapeAt(u, v, proto, mask.values);
            expect(insideShape(u, v, p.width, p.height, params)).toBe(expected);
            if (expected) inside++;
          }
        }
        // Every shape covers part of the piece, and (except rectangle) not all of it at these settings.
        expect(inside).toBeGreaterThan(0);
        if (shape !== "rectangle" && !(shape === "square" && p.width === p.height)) {
          expect(inside).toBeLessThan((steps + 1) ** 2);
        }
      }
    });
  }

  it("uses maskThreshold (default 0.5) for custom masks and ignores rotation", () => {
    const m = { width: 2, height: 1, values: new Float32Array([0.4, 0.6]) };
    const base: ShapeParams = {
      shape: "custom",
      crescent: 0.4,
      outerRadius: 1,
      innerRadius: 0.8,
      offsetX: 0,
      offsetY: 0,
      rotationDeg: 90,
      mask: m,
    };
    expect(insideShape(0, 0.5, 100, 100, base)).toBe(false);
    expect(insideShape(1, 0.5, 100, 100, base)).toBe(true);
    expect(insideShape(0, 0.5, 100, 100, { ...base, maskThreshold: 0.3 })).toBe(true);
    expect(insideShape(1, 0.5, 100, 100, { ...base, mask: null })).toBe(false);
  });

  it("never returns NaN-driven results for zero-sized pieces", () => {
    const params: ShapeParams = {
      shape: "circle",
      crescent: 0.4,
      outerRadius: 1,
      innerRadius: 0.8,
      offsetX: 0,
      offsetY: 0,
      rotationDeg: 0,
    };
    expect(insideShape(0.5, 0.5, 0, 100, params)).toBe(false);
    expect(createShapeTest(100, Number.NaN, params)(0.5, 0.5)).toBe(false);
  });
});
