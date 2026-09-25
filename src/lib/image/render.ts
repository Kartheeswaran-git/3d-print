import { buildCellMask, resolveDiagonalContacts } from "@/lib/geometry/heightfield";
import { createShapeTest } from "@/lib/geometry/shapes";
import type { LuminanceField } from "@/lib/geometry/types";
import { createCanvas, get2d } from "./canvas";
import type { GrayMap } from "./moon";
import { gridSpacing, makeSampler, renderGrid, type Domain, type PhotoPixels, type ProjectionSettings } from "./project";
import { applyTone, type ToneSettings } from "./tone";

export interface LuminanceRenderOptions {
  domain: Domain;
  /** Grid size: flat → w × h mesh points; sphere → columns around × rows (pole → opening). */
  width: number;
  height: number;
  photo: PhotoPixels | null;
  /** Lunar map (see loadMoonMap); null or `moonBackground` off → white background. */
  moon: GrayMap | null;
  settings: ProjectionSettings & ToneSettings;
}

export interface LuminanceData {
  /** Toned luminance on the mesh grid (fresh array — safe to transfer to the worker). */
  field: LuminanceField;
  /** The composition before tone processing (opaque RGBA). */
  rgba: Uint8ClampedArray;
  /**
   * Flat pieces: 1 where the grid point belongs to the printed footprint (it touches a solid cell of the
   * mesh, after the same cell test and diagonal fix the flat builder uses), else 0. Null for the sphere.
   */
  footprint: Uint8Array | null;
}

export interface LuminanceRender {
  /** Toned luminance grid (fresh array every call — safe to transfer to the worker). */
  field: LuminanceField;
  /** The composition before tone processing ("Original" thumbnail). */
  composite: HTMLCanvasElement;
  /** Grayscale of `field`; transparent where the flat shape has no material. */
  heightMap: HTMLCanvasElement;
}

/**
 * Grid points of a flat piece that the mesh uses: cells are tested at their centres with the shape test,
 * checkerboard contacts are filled exactly as buildFlatMesh does, and a point is in when any adjacent
 * cell is solid.
 */
export function flatFootprint(domain: Extract<Domain, { kind: "flat" }>, width: number, height: number): Uint8Array {
  const out = new Uint8Array(width * height);
  const cols = width - 1;
  const rows = height - 1;
  if (cols < 1 || rows < 1) return out;
  const cells = buildCellMask(cols, rows, createShapeTest(domain.widthMm, domain.heightMm, domain.shape));
  resolveDiagonalContacts(cells, cols, rows);
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      if (cells[y * cols + x] !== 1) continue;
      const p = y * width + x;
      out[p] = 1;
      out[p + 1] = 1;
      out[p + width] = 1;
      out[p + width + 1] = 1;
    }
  }
  return out;
}

/**
 * Pure part of the render (no DOM): sample the composite at the mesh grid points (prefiltered for the
 * grid's spacing), convert to luminance and apply the tone pipeline (wrapping across the sphere's seam).
 */
export function composeLuminance(o: LuminanceRenderOptions): LuminanceData {
  const width = Math.round(o.width);
  const height = Math.round(o.height);
  if (!(width >= 1) || !(height >= 1)) throw new Error("The image grid must be at least 1 × 1 samples.");
  const sampler = makeSampler(o.domain, o.settings, o.photo, o.moon, { spacing: gridSpacing(o.domain, width, height) });
  const grid = renderGrid(o.domain, sampler, width, height);
  const values = applyTone(grid.lum, width, height, o.settings, { wrapX: o.domain.kind === "sphere" });
  const footprint = o.domain.kind === "flat" ? flatFootprint(o.domain, width, height) : null;
  return { field: { width, height, values }, rgba: grid.rgba, footprint };
}

/**
 * Render the composition on the mesh grid and return the toned luminance plus two canvases:
 * the composite ("Original") and the height map (transparent outside a flat piece's footprint).
 */
export function renderLuminance(o: LuminanceRenderOptions): LuminanceRender {
  const { field, rgba, footprint } = composeLuminance(o);
  const { width, height, values } = field;

  const composite = createCanvas(width, height);
  const cctx = get2d(composite);
  const compositeImage = cctx.createImageData(width, height);
  compositeImage.data.set(rgba);
  cctx.putImageData(compositeImage, 0, 0);

  const heightMap = createCanvas(width, height);
  const hctx = get2d(heightMap);
  const image = hctx.createImageData(width, height);
  const px = image.data;
  for (let i = 0, p = 0; i < values.length; i++, p += 4) {
    const shade = Math.round(values[i] * 255);
    px[p] = shade;
    px[p + 1] = shade;
    px[p + 2] = shade;
    px[p + 3] = !footprint || footprint[i] === 1 ? 255 : 0;
  }
  hctx.putImageData(image, 0, 0);

  return { field, composite, heightMap };
}
