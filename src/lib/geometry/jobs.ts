import type { FlatJob, KeychainJob, SphereJob } from "@/lib/worker/protocol";
import {
  assertField,
  buildCellMask,
  buildFieldCellMask,
  buildFlatMesh,
  luminanceToHeights,
  NO_PRINTABLE_AREA_MESSAGE,
} from "./heightfield";
import { createShapeTest, DEFAULT_MASK_THRESHOLD, type ShapeTest } from "./shapes";
import { buildSphereMesh } from "./sphere";
import type { HeightMap, MeshBuildResult, ScalarField, ThicknessMapping } from "./types";

export interface BuildOptions {
  withUvs?: boolean;
  withThickness?: boolean;
}

/** Bottom of the keychain plate's bevel: coverage 0 maps to this height (mm). */
const KEYCHAIN_BEVEL_FLOOR_MM = 0.1;

function assertMapping(mapping: ThicknessMapping): void {
  if (!Number.isFinite(mapping.minThickness) || !Number.isFinite(mapping.maxThickness) || mapping.minThickness < 0) {
    throw new Error("The wall thickness range is not valid.");
  }
}

function assertPositive(value: number, message: string): void {
  if (!(value > 0) || !Number.isFinite(value)) throw new Error(message);
}

/** Build a flat lithophane (any FlatShape) from a luminance grid. */
export function buildFlatJob(job: FlatJob, o: BuildOptions = {}): MeshBuildResult {
  assertField(job.luminance, "image");
  assertPositive(job.widthMm, "Width must be greater than 0 mm.");
  assertPositive(job.heightMm, "Height must be greater than 0 mm.");
  assertMapping(job.mapping);
  const heights = luminanceToHeights(job.luminance, job.mapping);
  
  let bottoms: Float32Array | undefined;
  if (job.frame && job.frame.style !== "none" as string) {
    const { depthMm, widthMm, overhangAngle, style } = job.frame;
    const w = heights.width;
    const h = heights.height;
    const vals = heights.values;
    bottoms = new Float32Array(w * h);
    
    // The central lithophane is centered in the frame.
    const lithoThickness = job.baseMm + job.mapping.maxThickness;
    const recess = Math.max(0, (depthMm - lithoThickness) / 2);
    
    // Total thickness of the frame above Z=0
    const frameHeight = depthMm - job.baseMm;
    const dxOverhang = (frameHeight > 0 && overhangAngle > 0 && overhangAngle < 90) ? frameHeight / Math.tan(overhangAngle * Math.PI / 180) : 0;
    
    for (let y = 0; y < h; y++) {
      const yMm = (y / Math.max(1, h - 1)) * job.heightMm;
      const dy = Math.min(yMm, job.heightMm - yMm);
      for (let x = 0; x < w; x++) {
        const xMm = (x / Math.max(1, w - 1)) * job.widthMm;
        const dx = Math.min(xMm, job.widthMm - xMm);
        const d = Math.min(dx, dy);
        
        let z = vals[y * w + x];
        if (style === "frame-only") z = 0;
        
        let bZ = recess;
        if (d <= widthMm) {
          z = frameHeight;
          bZ = 0;
        } else if (d < widthMm + dxOverhang) {
          const slopeDist = d - widthMm;
          const slopeZ = frameHeight - slopeDist * Math.tan(overhangAngle * Math.PI / 180);
          z = Math.max(z + recess, slopeZ);
          
          const slopeB = slopeDist * Math.tan(overhangAngle * Math.PI / 180);
          bZ = Math.min(recess, slopeB);
        } else {
          z = z + recess;
        }
        
        vals[y * w + x] = z;
        bottoms[y * w + x] = bZ;
      }
    }
  }

  const inside = createShapeTest(job.widthMm, job.heightMm, job.shape);
  const cells = buildCellMask(heights.width - 1, heights.height - 1, inside);
  return buildFlatMesh({
    heights,
    cells,
    widthMm: job.widthMm,
    heightMm: job.heightMm,
    baseMm: job.baseMm,
    withUvs: o.withUvs,
    withThickness: o.withThickness,
    inside: outlineTest(job, inside),
    bottoms,
  });
}

