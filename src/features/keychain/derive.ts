import type { Bounds, ManifoldReport } from "@/lib/geometry/types";
import type { KeychainJob } from "@/lib/worker/protocol";
import { safeFileName } from "@/lib/utils";
import type { KeychainRaster } from "./rasterize";
import {
  DEFAULTS,
  EXPORT_DPMM,
  MASK_THRESHOLD,
  PREVIEW_DPMM,
  type KeychainFormat,
  type KeychainSettings,
} from "./settings";
import type { InspectorMode } from "@/lib/state/inspector-mode";

/*
 * Pure helpers shared by the keychain hooks and components (no DOM, unit-tested).
 */

/** Settings that change the mesh. Colours and the export format never trigger a remesh (FIXES K6). */
export const GEOMETRY_KEYS = [
  "text",
  "font",
  "targetHeight",
  "baseThickness",
  "textThickness",
  "outlineWidth",
  "holeSize",
] as const satisfies readonly (keyof KeychainSettings)[];

export type KeychainGeometry = Pick<KeychainSettings, (typeof GEOMETRY_KEYS)[number]>;

/** Settings shown in each inspector section (drives "Reset section"). */
export const SECTION_KEYS = {
  text: ["text", "font"],
  size: ["targetHeight", "outlineWidth", "holeSize"],
  thickness: ["baseThickness", "textThickness"],
  colours: ["baseColor", "textColor"],
} as const satisfies Record<string, readonly (keyof KeychainSettings)[]>;

/** Identity of a mesh request: equal keys produce the same preview mesh. */
export function geometryKey(g: KeychainGeometry): string {
  return JSON.stringify(GEOMETRY_KEYS.map((k) => g[k]));
}

/** A name with at least one visible character (whitespace alone produces nothing to print, FIXES K11). */
export function hasPrintableText(text: string): boolean {
  return text.trim().length > 0;
}

/**
 * Worker job for a raster. The alpha grids are transferred to the worker (and detached here),
 * so rasterise afresh for every request.
 */
export function toKeychainJob(
  raster: Pick<KeychainRaster, "baseAlpha" | "textAlpha" | "widthMm" | "heightMm">,
  s: Pick<KeychainSettings, "baseThickness" | "textThickness">,
): KeychainJob {
  return {
    kind: "keychain",
    baseAlpha: raster.baseAlpha,
    textAlpha: raster.textAlpha,
    widthMm: raster.widthMm,
    heightMm: raster.heightMm,
    baseThicknessMm: s.baseThickness,
    textThicknessMm: s.textThickness,
    maskThreshold: MASK_THRESHOLD,
  };
}

/** Camera framing key: refit only on a new font, height or a big change in width (UX §Keychain behaviour). */
export function keychainFitKey(font: string, targetHeight: number, widthMm: number): string {
  return `${font}:${targetHeight}:${Math.round(widthMm / 5)}`;
}

/** Download name `{safe text}_keychain.{ext}`; names with no Latin letters or digits become `keychain.{ext}` (FIXES K7). */
export function keychainFileName(text: string, extension: string): string {
  // safeFileName strips a trailing ".ext", which would eat "Mr.Smith" → "Mr"; dots in a name are just separators.
  const safe = safeFileName(text.replace(/\./g, " "), "");
  return `${safe ? `${safe}_` : ""}keychain.${extension}`;
}

/** Project file name, e.g. "YourName_keychain-settings.json". */
export function keychainSettingsFileName(text: string): string {
  return keychainFileName(text, "json").replace(/keychain\.json$/, "keychain-settings.json");
}

/** Name passed to the worker for the STL solid / AMF object. */
export function keychainModelName(text: string): string {
  const trimmed = text.trim();
  return trimmed ? `${trimmed} keychain` : "Keychain";
}

/** Primary button label for the selected format. */
export function exportLabel(format: KeychainFormat): string {
  return format === "amf" ? "Download AMF" : "Download STL";
}

export const FORMAT_OPTIONS: { value: KeychainFormat; label: string; description: string }[] = [
  { value: "amf", label: "Multi-colour AMF", description: "Prusa, Bambu and Orca load base and text as separate parts." },
  { value: "stl-binary", label: "Binary STL", description: "Single part — smaller file." },
  { value: "stl-ascii", label: "ASCII STL", description: "Single part — human-readable." },
];

const mm1 = (n: number) => n.toFixed(1);

/** Plate footprint "112.4 × 25.0 mm" from mesh bounds. */
export function formatFootprint(bounds: Bounds): string {
  return `${mm1(bounds.max[0] - bounds.min[0])} × ${mm1(bounds.max[1] - bounds.min[1])} mm`;
}

