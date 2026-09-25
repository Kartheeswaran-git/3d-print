import { snap } from "@/lib/utils";

/**
 * Single source of truth for keychain settings: types, defaults, ranges,
 * formatting and sanitising (controls, reset, and project load).
 */

export const KEYCHAIN_FONTS = ["manrope", "pacifico", "bangers", "playfair", "fredoka"] as const;
export type KeychainFont = (typeof KEYCHAIN_FONTS)[number];

export const KEYCHAIN_FORMATS = ["amf", "stl-binary", "stl-ascii"] as const;
export type KeychainFormat = (typeof KEYCHAIN_FORMATS)[number];

export const MAX_TEXT_LENGTH = 24;

export interface KeychainSettings {
  text: string;
  font: KeychainFont;
  targetHeight: number;
  baseThickness: number;
  textThickness: number;
  outlineWidth: number;
  holeSize: number;
  baseColor: string;
  textColor: string;
  format: KeychainFormat;
}

export type KeychainNumericKey = "targetHeight" | "baseThickness" | "textThickness" | "outlineWidth" | "holeSize";

export interface NumericSpec {
  min: number;
  max: number;
  step: number;
  format: (v: number) => string;
}

const mm0 = (v: number) => `${v.toFixed(0)} mm`;
const mm1 = (v: number) => `${v.toFixed(1)} mm`;

export const NUMERIC: Record<KeychainNumericKey, NumericSpec> = {
  targetHeight: { min: 15, max: 50, step: 1, format: mm0 },
  baseThickness: { min: 1, max: 4, step: 0.1, format: mm1 },
  textThickness: { min: 0.5, max: 4, step: 0.1, format: mm1 },
  outlineWidth: { min: 1, max: 8, step: 0.1, format: mm1 },
  holeSize: { min: 2, max: 8, step: 0.1, format: mm1 },
};

export const DEFAULTS: KeychainSettings = {
  text: "YourName",
  font: "manrope",
  targetHeight: 25,
  baseThickness: 2,
  textThickness: 1.5,
  outlineWidth: 4,
  holeSize: 4,
  baseColor: "#333333",
  textColor: "#ff7b00",
  format: "amf",
};

/**
 * Rasterisation density for exports (pixels per mm). 0.2 mm sampling is finer than a 0.4 mm nozzle prints;
 * the bevel blur is set in mm, so edges keep their shape at any density (REVIEW-NOTES R1: 10 → 5).
 */
export const EXPORT_DPMM = 5;
/** Rasterisation density for the live preview (pixels per mm). */
export const PREVIEW_DPMM = 4;
/** Coverage above which a cell is solid — shared by preview and export. */
export const MASK_THRESHOLD = 0.05;

const HEX = /^#[0-9a-f]{6}$/i;

export function sanitizeText(text: string): string {
  // Strip control characters and collapse whitespace; keep emoji/letters.
  return text.replace(/[\u0000-\u001f\u007f]/g, "").replace(/\s+/g, " ").slice(0, MAX_TEXT_LENGTH);
}

export function sanitizeSettings(input: unknown): KeychainSettings {
  const src = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  const out: KeychainSettings = { ...DEFAULTS };
  if (typeof src.text === "string") out.text = sanitizeText(src.text);
  if (KEYCHAIN_FONTS.includes(src.font as KeychainFont)) out.font = src.font as KeychainFont;
  for (const key of Object.keys(NUMERIC) as KeychainNumericKey[]) {
    const n = Number(src[key]);
    if (src[key] === undefined || src[key] === null || !Number.isFinite(n)) continue;
    const spec = NUMERIC[key];
    out[key] = snap(n, spec.min, spec.max, spec.step);
  }
  if (typeof src.baseColor === "string" && HEX.test(src.baseColor)) out.baseColor = src.baseColor.toLowerCase();
  if (typeof src.textColor === "string" && HEX.test(src.textColor)) out.textColor = src.textColor.toLowerCase();
  if (KEYCHAIN_FORMATS.includes(src.format as KeychainFormat)) out.format = src.format as KeychainFormat;
  return out;
}

export const PROJECT_APP = "luna-litho";
export const PROJECT_VERSION = 2;

export interface KeychainProjectFile {
  app: typeof PROJECT_APP;
  type: "keychain";
  version: number;
  savedAt: string;
  settings: KeychainSettings;
}

export function toProjectFile(settings: KeychainSettings, savedAt: string): KeychainProjectFile {
  return { app: PROJECT_APP, type: "keychain", version: PROJECT_VERSION, savedAt, settings };
}

export function parseProjectFile(text: string): KeychainSettings {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error("This file isn't valid JSON. Choose a project saved from Luna Litho.");
  }
  const obj = (data && typeof data === "object" ? data : null) as Record<string, unknown> | null;
  if (!obj || obj.app !== PROJECT_APP) throw new Error("This file doesn't contain keychain settings.");
  if (obj.type !== "keychain") throw new Error("This is a lamp project. Open it in the moon lamp studio.");
  return sanitizeSettings(obj.settings);
}