/**
 * Shape the flat outline is snapped to: the exact shape, except that a custom mask is read bilinearly
 * (its cells use the nearest mask sample, whose pixel staircase is not the intended outline).
 */
function outlineTest(job: FlatJob, inside: ShapeTest): ShapeTest {
  const { mask, maskThreshold } = job.shape;
  if (job.shape.shape !== "custom" || !mask || mask.values.length < mask.width * mask.height) return inside;
  return coverageTest(mask, maskThreshold ?? DEFAULT_MASK_THRESHOLD);
}

/** Build a hollow sphere lamp shell from an equirectangular luminance grid. */
export function buildSphereJob(job: SphereJob, o: BuildOptions = {}): MeshBuildResult {
  assertField(job.luminance, "image", 3, 2);
  assertMapping(job.mapping);
  return buildSphereMesh({
    heights: luminanceToHeights(job.luminance, job.mapping),
    diameterMm: job.diameterMm,
    openingDeg: job.openingDeg,
    withUvs: o.withUvs,
    withThickness: o.withThickness,
  });
}

/** Bilinear resample onto a w × h point grid (identity when the size already matches). */
function matchGrid(field: ScalarField, w: number, h: number): ScalarField {
  if (field.width === w && field.height === h) return field;
  const out = new Float32Array(w * h);
  const sw = field.width;
  const sh = field.height;
  const src = field.values;
  for (let y = 0; y < h; y++) {
    const fy = h > 1 ? (y / (h - 1)) * (sh - 1) : 0;
    const y0 = Math.min(sh - 1, Math.floor(fy));
    const y1 = Math.min(sh - 1, y0 + 1);
    const ty = fy - y0;
    for (let x = 0; x < w; x++) {
      const fx = w > 1 ? (x / (w - 1)) * (sw - 1) : 0;
      const x0 = Math.min(sw - 1, Math.floor(fx));
      const x1 = Math.min(sw - 1, x0 + 1);
      const tx = fx - x0;
      const top = src[y0 * sw + x0] * (1 - tx) + src[y0 * sw + x1] * tx;
      const bottom = src[y1 * sw + x0] * (1 - tx) + src[y1 * sw + x1] * tx;
      out[y * w + x] = top * (1 - ty) + bottom * ty;
    }
  }
  return { width: w, height: h, values: out };
}

const coverage = (a: number) => (a > 0 ? (a < 1 ? a : 1) : 0);

/**
 * `coverage > threshold` with the field read bilinearly across the piece (u, v in 0..1, v = 0 top). At a cell
 * centre this is the mean of the cell's four corners, the same test as buildFieldCellMask.
 */
function coverageTest(field: ScalarField, threshold: number): ShapeTest {
  const { width: w, height: h, values } = field;
  return (u, v) => {
    const fx = u <= 0 ? 0 : u >= 1 ? w - 1 : u * (w - 1);
    const fy = v <= 0 ? 0 : v >= 1 ? h - 1 : v * (h - 1);
    const x0 = Math.min(w - 1, Math.floor(fx));
    const y0 = Math.min(h - 1, Math.floor(fy));
    const x1 = Math.min(w - 1, x0 + 1);
    const y1 = Math.min(h - 1, y0 + 1);
    const tx = fx - x0;
    const ty = fy - y0;
    const top = values[y0 * w + x0] * (1 - tx) + values[y0 * w + x1] * tx;
    const bottom = values[y1 * w + x0] * (1 - tx) + values[y1 * w + x1] * tx;
    return top * (1 - ty) + bottom * ty > threshold;
  };
}

interface KeychainGrids {
  base: ScalarField;
  text: ScalarField;
  threshold: number;
  baseCells: Uint8Array;
}

