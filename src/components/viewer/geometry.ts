import { BufferAttribute, BufferGeometry, Vector3 } from "three";
import type { ViewerPart } from "./types";

/** Vertex attribute read by the backlight shader. */
export const THICKNESS_ATTRIBUTE = "wallThickness";
/** Marks vertices without a known wall thickness; the shader treats them as mid-range. */
export const UNKNOWN_THICKNESS = -1;

/**
 * Wrap a part's typed arrays in a BufferGeometry without copying them (FIXES G10).
 * Always carries a thickness attribute so the lithophane shader never reads an unbound attribute.
 */
export function buildPartGeometry(
  positions: Float32Array,
  indices: Uint32Array,
  uvs?: Float32Array,
  thickness?: Float32Array,
): BufferGeometry {
  const vertexCount = Math.floor(positions.length / 3);
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new BufferAttribute(positions, 3));
  geometry.setIndex(new BufferAttribute(indices, 1));
  if (uvs && uvs.length === vertexCount * 2) geometry.setAttribute("uv", new BufferAttribute(uvs, 2));
  const wall =
    thickness && thickness.length === vertexCount
      ? thickness
      : new Float32Array(vertexCount).fill(UNKNOWN_THICKNESS);
  geometry.setAttribute(THICKNESS_ATTRIBUTE, new BufferAttribute(wall, 1));
  geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}

export interface SceneBounds {
  min: Vector3;
  max: Vector3;
  /** Centre of the axis-aligned box. */
  center: Vector3;
  /** Largest distance from `center` to any vertex. */
  radius: number;
  /** True for thin, upright pieces (flat lithophanes, keychains) as opposed to shells. */
  isPlate: boolean;
  /** Range of the known per-vertex wall thickness, or null when no part carries one. */
  thickness: { min: number; max: number } | null;
}

/** Bounds of all parts together; null when there is nothing to show. */
export function computeSceneBounds(parts: readonly ViewerPart[]): SceneBounds | null {
  let minX = Infinity;
  let minY = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let maxZ = -Infinity;
  let tMin = Infinity;
  let tMax = -Infinity;

  for (const part of parts) {
    const p = part.positions;
    const end = p.length - (p.length % 3);
    for (let i = 0; i < end; i += 3) {
      const x = p[i];
      const y = p[i + 1];
      const z = p[i + 2];
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
      if (z < minZ) minZ = z;
      if (z > maxZ) maxZ = z;
    }
    const t = part.thickness;
    if (t) {
      for (let i = 0; i < t.length; i++) {
        const v = t[i];
        if (v < 0 || !Number.isFinite(v)) continue;
        if (v < tMin) tMin = v;
        if (v > tMax) tMax = v;
      }
    }
  }
  if (!Number.isFinite(minX) || !Number.isFinite(maxX)) return null;

  const center = new Vector3((minX + maxX) / 2, (minY + maxY) / 2, (minZ + maxZ) / 2);
  let radiusSq = 0;
  for (const part of parts) {
    const p = part.positions;
    const end = p.length - (p.length % 3);
    for (let i = 0; i < end; i += 3) {
      const dx = p[i] - center.x;
      const dy = p[i + 1] - center.y;
      const dz = p[i + 2] - center.z;
      const d = dx * dx + dy * dy + dz * dz;
      if (d > radiusSq) radiusSq = d;
    }
  }
  const depth = maxZ - minZ;
  const span = Math.max(maxX - minX, maxY - minY);

  return {
    min: new Vector3(minX, minY, minZ),
    max: new Vector3(maxX, maxY, maxZ),
    center,
    radius: Math.max(Math.sqrt(radiusSq), 1e-3),
    isPlate: depth < span * 0.3,
    thickness: Number.isFinite(tMin) ? { min: tMin, max: tMax } : null,
  };
}

/**
 * Thickness range used to normalise the glow. Follows the requested range, but when the geometry is
 * thicker than `maxThickness` (a flat piece whose base was not included) the range is shifted up by the
 * excess so the thinnest walls keep glowing.
 */
export function glowRange(
  requested: { minThickness: number; maxThickness: number } | null | undefined,
  actual: { min: number; max: number } | null,
): { min: number; max: number } {
  let min = requested?.minThickness ?? actual?.min ?? 0.8;
  let max = requested?.maxThickness ?? actual?.max ?? 3;
  if (!Number.isFinite(min)) min = 0.8;
  if (!Number.isFinite(max) || max <= min) max = min + 0.1;
  if (requested && actual && actual.max > max + 0.01) {
    const shift = actual.max - max;
    min += shift;
    max += shift;
  }
  return { min, max };
}
