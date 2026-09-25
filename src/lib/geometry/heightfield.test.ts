import { describe, expect, it } from "vitest";
import {
  buildCellMask,
  buildFieldCellMask,
  buildFlatMesh,
  luminanceToHeights,
  MAX_OUTLINE_SHIFT,
  MIN_SNAPPED_AREA_RATIO,
  resolveDiagonalContacts,
  snapOutline,
} from "./heightfield";
import { checkManifold } from "./manifold";
import { createShapeTest, type ShapeTest } from "./shapes";
import { computeBounds } from "./stats";
import { field, orientationErrors, rng, signedVolume } from "./test-helpers";
import type { MeshData, ShapeParams } from "./types";

function hasCheckerBlock(cells: Uint8Array, cols: number, rows: number): boolean {
  for (let y = 0; y < rows - 1; y++) {
    for (let x = 0; x < cols - 1; x++) {
      const i = y * cols + x;
      const a = cells[i], b = cells[i + 1], c = cells[i + cols], d = cells[i + cols + 1];
      if (a === d && b === c && a !== b) return true;
    }
  }
  return false;
}

describe("luminanceToHeights", () => {
  it("maps min + (1 - lum^gamma)·(max - min)", () => {
    const lum = { width: 4, height: 1, values: new Float32Array([0, 0.25, 1, 0.5]) };
    const h = luminanceToHeights(lum, { minThickness: 0.8, maxThickness: 3, gamma: 2 });
    expect(Array.from(h.values)).toEqual(
      [0.8 + 2.2, 0.8 + (1 - 0.0625) * 2.2, 0.8, 0.8 + 0.75 * 2.2].map((v) => Math.fround(v)),
    );
    expect(h.width).toBe(4);
    expect(h.values).not.toBe(lum.values);
  });

  it("clamps out-of-range luminance", () => {
    const lum = { width: 3, height: 1, values: new Float32Array([-1, 2, Number.NaN]) };
    const h = luminanceToHeights(lum, { minThickness: 1, maxThickness: 2, gamma: 1 });
    expect(Array.from(h.values)).toEqual([2, 1, 2]);
  });
});

describe("buildCellMask", () => {
  it("samples at cell centres", () => {
    const seen: [number, number][] = [];
    const cells = buildCellMask(2, 2, (u, v) => {
      seen.push([u, v]);
      return u < 0.5 && v > 0.5;
    });
    expect(seen).toEqual([
      [0.25, 0.25],
      [0.75, 0.25],
      [0.25, 0.75],
      [0.75, 0.75],
    ]);
    expect(Array.from(cells)).toEqual([0, 0, 1, 0]);
  });

  it("buildFieldCellMask thresholds the mean of each cell's corners", () => {
    const f = field(3, 2, (x) => (x === 0 ? 1 : 0));
    // Left cell corners: 1,0,1,0 → 0.5; right cell: 0.
    expect(Array.from(buildFieldCellMask(f, 0.49))).toEqual([1, 0]);
    expect(Array.from(buildFieldCellMask(f, 0.5))).toEqual([0, 0]);
  });
});

describe("resolveDiagonalContacts", () => {
  it("resolves a full checkerboard until no diagonal-only contact remains", () => {
    const cols = 9, rows = 7;
    const cells = new Uint8Array(cols * rows);
    for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) cells[y * cols + x] = (x + y) % 2 === 0 ? 1 : 0;
    const before = cells.reduce((s, c) => s + c, 0);
    const filled = resolveDiagonalContacts(cells, cols, rows);
    expect(filled).toBeGreaterThan(0);
    expect(cells.reduce((s, c) => s + c, 0)).toBe(before + filled);
    expect(hasCheckerBlock(cells, cols, rows)).toBe(false);
    // Idempotent.
    expect(resolveDiagonalContacts(cells, cols, rows)).toBe(0);
  });

  it("fills exactly one cell for a single diagonal pair and leaves solid cells alone", () => {
    const cells = new Uint8Array([1, 0, 0, 1]);
    expect(resolveDiagonalContacts(cells, 2, 2)).toBe(1);
    expect(Array.from(cells)).toEqual([1, 1, 0, 1]);
    const anti = new Uint8Array([0, 1, 1, 0]);
    expect(resolveDiagonalContacts(anti, 2, 2)).toBe(1);
    expect(Array.from(anti)).toEqual([1, 1, 1, 0]);
  });

  it("handles random noise masks", () => {
    const r = rng(42);
    const cols = 40, rows = 30;
    const cells = new Uint8Array(cols * rows).map(() => (r() < 0.45 ? 1 : 0));
    resolveDiagonalContacts(cells, cols, rows);
    expect(hasCheckerBlock(cells, cols, rows)).toBe(false);
  });
});