function prepareKeychain(job: KeychainJob): KeychainGrids {
  assertField(job.baseAlpha, "keychain outline");
  assertField(job.textAlpha, "keychain text", 1, 1);
  assertPositive(job.widthMm, "The keychain width must be greater than 0 mm.");
  assertPositive(job.heightMm, "The keychain height must be greater than 0 mm.");
  assertPositive(job.baseThicknessMm, "The base thickness must be greater than 0 mm.");
  assertPositive(job.textThicknessMm, "The raised text thickness must be greater than 0 mm.");
  const base = job.baseAlpha;
  const text = matchGrid(job.textAlpha, base.width, base.height);
  const threshold = Number.isFinite(job.maskThreshold) ? job.maskThreshold : DEFAULT_MASK_THRESHOLD;
  const baseCells = buildFieldCellMask(base, threshold);
  return { base, text, threshold, baseCells };
}

/** Plate height per point: bevel floor at coverage 0 rising to the full base thickness. */
function plateHeights(base: ScalarField, baseThicknessMm: number): Float32Array {
  const n = base.width * base.height;
  const out = new Float32Array(n);
  const span = baseThicknessMm - KEYCHAIN_BEVEL_FLOOR_MM;
  for (let i = 0; i < n; i++) out[i] = KEYCHAIN_BEVEL_FLOOR_MM + coverage(base.values[i]) * span;
  return out;
}

function heightMap(field: ScalarField, values: Float32Array): HeightMap {
  return { width: field.width, height: field.height, values };
}

/**
 * base: heights = 0.1 + baseAlpha·(baseThickness - 0.1) masked by baseAlpha > maskThreshold;
 * text: heights = textAlpha·textThickness masked by textAlpha > maskThreshold (and kept on the plate),
 * zOffset = baseThicknessMm, baseMm 0. text is null when no glyph cells.
 */
export function buildKeychainParts(
  job: KeychainJob,
  o: BuildOptions = {},
): { base: MeshBuildResult; text: MeshBuildResult | null } {
  const { base: baseField, text: textField, threshold, baseCells } = prepareKeychain(job);
  if (!baseCells.includes(1)) throw new Error(NO_PRINTABLE_AREA_MESSAGE);

  const onPlate = coverageTest(baseField, threshold);
  const base = buildFlatMesh({
    heights: heightMap(baseField, plateHeights(baseField, job.baseThicknessMm)),
    cells: baseCells,
    widthMm: job.widthMm,
    heightMm: job.heightMm,
    baseMm: 0,
    withUvs: o.withUvs,
    withThickness: o.withThickness,
    inside: onPlate,
  });

  const textCells = buildFieldCellMask(textField, threshold);
  let textCount = 0;
  for (let i = 0; i < textCells.length; i++) {
    // Raised text must stand on the plate, never float over the key-ring hole or outside the outline.
    if (textCells[i] === 1 && baseCells[i] !== 1) textCells[i] = 0;
    textCount += textCells[i];
  }
  if (textCount === 0) return { base, text: null };

  const n = textField.width * textField.height;
  const textHeights = new Float32Array(n);
  for (let i = 0; i < n; i++) textHeights[i] = coverage(textField.values[i]) * job.textThicknessMm;
  const glyph = coverageTest(textField, threshold);
  const text = buildFlatMesh({
    heights: heightMap(textField, textHeights),
    cells: textCells,
    widthMm: job.widthMm,
    heightMm: job.heightMm,
    baseMm: 0,
    zOffsetMm: job.baseThicknessMm,
    withUvs: o.withUvs,
    withThickness: o.withThickness,
    inside: (u, v) => glyph(u, v) && onPlate(u, v),
  });
  return { base, text };
}

/** Single-colour solid for STL: heights = (0.1 + baseAlpha·(base - 0.1)) + textAlpha·text over the base mask. */
export function buildKeychainSolid(job: KeychainJob): MeshBuildResult {
  const { base: baseField, text: textField, threshold, baseCells } = prepareKeychain(job);
  if (!baseCells.includes(1)) throw new Error(NO_PRINTABLE_AREA_MESSAGE);
  const heights = plateHeights(baseField, job.baseThicknessMm);
  for (let i = 0; i < heights.length; i++) heights[i] += coverage(textField.values[i]) * job.textThicknessMm;
  return buildFlatMesh({
    heights: heightMap(baseField, heights),
    cells: baseCells,
    widthMm: job.widthMm,
    heightMm: job.heightMm,
    baseMm: 0,
    inside: coverageTest(baseField, threshold),
  });
}
