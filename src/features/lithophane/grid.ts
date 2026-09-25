import {
  MAX_EXPORT_SAMPLES,
  MIN_SPHERE_EXPORT_COLUMNS,
  PREVIEW_SAMPLES,
  SPHERE_PREVIEW_COLUMNS,
  type LithophaneSettings,
  type StlFormat,
} from "./settings";

/** Sample grid: flat pieces use width × height grid points; the sphere uses width columns (wrapping) × height rows. */
export interface SampleGrid {
  width: number;
  height: number;
}

export interface ExportGrid extends SampleGrid {
  /** True when the requested detail was reduced to MAX_EXPORT_SAMPLES on the longest side. */
  capped: boolean;
}

type GridSettings = Pick<LithophaneSettings, "shape" | "sphereDiameter" | "width" | "height" | "resolution">;

/**
 * Export grid (prototype `exportDimensions`): sphere columns = min(720, max(180, round(π·D / resolution))),
 * rows = max(91, round(columns / 2) + 1); flat w = round(W / res) + 1, h = round(H / res) + 1, scaled so the
 * longest side is ≤ 720, never below 2.
 */
export function exportGrid(s: GridSettings): ExportGrid {
  if (s.shape === "sphere") {
    const requested = Math.max(MIN_SPHERE_EXPORT_COLUMNS, Math.round((Math.PI * s.sphereDiameter) / s.resolution));
    const columns = Math.min(MAX_EXPORT_SAMPLES, requested);
    return { width: columns, height: Math.max(91, Math.round(columns / 2) + 1), capped: columns < requested };
  }
  let width = Math.max(2, Math.round(s.width / s.resolution) + 1);
  let height = Math.max(2, Math.round(s.height / s.resolution) + 1);
  const factor = Math.min(1, MAX_EXPORT_SAMPLES / Math.max(width, height));
  width = Math.max(2, Math.floor(width * factor));
  height = Math.max(2, Math.floor(height * factor));
  return { width, height, capped: factor < 1 };
}

/**
 * Preview grid: the same pipeline at lower detail. Flat: PREVIEW_SAMPLES on the longest side with square
 * cells; sphere: SPHERE_PREVIEW_COLUMNS × (columns / 2 + 1). Never finer than the export grid.
 */
export function previewGrid(s: GridSettings): SampleGrid {
  const target = exportGrid(s);
  if (s.shape === "sphere") {
    const columns = Math.min(SPHERE_PREVIEW_COLUMNS, target.width);
    return { width: columns, height: Math.min(target.height, Math.round(columns / 2) + 1) };
  }
  if (Math.max(target.width, target.height) <= PREVIEW_SAMPLES) return { width: target.width, height: target.height };
  const aspect = s.width / s.height;
  const span = PREVIEW_SAMPLES - 1;
  return aspect >= 1
    ? { width: PREVIEW_SAMPLES, height: Math.max(2, Math.round(span / aspect) + 1) }
    : { width: Math.max(2, Math.round(span * aspect) + 1), height: PREVIEW_SAMPLES };
}

/** Cells of a grid: (w − 1) × (h − 1) for flat pieces, w × (h − 1) quads for the wrapping sphere. */
export function gridCells(kind: "flat" | "sphere", grid: SampleGrid): number {
  return kind === "sphere" ? grid.width * (grid.height - 1) : (grid.width - 1) * (grid.height - 1);
}

/**
 * Export triangle count estimated from the real preview mesh (FIXES G9). Top and bottom faces (4 triangles
 * per solid cell) scale with the cell area; the remaining wall triangles scale with the edge length, so the
 * preview's actual coverage and outline carry over to the export grid.
 */
export function estimateExportTriangles(
  preview: { triangles: number; activeCells: number },
  kind: "flat" | "sphere",
  from: SampleGrid,
  to: SampleGrid,
): number {
  if (!(preview.activeCells > 0) || !(preview.triangles > 0)) return 0;
  const sx = kind === "sphere" ? to.width / from.width : (to.width - 1) / Math.max(1, from.width - 1);
  const sy = (to.height - 1) / Math.max(1, from.height - 1);
  const faces = 4 * preview.activeCells;
  const walls = Math.max(0, preview.triangles - faces);
  return Math.round(faces * sx * sy + (walls * (sx + sy)) / 2);
}

/** STL size: binary is exactly 84 + 50 bytes per triangle; ASCII is roughly five times that. */
export function estimateFileBytes(triangles: number, format: StlFormat): number {
  const binary = 84 + 50 * Math.max(0, Math.round(triangles));
  return format === "stl-ascii" ? binary * 5 : binary;
}

export function formatSamples(grid: SampleGrid): string {
  return `${grid.width} × ${grid.height} samples`;
}