describe("buildFlatMesh", () => {
  it("builds an exact closed box for a full rectangle with constant relief", () => {
    const w = 11, h = 6;
    const heights = field(w, h, () => 2);
    const cells = new Uint8Array((w - 1) * (h - 1)).fill(1);
    const mesh = buildFlatMesh({ heights, cells, widthMm: 50, heightMm: 20, baseMm: 1 });
    const report = checkManifold(mesh);
    expect(report).toEqual({ watertight: true, boundaryEdges: 0, nonManifoldEdges: 0, degenerateTriangles: 0 });
    expect(orientationErrors(mesh)).toBe(0);
    expect(signedVolume(mesh)).toBeCloseTo(50 * 20 * 3, 3);
    expect(mesh.activeCells).toBe(50);
    expect(computeBounds(mesh.positions)).toEqual({ min: [-25, -10, 0], max: [25, 10, 3] });
  });

  it("follows the coordinate conventions, zOffset and minHeight clamp", () => {
    const heights = { width: 2, height: 2, values: new Float32Array([0, 1, 2, 0.01]) };
    const mesh = buildFlatMesh({
      heights,
      cells: new Uint8Array([1]),
      widthMm: 10,
      heightMm: 4,
      baseMm: 0.5,
      zOffsetMm: 2,
      withUvs: true,
      withThickness: true,
    });
    // Top vertices first (row-major), then their bottom twins.
    const p = Array.from(mesh.positions);
    expect(p.slice(0, 12)).toEqual([-5, 2, 2.55, 5, 2, 3.5, -5, -2, 4.5, 5, -2, 2.55].map(Math.fround));
    expect(p.slice(12, 24)).toEqual([-5, 2, 2, 5, 2, 2, -5, -2, 2, 5, -2, 2]);
    expect(Array.from(mesh.uvs ?? [])).toEqual([0, 1, 1, 1, 0, 0, 1, 0, 0, 1, 1, 1, 0, 0, 1, 0]);
    expect(Array.from(mesh.thickness ?? [])).toEqual([0.55, 1.5, 2.5, 0.55, 0.55, 1.5, 2.5, 0.55].map(Math.fround));
    expect(checkManifold(mesh).watertight).toBe(true);
    expect(signedVolume(mesh)).toBeGreaterThan(0);
  });

  it("stays watertight with diagonal-only contacts (FIXES G4) without mutating the caller's cells", () => {
    const cols = 6, rows = 6;
    const cells = new Uint8Array(cols * rows);
    for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) cells[y * cols + x] = (x + y) % 2;
    const copy = cells.slice();
    const heights = field(cols + 1, rows + 1, (x, y) => 0.5 + ((x * 7 + y * 3) % 5) / 4);
    const mesh = buildFlatMesh({ heights, cells, widthMm: 30, heightMm: 30, baseMm: 0.6 });
    expect(cells).toEqual(copy);
    expect(checkManifold(mesh).watertight).toBe(true);
    expect(orientationErrors(mesh)).toBe(0);
    expect(signedVolume(mesh)).toBeGreaterThan(0);
  });

  it("rejects empty masks, bad sizes and mismatched cell arrays", () => {
    const heights = field(3, 3, () => 1);
    expect(() => buildFlatMesh({ heights, cells: new Uint8Array(4), widthMm: 10, heightMm: 10, baseMm: 1 })).toThrow(
      /no printable area/,
    );
    expect(() => buildFlatMesh({ heights, cells: new Uint8Array(4).fill(1), widthMm: 0, heightMm: 10, baseMm: 1 })).toThrow(
      /greater than 0/,
    );
    expect(() => buildFlatMesh({ heights, cells: new Uint8Array(3), widthMm: 10, heightMm: 10, baseMm: 1 })).toThrow(
      /cell mask/,
    );
    expect(() =>
      buildFlatMesh({ heights: field(1, 3, () => 1), cells: new Uint8Array(0), widthMm: 10, heightMm: 10, baseMm: 1 }),
    ).toThrow(/at least 2 × 2/);
  });
});