/** Overall size "112.4 × 25.0 × 3.5 mm" from mesh bounds. */
export function formatDimensions(bounds: Bounds): string {
  return `${mm1(bounds.max[0] - bounds.min[0])} × ${mm1(bounds.max[1] - bounds.min[1])} × ${mm1(bounds.max[2] - bounds.min[2])} mm`;
}

/** What the triangle estimate needs from a preview. */
export interface PreviewTriangleCounts {
  /** All preview triangles (base + text parts). */
  triangles: number;
  /** Solid cells over all parts (`MeshStats.activeCells`). */
  activeCells: number;
  /** Triangles of the base part alone. */
  baseTriangles: number;
}

/**
 * Export triangle estimate from the preview mesh. Height-field meshes have 4 triangles per solid cell
 * (top + bottom), which grow with the square of the density, and 2 per wall side, which grow linearly.
 * The AMF holds both parts; an STL is one solid over the base outline, so it scales the base part only.
 */
export function estimateExportTriangles(preview: PreviewTriangleCounts, format: KeychainFormat): number {
  if (!(preview.triangles > 0)) return 0;
  const r = EXPORT_DPMM / PREVIEW_DPMM;
  const surface = Math.min(preview.triangles, Math.max(0, preview.activeCells) * 4);
  const walls = preview.triangles - surface;
  const factor = (surface * r * r + walls * r) / preview.triangles;
  return Math.round((format === "amf" ? preview.triangles : preview.baseTriangles) * factor);
}

/** Edges a slicer would have to repair (boundary + non-manifold). */
export function openEdgeCount(report: ManifoldReport): number {
  return report.boundaryEdges + report.nonManifoldEdges;
}

/** True when any of `keys` differs from its default. */
export function differsFromDefaults(s: KeychainSettings, keys: readonly (keyof KeychainSettings)[]): boolean {
  return keys.some((k) => s[k] !== DEFAULTS[k]);
}

/** Settings with `keys` (or everything) restored to DEFAULTS. */
export function resetKeys(s: KeychainSettings, keys?: readonly (keyof KeychainSettings)[]): KeychainSettings {
  if (!keys) return { ...DEFAULTS };
  const next: KeychainSettings = { ...s };
  for (const k of keys) Object.assign(next, { [k]: DEFAULTS[k] });
  return next;
}

/** Thickness section summary, e.g. "2.0 + 1.5 mm". */
export function thicknessSummary(s: Pick<KeychainSettings, "baseThickness" | "textThickness">): string {
  return `${mm1(s.baseThickness)} + ${mm1(s.textThickness)} mm`;
}


/** How much of the inspector is shown (FEATURE §2 Simple / Advanced). */
export type { InspectorMode };

/**
 * Settings each inspector section shows in Simple mode: the name and font, the height, and the colours.
 * Advanced shows everything in SECTION_KEYS. "Reset section" only touches what is visible.
 */
export const SIMPLE_SECTION_KEYS = {
  text: SECTION_KEYS.text,
  size: ["targetHeight"],
  thickness: [],
  colours: SECTION_KEYS.colours,
} as const satisfies Record<keyof typeof SECTION_KEYS, readonly (keyof KeychainSettings)[]>;

export type InspectorSectionId = keyof typeof SECTION_KEYS;

/** The settings a section shows (and resets) in the given inspector mode. */
export function visibleSectionKeys(section: InspectorSectionId, mode: InspectorMode): readonly (keyof KeychainSettings)[] {
  return mode === "simple" ? SIMPLE_SECTION_KEYS[section] : SECTION_KEYS[section];
}

/** Control labels, as the inspector and export panel show them (used to announce undo / redo). */
export const SETTING_LABELS: Record<keyof KeychainSettings, string> = {
  text: "Name",
  font: "Font",
  targetHeight: "Height",
  outlineWidth: "Outline width",
  holeSize: "Keyring hole",
  baseThickness: "Base thickness",
  textThickness: "Raised text",
  baseColor: "Base colour",
  textColor: "Text colour",
  format: "Format",
};

/** Labels of the settings that differ between `from` and `to`, in inspector order. */
export function changedSettingLabels(from: KeychainSettings, to: KeychainSettings): string[] {
  return (Object.keys(SETTING_LABELS) as (keyof KeychainSettings)[]).filter((k) => from[k] !== to[k]).map((k) => SETTING_LABELS[k]);
}

/** Screen-reader message after an undo or redo, e.g. "Undone: Height, Outline width". */
export function historyAnnouncement(direction: "undo" | "redo", labels: readonly string[]): string {
  const verb = direction === "undo" ? "Undone" : "Redone";
  if (labels.length === 0) return verb;
  const shown = labels.length > 4 ? [...labels.slice(0, 3), `${labels.length - 3} more settings`] : labels;
  return `${verb}: ${shown.join(", ")}`;
}
