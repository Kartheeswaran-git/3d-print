import type { Bounds, MeshBuildResult, MeshStats } from "./types";

/** Axis-aligned bounds of xyz triples; all zeros for an empty array. */
export function computeBounds(positions: Float32Array): Bounds {
  const count = Math.floor(positions.length / 3);
  if (count === 0) return { min: [0, 0, 0], max: [0, 0, 0] };
  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  for (let i = 0; i < count * 3; i += 3) {
    const x = positions[i];
    const y = positions[i + 1];
    const z = positions[i + 2];
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
    if (z < minZ) minZ = z;
    if (z > maxZ) maxZ = z;
  }
  return { min: [minX, minY, minZ], max: [maxX, maxY, maxZ] };
}

/** Totals over one or more parts: vertex/triangle/cell counts summed, bounds unioned. `extra` wins on conflicts. */
export function meshStats(meshes: MeshBuildResult[], extra?: Partial<MeshStats>): MeshStats {
  let vertices = 0;
  let triangles = 0;
  let activeCells = 0;
  let bounds: Bounds | null = null;
  for (const mesh of meshes) {
    const count = Math.floor(mesh.positions.length / 3);
    vertices += count;
    triangles += Math.floor(mesh.indices.length / 3);
    activeCells += mesh.activeCells;
    if (count === 0) continue;
    const b = computeBounds(mesh.positions);
    bounds = bounds
      ? {
          min: [Math.min(bounds.min[0], b.min[0]), Math.min(bounds.min[1], b.min[1]), Math.min(bounds.min[2], b.min[2])],
          max: [Math.max(bounds.max[0], b.max[0]), Math.max(bounds.max[1], b.max[1]), Math.max(bounds.max[2], b.max[2])],
        }
      : b;
  }
  return {
    vertices,
    triangles,
    activeCells,
    bounds: bounds ?? { min: [0, 0, 0], max: [0, 0, 0] },
    ...extra,
  };
}