describe("outline snapping (REVIEW R3)", () => {
  // Square 80 mm piece on an 81 × 81 point grid: 1 cell = 1 mm, normalised shape coords x = px / 40, y = −py / 40.
  const N = 81;
  const SIZE = 80;
  const HALF = SIZE / 2;
  const heights = field(N, N, (x, y) => 0.4 + ((x * 3 + y * 5) % 7) / 10);
  const params = (patch: Partial<ShapeParams>): ShapeParams => ({
    shape: "circle",
    crescent: 0.4,
    outerRadius: 0.95,
    innerRadius: 0.82,
    offsetX: 0.18,
    offsetY: -0.08,
    rotationDeg: 0,
    ...patch,
  });

  function build(inside: ShapeTest, snap: boolean): MeshData {
    const cells = buildCellMask(N - 1, N - 1, inside);
    return buildFlatMesh({ heights, cells, widthMm: SIZE, heightMm: SIZE, baseMm: 0.6, inside: snap ? inside : undefined });
  }

  /** Top vertices used by a wall (a triangle mixing top and bottom vertices), as normalised shape coords. */
  function outlinePoints(mesh: MeshData): [number, number][] {
    const half = mesh.positions.length / 6;
    const seen = new Set<number>();
    const idx = mesh.indices;
    for (let t = 0; t < idx.length; t += 3) {
      const tri = [idx[t], idx[t + 1], idx[t + 2]];
      if (tri.some((i) => i < half) && tri.some((i) => i >= half)) for (const i of tri) if (i < half) seen.add(i);
    }
    return [...seen].map((i) => [mesh.positions[i * 3] / HALF, -mesh.positions[i * 3 + 1] / HALF]);
  }

  /** Smallest twice-area of the top-face triangles (mm²; an unsnapped triangle has 1), negative when flipped. */
  function minTopTwiceArea(mesh: MeshData): number {
    const half = mesh.positions.length / 6;
    const p = mesh.positions;
    let min = Infinity;
    for (let t = 0; t < mesh.indices.length; t += 3) {
      const [a, b, c] = [mesh.indices[t], mesh.indices[t + 1], mesh.indices[t + 2]];
      if (a >= half || b >= half || c >= half) continue;
      const cross = (p[b * 3] - p[a * 3]) * (p[c * 3 + 1] - p[a * 3 + 1]) - (p[b * 3 + 1] - p[a * 3 + 1]) * (p[c * 3] - p[a * 3]);
      min = Math.min(min, cross);
    }
    return min;
  }

  /** Distance to the analytic outline, and the piece's width there (both normalised units). */
  type Contour = (p: [number, number]) => { distance: number; width: number };

  const circle = (r: number): Contour => ([x, y]) => ({ distance: Math.abs(Math.hypot(x, y) - r), width: 2 * r });

  /**
   * Crescent = outer disc minus inner disc. The outline is the outer arc outside the inner disc plus the inner
   * arc inside the outer disc, ending at the two tips; the width is measured from the nearest outline point
   * to the other circle.
   */
  function crescent(s: ShapeParams): Contour {
    const ro = s.outerRadius;
    const ri = s.innerRadius;
    const cx = s.offsetX + (s.crescent - 0.4);
    const cy = s.offsetY;
    const d = Math.hypot(cx, cy);
    const along = (ro * ro - ri * ri + d * d) / (2 * d);
    const across = Math.sqrt(ro * ro - along * along);
    const tips = [1, -1].map((k) => [(along * cx - k * across * cy) / d, (along * cy + k * across * cx) / d]);
    return ([x, y]) => {
      const r = Math.hypot(x, y);
      const rInner = Math.hypot(x - cx, y - cy);
      const outer = [(x / r) * ro, (y / r) * ro];
      const inner = [cx + ((x - cx) / rInner) * ri, cy + ((y - cy) / rInner) * ri];
      // The nearest point of each full circle counts only when it lies on that circle's arc of the outline.
      const toOuter = Math.hypot(outer[0] - cx, outer[1] - cy) >= ri ? Math.abs(r - ro) : Infinity;
      const toInner = Math.hypot(inner[0], inner[1]) <= ro ? Math.abs(rInner - ri) : Infinity;
      const toTip = Math.min(...tips.map(([tx, ty]) => Math.hypot(x - tx, y - ty)));
      const distance = Math.min(toOuter, toInner, toTip);
      if (distance === toTip) return { distance, width: 0 };
      const width = toOuter <= toInner ? Math.hypot(outer[0] - cx, outer[1] - cy) - ri : ro - Math.hypot(inner[0], inner[1]);
      return { distance, width };
    };
  }

  const CIRCLE = params({ shape: "circle", outerRadius: 0.9 });
  const CRESCENT = params({ shape: "crescent" });
  const cases: [string, ShapeParams, Contour][] = [
    ["circle", CIRCLE, circle(0.9)],
    ["crescent", CRESCENT, crescent(CRESCENT)],
  ];
  for (const [label, shape, contour] of cases) {
    it(`moves the ${label} outline onto the analytic contour, closed and without flipped triangles`, () => {
      const inside = createShapeTest(SIZE, SIZE, shape);
      const before = build(inside, false);
      const after = build(inside, true);
      for (const mesh of [before, after]) {
        expect(checkManifold(mesh)).toEqual({ watertight: true, boundaryEdges: 0, nonManifoldEdges: 0, degenerateTriangles: 0 });
        expect(orientationErrors(mesh)).toBe(0);
        expect(signedVolume(mesh)).toBeGreaterThan(0);
      }
      // Same vertices, triangles and walls: only positions and the split of some outline cells change.
      expect(after.indices.length).toBe(before.indices.length);
      expect(after.positions.length).toBe(before.positions.length);
      expect(minTopTwiceArea(after)).toBeGreaterThanOrEqual(MIN_SNAPPED_AREA_RATIO - 1e-4);

      // Distances in cells (1 cell = 1 mm = 1 / HALF normalised units). Where the piece is under two cells
      // wide (the crescent's tips) the outline can't follow it without degenerate triangles, so the >3×
      // target applies where it is resolvable, and the tips must still improve.
      const worst = (mesh: MeshData, resolvable: boolean) =>
        Math.max(
          ...outlinePoints(mesh)
            .map(contour)
            .filter((c) => c.width * HALF >= 2 === resolvable)
            .map((c) => c.distance * HALF),
          0,
        );
      const maxBefore = worst(before, true);
      const maxAfter = worst(after, true);
      expect(maxBefore).toBeGreaterThan(0.5);
      expect(maxAfter).toBeLessThan(0.1);
      expect(maxAfter * 3).toBeLessThan(maxBefore);
      expect(worst(after, false)).toBeLessThanOrEqual(worst(before, false));
      expect(Math.max(worst(after, true), worst(after, false))).toBeLessThan(Math.max(worst(before, true), worst(before, false)) / 1.5);

      // In-plane only: every vertex keeps its z, and top/bottom twins stay stacked.
      const half = after.positions.length / 6;
      for (let k = 0; k < half * 2; k++) expect(after.positions[k * 3 + 2]).toBe(before.positions[k * 3 + 2]);
      for (let k = 0; k < half; k++) {
        expect(after.positions[(k + half) * 3]).toBe(after.positions[k * 3]);
        expect(after.positions[(k + half) * 3 + 1]).toBe(after.positions[k * 3 + 1]);
        expect(Math.abs(after.positions[k * 3] - before.positions[k * 3])).toBeLessThanOrEqual(MAX_OUTLINE_SHIFT + 1e-5);
        expect(Math.abs(after.positions[k * 3 + 1] - before.positions[k * 3 + 1])).toBeLessThanOrEqual(MAX_OUTLINE_SHIFT + 1e-5);
      }
    });
  }

  it("is deterministic and leaves shapes that fill the grid untouched", () => {
    const crescent = createShapeTest(SIZE, SIZE, params({ shape: "crescent", crescent: 0.72, innerRadius: 0.95, rotationDeg: 33 }));
    expect(build(crescent, true).positions).toEqual(build(crescent, true).positions);
    const all = createShapeTest(SIZE, SIZE, params({ shape: "rectangle" }));
    expect(build(all, true).positions).toEqual(build(all, false).positions);
    const cells = new Uint8Array((N - 1) * (N - 1)).fill(1);
    const snap = snapOutline(cells, N - 1, N - 1, all);
    expect(snap.shift.every((v) => v === 0)).toBe(true);
    expect(snap.flip.every((v) => v === 0)).toBe(true);
  });

  it("slides points on the grid border only along it", () => {
    // A circle larger than the piece is clipped by the border.
    const inside = createShapeTest(SIZE, SIZE, params({ shape: "circle", outerRadius: 1.2 }));
    const cells = buildCellMask(N - 1, N - 1, inside);
    const { shift } = snapOutline(cells, N - 1, N - 1, inside);
    let slid = 0;
    for (let i = 0; i < N; i++) {
      for (const p of [i, (N - 1) * N + i]) expect(shift[p * 2 + 1]).toBe(0); // top and bottom rows
      for (const p of [i * N, i * N + N - 1]) expect(shift[p * 2]).toBe(0); // left and right columns
      if (shift[i * 2] !== 0) slid++;
    }
    expect(slid).toBeGreaterThan(0);
    const mesh = build(inside, true);
    expect(checkManifold(mesh).watertight).toBe(true);
    const bounds = computeBounds(mesh.positions);
    expect(bounds.min.slice(0, 2)).toEqual([-HALF, -HALF]);
    expect(bounds.max.slice(0, 2)).toEqual([HALF, HALF]);
  });

  it("keeps specks, one-cell strips and random masks valid (shifts shrink until no triangle is too thin)", () => {
    const cols = 24;
    const rows = 18;
    const r = rng(7);
    // Tiny discs (far smaller than a cell) at a few cell centres, a one-cell-wide diagonal band and noise.
    const specks = Array.from({ length: 8 }, () => [Math.floor(r() * cols) + 0.5, Math.floor(r() * rows) + 0.5]);
    const inside: ShapeTest = (u, v) => {
      const gx = u * cols;
      const gy = v * rows;
      if (specks.some(([sx, sy]) => Math.hypot(gx - sx, gy - sy) < 0.05)) return true;
      if (Math.abs(gx - gy - 3) < 0.3) return true;
      return Math.sin(gx * 1.7) * Math.cos(gy * 1.3) > 0.6;
    };
    const cells = buildCellMask(cols, rows, inside);
    const mesh = buildFlatMesh({
      heights: field(cols + 1, rows + 1, () => 1),
      cells,
      widthMm: 48,
      heightMm: 36,
      baseMm: 0.5,
      inside,
    });
    expect(checkManifold(mesh).watertight).toBe(true);
    expect(orientationErrors(mesh)).toBe(0);
    expect(signedVolume(mesh)).toBeGreaterThan(0);
    // 1 cell = 2 mm here, so an unsnapped triangle has twice-area 4 mm².
    expect(minTopTwiceArea(mesh)).toBeGreaterThanOrEqual(4 * MIN_SNAPPED_AREA_RATIO - 1e-4);
  });
});
