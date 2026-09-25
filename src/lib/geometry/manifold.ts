import type { ManifoldReport, MeshData } from "./types";

/** Twice the triangle area below which a face counts as degenerate (mm²). */
const DEGENERATE_CROSS = 1e-10;

/**
 * Edge-manifold check: every undirected edge must be used by exactly two triangles, and no triangle may be
 * degenerate (repeated or out-of-range index, or zero area).
 *
 * Edges are bucketed by their lower vertex (counting sort into one Uint32Array) instead of a Map keyed by
 * a·V + b, so ~5M triangles need ~60 MB and no per-edge allocations.
 */
export function checkManifold(mesh: MeshData): ManifoldReport {
  const { positions, indices } = mesh;
  const vertexCount = Math.floor(positions.length / 3);
  const triCount = Math.floor(indices.length / 3);
  let degenerateTriangles = 0;

  // Mark bad triangles first so both passes skip them consistently.
  const valid = new Uint8Array(triCount);
  for (let t = 0; t < triCount; t++) {
    const a = indices[t * 3];
    const b = indices[t * 3 + 1];
    const c = indices[t * 3 + 2];
    if (a >= vertexCount || b >= vertexCount || c >= vertexCount || a === b || b === c || a === c) {
      degenerateTriangles++;
      continue;
    }
    const ax = positions[a * 3], ay = positions[a * 3 + 1], az = positions[a * 3 + 2];
    const ux = positions[b * 3] - ax, uy = positions[b * 3 + 1] - ay, uz = positions[b * 3 + 2] - az;
    const vx = positions[c * 3] - ax, vy = positions[c * 3 + 1] - ay, vz = positions[c * 3 + 2] - az;
    const cx = uy * vz - uz * vy;
    const cy = uz * vx - ux * vz;
    const cz = ux * vy - uy * vx;
    // Degenerate faces still contribute their (distinct-index) edges below.
    if (!(Math.sqrt(cx * cx + cy * cy + cz * cz) > DEGENERATE_CROSS)) degenerateTriangles++;
    valid[t] = 1;
  }

  // Counting sort of undirected edges by their lower vertex.
  const offsets = new Uint32Array(vertexCount + 1);
  for (let t = 0; t < triCount; t++) {
    if (!valid[t]) continue;
    const a = indices[t * 3];
    const b = indices[t * 3 + 1];
    const c = indices[t * 3 + 2];
    offsets[a < b ? a : b]++;
    offsets[b < c ? b : c]++;
    offsets[c < a ? c : a]++;
  }
  let sum = 0;
  for (let v = 0; v < vertexCount; v++) {
    const count = offsets[v];
    offsets[v] = sum;
    sum += count;
  }
  offsets[vertexCount] = sum;
  const partners = new Uint32Array(sum);
  const cursor = offsets.slice(0, vertexCount);
  for (let t = 0; t < triCount; t++) {
    if (!valid[t]) continue;
    const a = indices[t * 3];
    const b = indices[t * 3 + 1];
    const c = indices[t * 3 + 2];
    if (a < b) partners[cursor[a]++] = b; else partners[cursor[b]++] = a;
    if (b < c) partners[cursor[b]++] = c; else partners[cursor[c]++] = b;
    if (c < a) partners[cursor[c]++] = a; else partners[cursor[a]++] = c;
  }

  let boundaryEdges = 0;
  let nonManifoldEdges = 0;
  for (let v = 0; v < vertexCount; v++) {
    const start = offsets[v];
    const end = offsets[v + 1];
    if (end - start < 1) continue;
    if (end - start > 32) {
      // Fans (e.g. a sphere pole) can be large: native numeric sort.
      partners.subarray(start, end).sort();
    } else {
      // Most buckets hold a handful of edges: insertion sort in place.
      for (let i = start + 1; i < end; i++) {
        const key = partners[i];
        let j = i - 1;
        while (j >= start && partners[j] > key) {
          partners[j + 1] = partners[j];
          j--;
        }
        partners[j + 1] = key;
      }
    }
    let run = 1;
    for (let i = start + 1; i <= end; i++) {
      if (i < end && partners[i] === partners[i - 1]) {
        run++;
        continue;
      }
      if (run === 1) boundaryEdges++;
      else if (run > 2) nonManifoldEdges++;
      run = 1;
    }
  }

  return {
    watertight: triCount > 0 && boundaryEdges === 0 && nonManifoldEdges === 0 && degenerateTriangles === 0,
    boundaryEdges,
    nonManifoldEdges,
    degenerateTriangles,
  };
}

/** Combine per-part reports: watertight only when every part is, counts summed (FIXES G7). */
export function mergeManifoldReports(reports: ManifoldReport[]): ManifoldReport {
  return reports.reduce<ManifoldReport>(
    (acc, r) => ({
      watertight: acc.watertight && r.watertight,
      boundaryEdges: acc.boundaryEdges + r.boundaryEdges,
      nonManifoldEdges: acc.nonManifoldEdges + r.nonManifoldEdges,
      degenerateTriangles: acc.degenerateTriangles + r.degenerateTriangles,
    }),
    { watertight: reports.length > 0, boundaryEdges: 0, nonManifoldEdges: 0, degenerateTriangles: 0 },
  );
}
