import type { ShapeKind } from "@/lib/geometry/types";
import { DEFAULTS, type LithophaneSettings } from "./settings";
import type { InspectorMode } from "@/lib/state/inspector-mode";

/** Inspector sections that own settings (the Photo section holds session data only). */
export type SectionId = "form" | "placement" | "moon" | "crop" | "tone" | "relief";

/** Simple shows the essentials; Advanced shows every control. */
export type { InspectorMode };

type Key = keyof LithophaneSettings;

const FLAT_COMMON: Key[] = ["width", "height", "lockRatio", "base"];

/** Form keys that apply to each shape. The shape itself is never reset by "Reset section". */
const FORM_KEYS: Record<ShapeKind, Key[]> = {
  sphere: ["sphereDiameter", "sphereOpening"],
  crescent: [...FLAT_COMMON, "crescent", "outerRadius", "innerRadius", "moonOffsetX", "moonOffsetY", "moonRotation"],
  circle: [...FLAT_COMMON, "outerRadius"],
  heart: [...FLAT_COMMON, "moonRotation"],
  rounded: [...FLAT_COMMON, "moonRotation"],
  rectangle: FLAT_COMMON,
  square: [...FLAT_COMMON, "moonRotation"],
  custom: [...FLAT_COMMON, "maskThreshold"],
};

const SIMPLE_FLAT: Key[] = ["width", "height", "lockRatio"];

/** Form keys shown in Simple mode: the primary size, plus depth and rotation for the crescent. */
const SIMPLE_FORM_KEYS: Record<ShapeKind, Key[]> = {
  sphere: ["sphereDiameter"],
  crescent: [...SIMPLE_FLAT, "crescent", "moonRotation"],
  circle: SIMPLE_FLAT,
  heart: SIMPLE_FLAT,
  rounded: SIMPLE_FLAT,
  rectangle: SIMPLE_FLAT,
  square: SIMPLE_FLAT,
  custom: SIMPLE_FLAT,
};

const SECTION_KEYS: Record<Exclude<SectionId, "form">, Key[]> = {
  placement: ["imageScale", "imageX", "imageY", "rotation"],
  moon: ["moonBackground", "moonSurface", "moonLongitude", "edgeBlend"],
  crop: ["cropRatio", "cropScale", "cropX", "cropY"],
  tone: ["brightness", "contrast", "gamma", "blur", "sharpen", "autoLevels", "invert"],
  relief: ["minThickness", "maxThickness", "thicknessGamma", "resolution"],
};

/** Sections shown in each inspector mode, in display order. */
export const MODE_SECTIONS: Record<InspectorMode, readonly SectionId[]> = {
  simple: ["form", "placement", "moon"],
  advanced: ["form", "placement", "moon", "crop", "tone", "relief"],
};

export const SECTION_TITLES: Record<SectionId, string> = {
  form: "Form",
  placement: "Image placement",
  moon: "Moon",
  crop: "Crop",
  tone: "Tone",
  relief: "Relief",
};

/** Settings controlled by a section, given the current shape (only the Form section depends on it). */
export function sectionKeys(section: SectionId, shape: ShapeKind): Key[] {
  return section === "form" ? FORM_KEYS[shape] : SECTION_KEYS[section];
}

/** Form keys with a control in Simple mode. */
export function simpleFormKeys(shape: ShapeKind): Key[] {
  return SIMPLE_FORM_KEYS[shape];
}

/** True when any setting shown in the section differs from its default. */
export function isSectionModified(section: SectionId, settings: LithophaneSettings): boolean {
  return sectionKeys(section, settings.shape).some((key) => settings[key] !== DEFAULTS[key]);
}

/** Default values for the section's settings (what "Reset section" applies). */
export function sectionDefaults(section: SectionId, shape: ShapeKind): Partial<LithophaneSettings> {
  const out: Partial<LithophaneSettings> = {};
  for (const key of sectionKeys(section, shape)) {
    Object.assign(out, { [key]: DEFAULTS[key] });
  }
  return out;
}

/**
 * Sections whose controls Simple mode hides but whose changed values still shape the print, so the
 * inspector can say so (FIXES L9: nothing that affects the output is ever silently out of reach).
 * The Moon section's edge blend is left out: placement presets adjust it on purpose.
 */
export function hiddenChangedSections(settings: LithophaneSettings): SectionId[] {
  const out: SectionId[] = [];
  const shown = new Set(SIMPLE_FORM_KEYS[settings.shape]);
  if (FORM_KEYS[settings.shape].some((key) => !shown.has(key) && settings[key] !== DEFAULTS[key])) out.push("form");
  for (const section of MODE_SECTIONS.advanced) {
    if (!MODE_SECTIONS.simple.includes(section) && isSectionModified(section, settings)) out.push(section);
  }
  return out;
}
