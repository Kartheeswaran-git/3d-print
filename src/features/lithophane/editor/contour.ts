import { createShapeTest } from "@/lib/geometry/shapes";
import type { ShapeParams } from "@/lib/geometry/types";

/**
 * Outline of a flat piece's printable shape, for the Layout editor's dashed shape line (PURE).
 *
 * Marching squares over the exact shape test (`createShapeTest`, clipped to the piece rectangle), with
 * every crossing refined by bisection along its cell edge, so the outline lies on the true boundary
 * without duplicating the shape formulas. Returns closed loops in normalised piece coords (u right,
 * v down, 0..1).
 */

export type OutlineLoop = [number, number][];

/** Cells along the longer side of the piece; crossings are then refined to 1/4096 of a cell. */
export const OUTLINE_CELLS = 192;
const BISECTION_STEPS = 12;

/** Closed outline loops of the shape on a W × H mm piece (u, v in 0..1). Empty when nothing is solid. */
export function shapeOutline(widthMm: number, heightMm: number, shape: ShapeParams, cells = OUTLINE_CELLS): OutlineLoop[] {
  if (!(widthMm > 0) || !(heightMm > 0) || !Number.isFinite(widthMm) || !Number.isFinite(heightMm)) return [];
  const test = createShapeTest(widthMm, heightMm, shape);
  const inside = (u: number, v: number) => u >= 0 && u <= 1 && v >= 0 && v <= 1 && test(u, v);

  const n = Math.max(2, Math.floor(cells));
  const nu = widthMm >= heightMm ? n : Math.max(2, Math.round((n * widthMm) / heightMm));
  const nv = heightMm >= widthMm ? n : Math.max(2, Math.round((n * heightMm) / widthMm));
  // Samples i = 0..nu + 2 sit at u = (i − 1) / nu: a ring of samples outside the piece closes every loop.
  const cols = nu + 3;
  const rows = nv + 3;
  const su = (i: number) => (i - 1) / nu;
  const sv = (j: number) => (j - 1) / nv;
  const solid = new Uint8Array(cols * rows);
  for (let j = 1; j < rows - 1; j++) {
    for (let i = 1; i < cols - 1; i++) solid[j * cols + i] = inside(su(i), sv(j)) ? 1 : 0;
  }

  // Crossing point on the edge between two samples of different state, refined by bisection.
  const points = new Map<number, [number, number]>();
  const crossing = (key: number, i0: number, j0: number, i1: number, j1: number): number => {
    if (points.has(key)) return key;
    let inU = su(i0);
    let inV = sv(j0);
    let outU = su(i1);
    let outV = sv(j1);
    if (solid[j0 * cols + i0] === 0) {
      [inU, outU] = [outU, inU];
      [inV, outV] = [outV, inV];
    }
    for (let k = 0; k < BISECTION_STEPS; k++) {
      const mu = (inU + outU) / 2;
      const mv = (inV + outV) / 2;
      if (inside(mu, mv)) {
        inU = mu;
        inV = mv;
      } else {
        outU = mu;
        outV = mv;
      }
    }
    const u = Math.min(1, Math.max(0, (inU + outU) / 2));
    const v = Math.min(1, Math.max(0, (inV + outV) / 2));
    points.set(key, [u, v]);
    return key;
  };
  // Edge keys: horizontal edge (i, j)–(i + 1, j) → 2·idx, vertical edge (i, j)–(i, j + 1) → 2·idx + 1.
  const top = (i: number, j: number) => crossing((j * cols + i) * 2, i, j, i + 1, j);
  const bottom = (i: number, j: number) => crossing(((j + 1) * cols + i) * 2, i, j + 1, i + 1, j + 1);
  const left = (i: number, j: number) => crossing((j * cols + i) * 2 + 1, i, j, i, j + 1);
  const right = (i: number, j: number) => crossing((j * cols + i + 1) * 2 + 1, i + 1, j, i + 1, j + 1);

  // Undirected graph of crossings: every crossing on a closed loop has exactly two neighbours.
  const links = new Map<number, number[]>();
  const link = (a: number, b: number) => {
    if (a === b) return;
    const la = links.get(a);
    if (la) la.push(b);
    else links.set(a, [b]);
    const lb = links.get(b);
    if (lb) lb.push(a);
    else links.set(b, [a]);
  };

  for (let j = 0; j < rows - 1; j++) {
    for (let i = 0; i < cols - 1; i++) {
      const tl = solid[j * cols + i];
      const tr = solid[j * cols + i + 1];
      const br = solid[(j + 1) * cols + i + 1];
      const bl = solid[(j + 1) * cols + i];
      const code = (tl << 3) | (tr << 2) | (br << 1) | bl;
      if (code === 0 || code === 15) continue;
      if (code === 5 || code === 10) {
        // Saddle: the cell centre decides whether the two solid corners connect.
        const centreSolid = inside((su(i) + su(i + 1)) / 2, (sv(j) + sv(j + 1)) / 2);
        const tlSolid = code === 10;
        if (centreSolid === tlSolid) {
          // Cut off the top-right and bottom-left corners.
          link(top(i, j), right(i, j));
          link(bottom(i, j), left(i, j));
        } else {
          // Cut off the top-left and bottom-right corners.
          link(left(i, j), top(i, j));
          link(right(i, j), bottom(i, j));
        }
        continue;
      }
      const crossed: number[] = [];
      if (tl !== tr) crossed.push(top(i, j));
      if (tr !== br) crossed.push(right(i, j));
      if (bl !== br) crossed.push(bottom(i, j));
      if (tl !== bl) crossed.push(left(i, j));
      if (crossed.length === 2) link(crossed[0], crossed[1]);
    }
  }

  // Walk the loops.
  const loops: OutlineLoop[] = [];
  const visited = new Set<number>();
  for (const startKey of links.keys()) {
    if (visited.has(startKey)) continue;
    const loop: OutlineLoop = [];
    let previous = -1;
    let current = startKey;
    while (!visited.has(current)) {
      visited.add(current);
      const point = points.get(current);
      if (point) loop.push(point);
      const next: number | undefined = (links.get(current) ?? []).find((k) => k !== previous && !visited.has(k));
      if (next === undefined) break;
      previous = current;
      current = next;
    }
    const simplified = dropCollinear(loop);
    if (simplified.length >= 3) loops.push(simplified);
  }
  return loops;
}

/** Remove points that lie on the straight line between their neighbours (long straight edges). */
function dropCollinear(loop: OutlineLoop): OutlineLoop {
  if (loop.length < 4) return loop;
  const out: OutlineLoop = [];
  const n = loop.length;
  for (let k = 0; k < n; k++) {
    const a = out.length ? out[out.length - 1] : loop[(k - 1 + n) % n];
    const b = loop[k];
    const c = loop[(k + 1) % n];
    const cross = (b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]);
    const dot = (b[0] - a[0]) * (c[0] - b[0]) + (b[1] - a[1]) * (c[1] - b[1]);
    if (Math.abs(cross) < 1e-10 && dot > 0) continue;
    out.push(b);
  }
  return out;
}
