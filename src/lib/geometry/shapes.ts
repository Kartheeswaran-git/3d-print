import type { ShapeParams } from "./types";

/** Default coverage above which a custom-mask sample counts as solid. */
export const DEFAULT_MASK_THRESHOLD = 0.5;

/** Point-in-shape predicate over the piece, u and v in 0..1 (v = 0 is the top edge). */
export type ShapeTest = (u: number, v: number) => boolean;

const outside: ShapeTest = () => false;

/**
 * Build a reusable point-in-shape test with the rotation and aspect terms precomputed.
 * Same formulas as {@link insideShape}; use this when testing many points.
 */
export function createShapeTest(widthMm: number, heightMm: number, shape: ShapeParams): ShapeTest {
  if (shape.shape === "custom") {
    const mask = shape.mask;
    if (!mask || mask.width < 1 || mask.height < 1 || mask.values.length < mask.width * mask.height) return outside;
    const { width: mw, height: mh, values } = mask;
    const threshold = shape.maskThreshold ?? DEFAULT_MASK_THRESHOLD;
    // Nearest sample; the mask spans the whole piece and is not rotated (prototype behaviour).
    return (u, v) => {
      const px = Math.min(mw - 1, Math.max(0, Math.round(u * (mw - 1))));
      const py = Math.min(mh - 1, Math.max(0, Math.round(v * (mh - 1))));
      return values[py * mw + px] > threshold;
    };
  }
  if (shape.shape === "rectangle") return () => true;

  const minDim = Math.min(widthMm, heightMm);
  if (!(minDim > 0) || !Number.isFinite(widthMm) || !Number.isFinite(heightMm)) return outside;
  const sx = widthMm / minDim;
  const sy = heightMm / minDim;
  const a = (-shape.rotationDeg * Math.PI) / 180;
  const cos = Math.cos(a);
  const sin = Math.sin(a);

  let test: (x: number, y: number) => boolean;
  switch (shape.shape) {
    case "rounded":
      test = (x, y) => {
        const qx = Math.abs(x) - 0.7;
        const qy = Math.abs(y) - 0.7;
        return Math.max(qx, qy) <= 0 || Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) <= 0.3;
      };
      break;
    case "square":
      test = (x, y) => Math.abs(x) <= 1 && Math.abs(y) <= 1;
      break;
    case "circle": {
      const r2 = shape.outerRadius * shape.outerRadius;
      test = (x, y) => x * x + y * y <= r2;
      break;
    }
    case "heart":
      test = (x, y) => {
        const hx = x;
        const hy = -y + 0.1;
        return Math.pow(hx * hx + hy * hy - 0.82, 3) - hx * hx * Math.pow(hy, 3) <= 0;
      };
      break;
    case "crescent":
    default: {
      const outer2 = shape.outerRadius * shape.outerRadius;
      const inner2 = shape.innerRadius * shape.innerRadius;
      const innerX = shape.offsetX + (shape.crescent - 0.4);
      const innerY = shape.offsetY;
      test = (x, y) => {
        const dx = x - innerX;
        const dy = y - innerY;
        return x * x + y * y <= outer2 && dx * dx + dy * dy > inner2;
      };
      break;
    }
  }

  return (u, v) => {
    const x = (u * 2 - 1) * sx;
    const y = (v * 2 - 1) * sy;
    return test(x * cos - y * sin, x * sin + y * cos);
  };
}

/**
 * u,v in 0..1 over the piece (v = 0 top). Normalised coords: x = (2u-1)·W/min(W,H), y = (2v-1)·H/min(W,H),
 * then rotated by -rotationDeg. Formulas match the prototype worker `shapeAt`:
 * crescent = outer circle minus an inner circle centred at (offsetX + crescent - 0.4, offsetY);
 * rounded = |x|,|y| box 0.7 + corner radius 0.3; heart = (hx²+hy²-0.82)³ - hx²·hy³ <= 0 with hx = x, hy = -y + 0.1;
 * square = |x|,|y| <= 1; rectangle = always; circle = r <= outerRadius;
 * custom = nearest mask sample > maskThreshold (default 0.5), not rotated.
 * Returns false for non-positive or non-finite dimensions.
 */
export function insideShape(u: number, v: number, widthMm: number, heightMm: number, shape: ShapeParams): boolean {
  return createShapeTest(widthMm, heightMm, shape)(u, v);
}
