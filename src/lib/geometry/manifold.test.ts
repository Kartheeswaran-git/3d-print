import { describe, expect, it } from "vitest";
import { checkManifold, mergeManifoldReports } from "./manifold";
import { meshStats } from "./stats";

/** Unit tetrahedron, CCW outward. */
const tetra = () => ({
  positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1]),
  indices: new Uint32Array([0, 2, 1, 0, 1, 3, 0, 3, 2, 1, 2, 3]),
});

describe("checkManifold", () => {
  it("accepts a closed tetrahedron", () => {
    expect(checkManifold(tetra())).toEqual({ watertight: true, boundaryEdges: 0, nonManifoldEdges: 0, degenerateTriangles: 0 });
  });

  it("counts boundary edges of an open surface", () => {
    const mesh = tetra();
    const open = { positions: mesh.positions, indices: mesh.indices.slice(0, 9) };
    const report = checkManifold(open);
    expect(report.watertight).toBe(false);
    expect(report.boundaryEdges).toBe(3);
    expect(report.nonManifoldEdges).toBe(0);
  });

  it("counts edges shared by more than two triangles", () => {
    const mesh = tetra();
    const indices = new Uint32Array([...mesh.indices, 0, 1, 2]);
    const report = checkManifold({ positions: mesh.positions, indices });
    expect(report.nonManifoldEdges).toBe(3);
    expect(report.watertight).toBe(false);
  });

  it("counts degenerate triangles (repeated index, zero area, out of range)", () => {
    const positions = new Float32Array([0, 0, 0, 1, 0, 0, 2, 0, 0, 0, 1, 0]);
    const report = checkManifold({ positions, indices: new Uint32Array([0, 0, 1, 0, 1, 2, 0, 1, 9]) });
    expect(report.degenerateTriangles).toBe(3);
    expect(report.watertight).toBe(false);
  });

  it("handles large fans (sorted bucket path)", () => {
    // Closed double cone: two fans of 100 triangles around a ring.
    const n = 100;
    const positions = new Float32Array((n + 2) * 3);
    for (let i = 0; i < n; i++) {
      positions[i * 3] = Math.cos((i / n) * Math.PI * 2);
      positions[i * 3 + 1] = Math.sin((i / n) * Math.PI * 2);
    }
    positions[n * 3 + 2] = 1;
    positions[(n + 1) * 3 + 2] = -1;
    const indices: number[] = [];
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      indices.push(n, i, j, n + 1, j, i);
    }
    expect(checkManifold({ positions, indices: new Uint32Array(indices) }).watertight).toBe(true);
  });

  it("an empty mesh is not watertight", () => {
    expect(checkManifold({ positions: new Float32Array(), indices: new Uint32Array() }).watertight).toBe(false);
  });

  it("merges reports across parts (FIXES G7)", () => {
    const ok = checkManifold(tetra());
    const bad = { watertight: false, boundaryEdges: 2, nonManifoldEdges: 1, degenerateTriangles: 3 };
    expect(mergeManifoldReports([ok, bad])).toEqual(bad);
    expect(mergeManifoldReports([ok, ok]).watertight).toBe(true);
  });
});

describe("meshStats", () => {
  it("sums counts and unions bounds", () => {
    const a = { ...tetra(), activeCells: 2 };
    const b = { positions: new Float32Array([5, -1, 2, 6, 0, 3, 5, 1, 2]), indices: new Uint32Array([0, 1, 2]), activeCells: 1 };
    const stats = meshStats([a, b], { bytes: 123 });
    expect(stats).toEqual({
      vertices: 7,
      triangles: 5,
      activeCells: 3,
      bounds: { min: [0, -1, 0], max: [6, 1, 3] },
      bytes: 123,
    });
  });
});
