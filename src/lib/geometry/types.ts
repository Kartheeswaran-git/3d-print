/**
 * Shared geometry contracts. All distances are millimetres.
 *
 * Coordinate conventions (used by every builder, the worker and the viewer):
 *  - Flat pieces stand upright facing the viewer: +X right, +Y up, +Z towards the viewer.
 *    The back face sits on z = 0 and the relief rises towards +Z.
 *    Sample (col, row) maps to x = (col / (w - 1) - 0.5) * widthMm, y = (0.5 - row / (h - 1)) * heightMm.
 *  - Spheres are centred on the origin with +Y up; the light opening is at the bottom (-Y).
 *  - Triangles are wound counter-clockwise when seen from outside, so normals point out of the solid.
 */

/** Row-major scalar grid. Row 0 is the TOP of the image. */
export interface ScalarField {
  width: number;
  height: number;
  values: Float32Array;
}

/** Luminance 0..1 where 0 = dark (thickest wall) and 1 = light (thinnest wall). */
export type LuminanceField = ScalarField;
/** Coverage 0..1 (alpha-like). */
export type CoverageMask = ScalarField;
/** Wall/relief height in millimetres per sample. */
export type HeightMap = ScalarField;

/** thickness(lum) = minThickness + (1 - lum ** gamma) * (maxThickness - minThickness) */
export interface ThicknessMapping {
  minThickness: number;
  maxThickness: number;
  gamma: number;
}

export type FlatShape = "crescent" | "circle" | "heart" | "rounded" | "rectangle" | "square" | "custom";
export type ShapeKind = "sphere" | FlatShape;

export interface ShapeParams {
  shape: FlatShape;
  /** Crescent depth; shifts the inner circle along X. */
  crescent: number;
  /** Outer radius in normalised units (1 = half of the shorter side). Used by crescent and circle. */
  outerRadius: number;
  /** Inner (cut-out) radius of the crescent in normalised units. */
  innerRadius: number;
  offsetX: number;
  offsetY: number;
  rotationDeg: number;
  /** Only for `custom`: coverage mask sampled across the full piece (u, v in 0..1). */
  mask?: CoverageMask | null;
  /** Coverage above which a custom-mask cell is solid. Preview and export MUST share this. */
  maskThreshold?: number;
}

export interface MeshData {
  /** xyz triples in mm. */
  positions: Float32Array;
  /** Triangle vertex indices, CCW seen from outside. */
  indices: Uint32Array;
  /** Optional preview-only attributes. */
  uvs?: Float32Array;
  /** Optional preview-only per-vertex wall thickness in mm (drives the backlight simulation). */
  thickness?: Float32Array;
}

export interface MeshBuildResult extends MeshData {
  /** Number of solid grid cells (flat) or quads (sphere). 0 means nothing printable. */
  activeCells: number;
}

export interface ManifoldReport {
  /** True when every edge is shared by exactly two triangles and there are no degenerate faces. */
  watertight: boolean;
  boundaryEdges: number;
  nonManifoldEdges: number;
  degenerateTriangles: number;
}

export interface Bounds {
  min: [number, number, number];
  max: [number, number, number];
}

export interface MeshStats {
  vertices: number;
  triangles: number;
  activeCells: number;
  bounds: Bounds;
  /** Exact byte size of the written file (export only). */
  bytes?: number;
  /** Present when the job asked for validation. */
  manifold?: ManifoldReport;
}
