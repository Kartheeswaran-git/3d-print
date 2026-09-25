import { snap } from "@/lib/utils";
import type { ShapeKind } from "@/lib/geometry/types";
import type { MoonSurface } from "@/lib/image/moon";

/**
 * Single source of truth for lithophane settings: types, defaults, ranges,
 * value formatting and sanitising (used by the controls, reset, and project load).
 */

export const SHAPES = ["sphere", "crescent", "circle", "heart", "rounded", "rectangle", "square", "custom"] as const satisfies readonly ShapeKind[];

export const CROP_RATIOS = ["original", "model", "1:1", "4:3", "3:4", "16:9", "9:16"] as const;
export type CropRatio = (typeof CROP_RATIOS)[number];

/** Lunar surface maps (see public/moon/CREDITS.md). */
export const MOON_SURFACES = ["lro", "shaded"] as const satisfies readonly MoonSurface[];
export const MOON_SURFACE_LABELS: Record<MoonSurface, string> = {
  lro: "True to life (NASA LRO)",
  shaded: "Shaded craters",
};

export const STL_FORMATS = ["stl-binary", "stl-ascii"] as const;
export type StlFormat = (typeof STL_FORMATS)[number];

export interface LithophaneSettings {
  // Placement
  imageScale: number;
  imageX: number;
  imageY: number;
  rotation: number;
  edgeBlend: number;
  moonBackground: boolean;
  /** Which lunar map fills the background. */
  moonSurface: MoonSurface;
  /** Selenographic longitude facing the front (sphere) or at the disc centre (flat), −180…180°. */
  moonLongitude: number;
  // Crop
  cropRatio: CropRatio;
  cropScale: number;
  cropX: number;
  cropY: number;
  // Tone
  brightness: number;
  contrast: number;
  gamma: number;
  blur: number;
  sharpen: number;
  autoLevels: boolean;
  invert: boolean;
  // Physical size (flat shapes)
  width: number;
  height: number;
  lockRatio: boolean;
  // Relief
  minThickness: number;
  maxThickness: number;
  thicknessGamma: number;
  resolution: number;
  // Form
  shape: ShapeKind;
  sphereDiameter: number;
  sphereOpening: number;
  crescent: number;
  outerRadius: number;
  innerRadius: number;
  moonOffsetX: number;
  moonOffsetY: number;
  moonRotation: number;
  base: number;
  /** Coverage threshold for custom masks (shared by preview and export). */
  maskThreshold: number;
  // Frame
  frameStyle: "none" | "border" | "frame-only";
  frameDepth: number;
  frameWidth: number;
  frameOverhang: number;
  // Preview + export
  wireframe: boolean;
  backlight: boolean;
  format: StlFormat;
}

export type NumericKey = {
  [K in keyof LithophaneSettings]: LithophaneSettings[K] extends number ? K : never;
}[keyof LithophaneSettings];
export type BooleanKey = {
  [K in keyof LithophaneSettings]: LithophaneSettings[K] extends boolean ? K : never;
}[keyof LithophaneSettings];

export interface NumericSpec {
  min: number;
  max: number;
  step: number;
  /** Human readable value, e.g. "0.8 mm". */
  format: (v: number) => string;
}

const mm1 = (v: number) => `${v.toFixed(1)} mm`;
const mm0 = (v: number) => `${v.toFixed(0)} mm`;
const pct = (v: number) => `${Math.round(v)}%`;
const signedPct = (v: number) => `${v > 0 ? "+" : ""}${Math.round(v)}%`;
const deg = (v: number) => `${Math.round(v)}°`;
const fixed2 = (v: number) => v.toFixed(2);
const fixed1 = (v: number) => v.toFixed(1);

/** Moon side: 0 → "Near side", ±180 → "Far side", otherwise "30° E" / "30° W". */
export function formatMoonLongitude(v: number): string {
  const n = Math.round(v);
  if (n === 0) return "Near side";
  if (Math.abs(n) >= 180) return "Far side";
  return `${Math.abs(n)}° ${n > 0 ? "E" : "W"}`;
}

