import type { MeshStats, ScalarField, ShapeParams, ThicknessMapping } from "@/lib/geometry/types";

/** Build a flat lithophane (any FlatShape). */
export interface FlatJob {
  kind: "flat";
  luminance: ScalarField;
  mapping: ThicknessMapping;
  widthMm: number;
  heightMm: number;
  /** Solid base under the relief; top z = baseMm + thickness(lum). */
  baseMm: number;
  shape: ShapeParams;
  frame?: {
    style: "border" | "frame-only";
    depthMm: number;
    widthMm: number;
    overhangAngle: number;
  };
}

/** Build a hollow spherical lamp shell with a bottom opening. */
export interface SphereJob {
  kind: "sphere";
  /** Equirectangular luminance: u wraps 360° around Y, v runs from the top pole to the opening. */
  luminance: ScalarField;
  mapping: ThicknessMapping;
  diameterMm: number;
  openingDeg: number;
}

/** Build a two-part name keychain (base plate + raised text). */
export interface KeychainJob {
  kind: "keychain";
  /** Coverage of the whole plate (ring + outlined text, hole cut out), softened for a bevel. */
  baseAlpha: ScalarField;
  /** Coverage of the glyphs only, softened for a bevel. */
  textAlpha: ScalarField;
  widthMm: number;
  heightMm: number;
  baseThicknessMm: number;
  textThicknessMm: number;
  /** Coverage above which a cell is solid (shared by preview and export). */
  maskThreshold: number;
}

export type MeshJob = FlatJob | SphereJob | KeychainJob;

export type OutputFormat = "preview" | "stl-binary" | "stl-ascii" | "amf";

export interface MeshRequest {
  id: number;
  job: MeshJob;
  output: OutputFormat;
  /** Used for the STL solid name / AMF metadata. */
  name: string;
  /** Run the manifold check (always on for exports). */
  validate: boolean;
}

export type PartRole = "body" | "base" | "text";

export interface PreviewPart {
  role: PartRole;
  positions: Float32Array;
  indices: Uint32Array;
  uvs?: Float32Array;
  thickness?: Float32Array;
}

export type ProgressStage = "mesh" | "validate" | "write";

export type MeshResponse =
  | { id: number; type: "progress"; stage: ProgressStage; message: string }
  | { id: number; type: "preview"; parts: PreviewPart[]; stats: MeshStats }
  | {
      id: number;
      type: "file";
      buffer: ArrayBuffer;
      mime: string;
      extension: "stl" | "amf";
      stats: MeshStats;
    }
  | { id: number; type: "error"; message: string };

export interface PreviewResult {
  parts: PreviewPart[];
  stats: MeshStats;
}

export interface FileResult {
  buffer: ArrayBuffer;
  mime: string;
  extension: "stl" | "amf";
  stats: MeshStats;
}
