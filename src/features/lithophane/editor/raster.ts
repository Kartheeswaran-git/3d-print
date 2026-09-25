import { createShapeTest } from "@/lib/geometry/shapes";
import type { GrayMap } from "@/lib/image/moon";
import {
  frontViewToLamp,
  makeSampler,
  SAMPLE_SIZE,
  type Domain,
  type PhotoPixels,
  type ProjectionSettings,
} from "@/lib/image/project";

/**
 * Colour image for the Layout editor's canvas (PURE — writes RGBA into a buffer).
 *
 * - Flat: the composite across the piece rectangle; pixels outside the shape are drawn at 40 % opacity
 *   so the stage shows through them.
 * - Sphere: the lamp's front view (orthographic disc, via frontViewToLamp + sampler.lamp) with an
 *   anti-aliased rim. Outside the disc and over the bottom opening the pixels are transparent (the
 *   editor hatches the opening underneath).
 */

/** Alpha of flat-piece pixels outside the shape (40 %). */
export const OUTSIDE_ALPHA = 102;
/** Longest side of the canvas backing store (px). */
export const MAX_RASTER_SIZE = 480;
/** Smallest backing store side (px), e.g. for draft renders on a tiny stage. */
const MIN_RASTER_SIZE = 16;

const DEG = Math.PI / 180;

export interface EditorRasterRequest {
  domain: Domain;
  settings: ProjectionSettings;
  photo: PhotoPixels | null;
  moon: GrayMap | null;
  /** Backing store size in pixels. Flat: covers the piece; sphere: covers the disc's bounding square. */
  width: number;
  height: number;
}

/**
 * Backing store size for a canvas shown at `cssWidth × cssHeight`: device pixels, capped so the longest
 * side is at most `MAX_RASTER_SIZE`, then scaled by `quality` (drafts during a drag).
 */
export function rasterSize(cssWidth: number, cssHeight: number, dpr: number, quality = 1): { width: number; height: number } {
  const ratio = Number.isFinite(dpr) && dpr > 0 ? dpr : 1;
  const w = Math.max(1, cssWidth * ratio);
  const h = Math.max(1, cssHeight * ratio);
  const scale = Math.min(1, MAX_RASTER_SIZE / Math.max(w, h)) * Math.min(1, Math.max(0.05, quality));
  return {
    width: Math.max(MIN_RASTER_SIZE, Math.round(w * scale)),
    height: Math.max(MIN_RASTER_SIZE, Math.round(h * scale)),
  };
}

/** Render the editor image into `out` (length ≥ width × height × 4). Every pixel is written. */
export function renderEditorRaster(req: EditorRasterRequest, out: Uint8ClampedArray): void {
  const { width, height } = req;
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1) {
    throw new Error("The editor image must be at least 1 × 1 pixels.");
  }
  if (out.length < width * height * 4) throw new Error("The editor image buffer is too small.");
  if (req.domain.kind === "flat") renderFlat(req, req.domain, out);
  else renderSphere(req, req.domain, out);
}

function renderFlat(req: EditorRasterRequest, domain: Extract<Domain, { kind: "flat" }>, out: Uint8ClampedArray): void {
  const { width, height } = req;
  const sampler = makeSampler(domain, req.settings, req.photo, req.moon, { spacing: domain.widthMm / width });
  const inside = createShapeTest(domain.widthMm, domain.heightMm, domain.shape);
  const sample = new Float32Array(SAMPLE_SIZE);
  for (let y = 0, p = 0; y < height; y++) {
    const v = (y + 0.5) / height;
    for (let x = 0; x < width; x++, p += 4) {
      const u = (x + 0.5) / width;
      sampler.flat(u, v, sample);
      out[p] = sample[0];
      out[p + 1] = sample[1];
      out[p + 2] = sample[2];
      out[p + 3] = inside(u, v) ? 255 : OUTSIDE_ALPHA;
    }
  }
}

function renderSphere(req: EditorRasterRequest, domain: Extract<Domain, { kind: "sphere" }>, out: Uint8ClampedArray): void {
  const { width, height } = req;
  // A front view N px across has a sample spacing of 2/N sphere radii.
  const sampler = makeSampler(domain, req.settings, req.photo, req.moon, { spacing: 2 / width });
  const sample = new Float32Array(SAMPLE_SIZE);
  // Pixels per front-view unit (for the 1 px anti-aliased rim and opening edge).
  const ax = width / 2;
  const ay = height / 2;
  const openingY = -Math.cos(domain.openingDeg * DEG);
  const rim = 0.9999;
  for (let y = 0, p = 0; y < height; y++) {
    const fy = 1 - ((y + 0.5) / height) * 2;
    const openCover = clamp01((fy - openingY) * ay + 0.5);
    for (let x = 0; x < width; x++, p += 4) {
      const fx = ((x + 0.5) / width) * 2 - 1;
      const r = Math.sqrt(fx * fx + fy * fy);
      const cover = openCover * clamp01((1 - r) * Math.min(ax, ay) + 0.5);
      if (!(cover > 0)) {
        out[p] = out[p + 1] = out[p + 2] = out[p + 3] = 0;
        continue;
      }
      // Rim pixels sample just inside the silhouette.
      const k = r > rim ? rim / r : 1;
      const lamp = frontViewToLamp(fx * k, fy * k);
      if (!lamp) {
        out[p] = out[p + 1] = out[p + 2] = out[p + 3] = 0;
        continue;
      }
      sampler.lamp(lamp.thetaDeg, lamp.phiDeg, sample);
      out[p] = sample[0];
      out[p + 1] = sample[1];
      out[p + 2] = sample[2];
      out[p + 3] = Math.round(cover * 255);
    }
  }
}

function clamp01(n: number): number {
  return n < 0 ? 0 : n > 1 ? 1 : n;
}