export const NUMERIC: Record<NumericKey, NumericSpec> = {
  imageScale: { min: 10, max: 150, step: 1, format: pct },
  imageX: { min: -100, max: 100, step: 1, format: signedPct },
  imageY: { min: -100, max: 100, step: 1, format: signedPct },
  rotation: { min: -180, max: 180, step: 1, format: deg },
  edgeBlend: { min: 0, max: 50, step: 1, format: pct },
  moonLongitude: { min: -180, max: 180, step: 1, format: formatMoonLongitude },
  cropScale: { min: 0.5, max: 1, step: 0.01, format: (v) => pct(v * 100) },
  cropX: { min: -1, max: 1, step: 0.01, format: fixed2 },
  cropY: { min: -1, max: 1, step: 0.01, format: fixed2 },
  brightness: { min: -100, max: 100, step: 1, format: (v) => `${v > 0 ? "+" : ""}${Math.round(v)}` },
  contrast: { min: 0, max: 3, step: 0.1, format: fixed1 },
  gamma: { min: 0.1, max: 3, step: 0.1, format: fixed1 },
  blur: { min: 0, max: 5, step: 1, format: (v) => (v === 0 ? "Off" : `${v}`) },
  sharpen: { min: 0, max: 1, step: 0.1, format: (v) => pct(v * 100) },
  width: { min: 20, max: 300, step: 1, format: mm0 },
  height: { min: 20, max: 300, step: 1, format: mm0 },
  minThickness: { min: 0.4, max: 2, step: 0.1, format: mm1 },
  maxThickness: { min: 1.5, max: 5, step: 0.1, format: mm1 },
  thicknessGamma: { min: 0.1, max: 3, step: 0.1, format: fixed1 },
  resolution: { min: 0.1, max: 0.3, step: 0.01, format: (v) => `${v.toFixed(2)} mm` },
  sphereDiameter: { min: 60, max: 220, step: 1, format: mm0 },
  sphereOpening: { min: 0, max: 100, step: 1, format: (v) => `${v}%` },
  crescent: { min: 0.15, max: 0.72, step: 0.01, format: fixed2 },
  outerRadius: { min: 0.55, max: 1.15, step: 0.01, format: fixed2 },
  innerRadius: { min: 0.4, max: 1.15, step: 0.01, format: fixed2 },
  moonOffsetX: { min: -0.6, max: 0.8, step: 0.01, format: fixed2 },
  moonOffsetY: { min: -0.6, max: 0.6, step: 0.01, format: fixed2 },
  moonRotation: { min: -180, max: 180, step: 1, format: deg },
  base: { min: 0.4, max: 2, step: 0.1, format: mm1 },
  // Stored 0..1, shown as a percentage.
  maskThreshold: { min: 0.05, max: 0.95, step: 0.05, format: (v) => pct(v * 100) },
  frameDepth: { min: 2, max: 50, step: 0.5, format: mm1 },
  frameWidth: { min: 1, max: 20, step: 0.5, format: mm1 },
  frameOverhang: { min: 30, max: 80, step: 1, format: deg },
};

export const DEFAULTS: LithophaneSettings = {
  imageScale: 60,
  imageX: 0,
  imageY: 0,
  rotation: 0,
  edgeBlend: 15,
  moonBackground: true,
  moonSurface: "shaded",
  moonLongitude: 0,
  cropRatio: "original",
  cropScale: 1,
  cropX: 0,
  cropY: 0,
  brightness: 0,
  contrast: 1,
  gamma: 1,
  blur: 0,
  sharpen: 0,
  autoLevels: false,
  invert: false,
  width: 100,
  height: 100,
  lockRatio: true,
  minThickness: 0.8,
  maxThickness: 3,
  thicknessGamma: 1,
  resolution: 0.15,
  shape: "sphere",
  sphereDiameter: 120,
  sphereOpening: 22,
  crescent: 0.4,
  outerRadius: 0.9,
  innerRadius: 0.82,
  moonOffsetX: 0.36,
  moonOffsetY: 0,
  moonRotation: -12,
  base: 0.8,
  maskThreshold: 0.5,
  frameStyle: "none",
  frameDepth: 7.5,
  frameWidth: 5,
  frameOverhang: 60,
  wireframe: false,
  backlight: true,
  format: "stl-binary",
};

/** Minimum gap kept between min and max wall thickness. */
export const MIN_THICKNESS_GAP = 0.1;
/** Longest side of the preview sample grid (flat shapes). */
export const PREVIEW_SAMPLES = 320;
/** Sphere preview grid (columns around, rows pole→opening): ~240 samples across the visible face. */
export const SPHERE_PREVIEW_COLUMNS = 480;
/** Hard cap on export samples along the longest side, to keep files printable. */
export const MAX_EXPORT_SAMPLES = 720;
export const MIN_SPHERE_EXPORT_COLUMNS = 180;

export function isFlat(shape: ShapeKind) {
  return shape !== "sphere";
}

/** Wrap an angle into −180…180° (180 stays 180). */
function wrapDegrees(v: number): number {
  const w = ((((v + 180) % 360) + 360) % 360) - 180;
  return w === -180 && v > 0 ? 180 : w;
}

/** Legacy (v1 prototype) crop ratio values → v2. */
const LEGACY_CROP: Record<string, CropRatio> = {
  original: "original",
  free: "original",
  "1": "1:1",
  "1.333333": "4:3",
  "1.777778": "16:9",
};

/**
 * Coerce any (possibly legacy or hand-edited) object into valid settings:
 * unknown keys are dropped, numbers are clamped/snapped, enums fall back to defaults.
 */
