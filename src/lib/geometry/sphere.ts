import { assertField, DEFAULT_MIN_HEIGHT_MM } from "./heightfield";
import type { HeightMap, MeshBuildResult } from "./types";

export interface SphereMeshOptions {
  /**
   * Wall thickness in mm. Columns wrap 360° (no duplicated seam column) with column w/2 facing +Z;
   * rows run from the top pole to the opening.
   */
  heights: HeightMap;
  /** INNER diameter (the smooth inside surface). */
  diameterMm: number;
  /** Bottom opening half-angle measured from -Y (phi_max = PI - openingDeg). */
  openingDeg: number;
  withUvs?: boolean;
  withThickness?: boolean;
}

/**
 * Hollow shell: outer relief surface, inner smooth surface, CLOSED top pole (single vertex per surface, FIXES G1),
 * annular rim at the opening. point(r, θ, φ) = [r sinφ sinθ, r cosφ, r sinφ cosθ] with φ the polar angle.
 * Watertight + CCW outward.
 *
 * Column x of w sits at θ = 2π·(x/w − ½): column w/2 faces the viewer (+Z), θ grows towards +X, and the
 * wrap-around seam is at the back (−Z). Row y of h sits at polar angle y/(h − 1)·(π − opening).
 *
 * Vertex layout: outer pole, outer rings (rows 1..h-1, w each), inner pole, inner rings.
 * UVs: u = column / w = θ/2π + ½ (equirectangular with longitude 0 at the centre; the seam quad at the back
 * interpolates from (w-1)/w back to 0), v = 1 at the pole → 0 at the opening.
 */
export function buildSphereMesh(o: SphereMeshOptions): MeshBuildResult {
  const { heights } = o;
  assertField(heights, "sphere height map", 3, 2);
  if (!(o.diameterMm > 0) || !Number.isFinite(o.diameterMm)) {
    throw new Error("The sphere diameter must be greater than 0 mm.");
  }
  if (!(o.openingDeg > 0 && o.openingDeg < 180)) {
    throw new Error("The sphere opening must be between 0° and 180°.");
  }
  const w = heights.width;
  const h = heights.height;
  const rows = h - 1;
  const hv = heights.values;
  const innerRadius = o.diameterMm / 2;
  const phiMax = Math.PI - (o.openingDeg * Math.PI) / 180;
  const minHeight = DEFAULT_MIN_HEIGHT_MM;

  const sinT = new Float64Array(w);
  const cosT = new Float64Array(w);
  for (let x = 0; x < w; x++) {
    const theta = (x / w - 0.5) * Math.PI * 2;
    sinT[x] = Math.sin(theta);
    cosT[x] = Math.cos(theta);
  }

  const perSurface = 1 + rows * w;
  const vertexCount = perSurface * 2;
  const positions = new Float32Array(vertexCount * 3);
  const uvs = o.withUvs ? new Float32Array(vertexCount * 2) : undefined;
  const thickness = o.withThickness ? new Float32Array(vertexCount) : undefined;
  const outerPole = 0;
  const innerPole = perSurface;

  // Poles: the outer pole sits at the mean wall thickness of row 0.
  let poleSum = 0;
  for (let x = 0; x < w; x++) {
    const t = hv[x];
    poleSum += t > minHeight ? t : minHeight;
  }
  const poleThickness = poleSum / w;
  positions[outerPole * 3 + 1] = innerRadius + poleThickness;
  positions[innerPole * 3 + 1] = innerRadius;
  if (uvs) {
    uvs[outerPole * 2] = 0.5;
    uvs[outerPole * 2 + 1] = 1;
    uvs[innerPole * 2] = 0.5;
    uvs[innerPole * 2 + 1] = 1;
  }
  if (thickness) {
    thickness[outerPole] = poleThickness;
    thickness[innerPole] = poleThickness;
  }

  for (let y = 1; y <= rows; y++) {
    const phi = (phiMax * y) / rows;
    const sinP = Math.sin(phi);
    const cosP = Math.cos(phi);
    const tv = 1 - y / rows;
    const src = y * w;
    for (let x = 0; x < w; x++) {
      const raw = hv[src + x];
      const t = raw > minHeight ? raw : minHeight;
      const ro = innerRadius + t;
      const k = 1 + (y - 1) * w + x;
      const ki = k + perSurface;
      const dx = sinP * sinT[x];
      const dz = sinP * cosT[x];
      positions[k * 3] = ro * dx;
      positions[k * 3 + 1] = ro * cosP;
      positions[k * 3 + 2] = ro * dz;
      positions[ki * 3] = innerRadius * dx;
      positions[ki * 3 + 1] = innerRadius * cosP;
      positions[ki * 3 + 2] = innerRadius * dz;
      if (uvs) {
        const tu = x / w;
        uvs[k * 2] = tu;
        uvs[k * 2 + 1] = tv;
        uvs[ki * 2] = tu;
        uvs[ki * 2 + 1] = tv;
      }
      if (thickness) {
        thickness[k] = t;
        thickness[ki] = t;
      }
    }
  }

  // Per surface: pole fan (w) + quads between rings (2w per band, rows-1 bands); plus the rim (2w).
  const triangles = 2 * (w + 2 * w * (rows - 1)) + 2 * w;
  const indices = new Uint32Array(triangles * 3);
  let n = 0;
  const ring = (y: number, x: number) => 1 + (y - 1) * w + (x === w ? 0 : x);

  for (let x = 0; x < w; x++) {
    const a = ring(1, x);
    const b = ring(1, x + 1);
    // Outer fan: pole → down → around is CCW seen from outside.
    indices[n++] = outerPole; indices[n++] = a; indices[n++] = b;
    // Inner fan faces the cavity.
    indices[n++] = innerPole; indices[n++] = b + perSurface; indices[n++] = a + perSurface;
  }
  for (let y = 1; y < rows; y++) {
    for (let x = 0; x < w; x++) {
      const a = ring(y, x);
      const b = ring(y, x + 1);
      const c = ring(y + 1, x);
      const d = ring(y + 1, x + 1);
      indices[n++] = a; indices[n++] = c; indices[n++] = b;
      indices[n++] = b; indices[n++] = c; indices[n++] = d;
      const ai = a + perSurface;
      const bi = b + perSurface;
      const ci = c + perSurface;
      const di = d + perSurface;
      indices[n++] = ai; indices[n++] = bi; indices[n++] = ci;
      indices[n++] = ci; indices[n++] = bi; indices[n++] = di;
    }
  }
  // Rim at the opening joins the last outer ring to the last inner ring.
  for (let x = 0; x < w; x++) {
    const o0 = ring(rows, x);
    const o1 = ring(rows, x + 1);
    const i0 = o0 + perSurface;
    const i1 = o1 + perSurface;
    indices[n++] = o0; indices[n++] = i0; indices[n++] = o1;
    indices[n++] = o1; indices[n++] = i0; indices[n++] = i1;
  }

  const result: MeshBuildResult = { positions, indices, activeCells: rows * w };
  if (uvs) result.uvs = uvs;
  if (thickness) result.thickness = thickness;
  return result;
}