export function sanitizeSettings(input: unknown): LithophaneSettings {
  const src = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  // v1 prototype key names.
  const alias: Record<string, keyof LithophaneSettings> = { moonBg: "moonBackground" };
  const read = (key: keyof LithophaneSettings): unknown => {
    if (key in src) return src[key];
    const legacy = Object.keys(alias).find((k) => alias[k] === key);
    return legacy ? src[legacy] : undefined;
  };

  const out: LithophaneSettings = { ...DEFAULTS };
  for (const key of Object.keys(DEFAULTS) as (keyof LithophaneSettings)[]) {
    const raw = read(key);
    if (raw === undefined || raw === null) continue;
    const def = DEFAULTS[key];
    if (typeof def === "number") {
      const n = typeof raw === "number" ? raw : Number(raw);
      if (!Number.isFinite(n)) continue;
      const spec = NUMERIC[key as NumericKey];
      let v = n;
      // v1 stored rotation as 0..360.
      if (key === "rotation" && v > 180) v -= 360;
      // Longitudes wrap: 190 is the same side of the moon as −170.
      if (key === "moonLongitude") v = wrapDegrees(v);
      (out[key] as number) = snap(v, spec.min, spec.max, spec.step);
    } else if (typeof def === "boolean") {
      (out[key] as boolean) = raw === true || raw === "true";
    } else if (key === "moonSurface") {
      if (MOON_SURFACES.includes(raw as MoonSurface)) out.moonSurface = raw as MoonSurface;
    } else if (key === "shape") {
      if (SHAPES.includes(raw as ShapeKind)) out.shape = raw as ShapeKind;
    } else if (key === "cropRatio") {
      const v = String(raw);
      out.cropRatio = (CROP_RATIOS as readonly string[]).includes(v) ? (v as CropRatio) : (LEGACY_CROP[v] ?? DEFAULTS.cropRatio);
    } else if (key === "format") {
      const v = String(raw);
      out.format = v === "ascii" || v === "stl-ascii" ? "stl-ascii" : "stl-binary";
    }
  }
  if (out.maxThickness < out.minThickness + MIN_THICKNESS_GAP) {
    out.maxThickness = Math.min(NUMERIC.maxThickness.max, Number((out.minThickness + MIN_THICKNESS_GAP).toFixed(1)));
  }
  return out;
}

/** Effective max thickness used for meshing (always > min). */
export function effectiveMaxThickness(s: Pick<LithophaneSettings, "minThickness" | "maxThickness">) {
  return Math.max(s.maxThickness, s.minThickness + MIN_THICKNESS_GAP);
}

export const PROJECT_APP = "luna-litho";
export const PROJECT_VERSION = 2;

export interface LithophaneProjectFile {
  app: typeof PROJECT_APP;
  type: "lithophane";
  version: number;
  savedAt: string;
  settings: LithophaneSettings;
}

export function toProjectFile(settings: LithophaneSettings, savedAt: string): LithophaneProjectFile {
  return { app: PROJECT_APP, type: "lithophane", version: PROJECT_VERSION, savedAt, settings };
}

/**
 * Parse a saved project. Accepts v2 envelopes and v1 prototype files (flat settings objects).
 * Throws an Error with a user-facing message when the file is not a lithophane project.
 */
export function parseProjectFile(text: string): LithophaneSettings {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error("This file isn't valid JSON. Choose a project saved from Luna Litho.");
  }
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    throw new Error("This file doesn't contain lithophane settings.");
  }
  const obj = data as Record<string, unknown>;
  if (obj.app === PROJECT_APP) {
    if (obj.type !== "lithophane") throw new Error("This is a keychain project. Open it in the keychain studio.");
    return sanitizeSettings(obj.settings);
  }
  // v1: a flat object of control ids → values. Require at least a few known keys.
  const known = Object.keys(DEFAULTS).filter((k) => k in obj).length + ("moonBg" in obj ? 1 : 0);
  if (known < 3) throw new Error("This file doesn't contain lithophane settings.");
  return sanitizeSettings(obj);
}

/** Apply a width/height edit, preserving the current ratio when locked. */
export function resizeWithLock(
  s: Pick<LithophaneSettings, "width" | "height" | "lockRatio">,
  key: "width" | "height",
  value: number,
): { width: number; height: number } {
  const w = NUMERIC.width;
  const h = NUMERIC.height;
  if (!s.lockRatio || s.width <= 0 || s.height <= 0) {
    return key === "width"
      ? { width: snap(value, w.min, w.max, w.step), height: s.height }
      : { width: s.width, height: snap(value, h.min, h.max, h.step) };
  }
  const ratio = s.width / s.height;
  let width: number;
  let height: number;
  if (key === "width") {
    width = snap(value, w.min, w.max, w.step);
    height = width / ratio;
    if (height > h.max || height < h.min) {
      height = snap(height, h.min, h.max, h.step);
      width = height * ratio;
    }
  } else {
    height = snap(value, h.min, h.max, h.step);
    width = height * ratio;
    if (width > w.max || width < w.min) {
      width = snap(width, w.min, w.max, w.step);
      height = width / ratio;
    }
  }
  return { width: snap(width, w.min, w.max, w.step), height: snap(height, h.min, h.max, h.step) };
}
