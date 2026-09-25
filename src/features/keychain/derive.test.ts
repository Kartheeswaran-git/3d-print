import { describe, expect, it } from "vitest";
import {
  FORMAT_OPTIONS,
  GEOMETRY_KEYS,
  SECTION_KEYS,
  SETTING_LABELS,
  SIMPLE_SECTION_KEYS,
  changedSettingLabels,
  differsFromDefaults,
  estimateExportTriangles,
  exportLabel,
  formatDimensions,
  formatFootprint,
  geometryKey,
  hasPrintableText,
  historyAnnouncement,
  keychainFileName,
  keychainFitKey,
  keychainModelName,
  keychainSettingsFileName,
  openEdgeCount,
  resetKeys,
  thicknessSummary,
  toKeychainJob,
  visibleSectionKeys,
} from "./derive";
import { COLOUR_PRESETS, findColourPreset } from "./presets";
import { DEFAULTS, EXPORT_DPMM, KEYCHAIN_FORMATS, MASK_THRESHOLD, PREVIEW_DPMM, sanitizeSettings } from "./settings";

describe("geometryKey", () => {
  it("ignores colours and the export format (colour changes never remesh)", () => {
    const base = geometryKey(DEFAULTS);
    expect(geometryKey({ ...DEFAULTS, baseColor: "#000000", textColor: "#ffffff", format: "stl-ascii" } as typeof DEFAULTS)).toBe(base);
  });

  it("changes with every geometry setting", () => {
    const base = geometryKey(DEFAULTS);
    const changed = {
      text: "Ada",
      font: "pacifico",
      targetHeight: 30,
      baseThickness: 2.5,
      textThickness: 1,
      outlineWidth: 3,
      holeSize: 5,
    } as const;
    for (const key of GEOMETRY_KEYS) {
      expect(geometryKey({ ...DEFAULTS, [key]: changed[key] })).not.toBe(base);
    }
  });
});

describe("text validation", () => {
  it("treats empty and whitespace-only names as unprintable", () => {
    expect(hasPrintableText("")).toBe(false);
    expect(hasPrintableText("   ")).toBe(false);
    expect(hasPrintableText(" Ada ")).toBe(true);
  });
});

describe("keychainFitKey", () => {
  it("refits on font or height, and only on ~5 mm width steps", () => {
    expect(keychainFitKey("manrope", 25, 112)).toBe("manrope:25:22");
    expect(keychainFitKey("manrope", 25, 113)).toBe("manrope:25:23");
    expect(keychainFitKey("manrope", 25, 111.9)).toBe(keychainFitKey("manrope", 25, 108));
    expect(keychainFitKey("pacifico", 25, 112)).not.toBe(keychainFitKey("manrope", 25, 112));
  });
});

describe("file names", () => {
  it("uses the safe text and the extension", () => {
    expect(keychainFileName("YourName", "amf")).toBe("YourName_keychain.amf");
    expect(keychainFileName("Anna Lena", "stl")).toBe("Anna-Lena_keychain.stl");
    expect(keychainFileName("Émilie", "stl")).toBe("Emilie_keychain.stl");
  });

  it("keeps the part after a dot instead of treating it as an extension", () => {
    expect(keychainFileName("Mr.Smith", "stl")).toBe("Mr-Smith_keychain.stl");
  });

  it("falls back to keychain.{ext} when nothing file-safe is left", () => {
    expect(keychainFileName("李娜", "amf")).toBe("keychain.amf");
    expect(keychainFileName("   ", "stl")).toBe("keychain.stl");
  });

  it("names project files distinctly", () => {
    expect(keychainSettingsFileName("YourName")).toBe("YourName_keychain-settings.json");
    expect(keychainSettingsFileName("")).toBe("keychain-settings.json");
  });

  it("names the model after the text", () => {
    expect(keychainModelName(" Ada ")).toBe("Ada keychain");
    expect(keychainModelName("")).toBe("Keychain");
  });
});

describe("toKeychainJob", () => {
  it("passes the raster through with the shared mask threshold and thicknesses", () => {
    const field = { width: 2, height: 2, values: new Float32Array(4) };
    const job = toKeychainJob(
      { baseAlpha: field, textAlpha: field, widthMm: 40, heightMm: 20 },
      { baseThickness: 2.5, textThickness: 1.2 },
    );
    expect(job).toMatchObject({
      kind: "keychain",
      widthMm: 40,
      heightMm: 20,
      baseThicknessMm: 2.5,
      textThicknessMm: 1.2,
      maskThreshold: MASK_THRESHOLD,
    });
    expect(job.baseAlpha).toBe(field);
  });
});

describe("formatting", () => {
  const bounds = { min: [-56.2, -12.5, 0] as [number, number, number], max: [56.2, 12.5, 3.5] as [number, number, number] };

  it("formats footprint and full dimensions to 0.1 mm", () => {
    expect(formatFootprint(bounds)).toBe("112.4 × 25.0 mm");
    expect(formatDimensions(bounds)).toBe("112.4 × 25.0 × 3.5 mm");
  });

  it("summarises thickness", () => {
    expect(thicknessSummary(DEFAULTS)).toBe("2.0 + 1.5 mm");
  });

  it("labels the primary button by format", () => {
    expect(exportLabel("amf")).toBe("Download AMF");
    expect(exportLabel("stl-binary")).toBe("Download STL");
    expect(exportLabel("stl-ascii")).toBe("Download STL");
  });

  it("offers every export format exactly once", () => {
    expect(FORMAT_OPTIONS.map((o) => o.value).sort()).toEqual([...KEYCHAIN_FORMATS].sort());
  });
});

describe("estimates and reports", () => {
  const r = EXPORT_DPMM / PREVIEW_DPMM;

  it("scales surfaces with the density squared and walls linearly", () => {
    // 100 cells → 400 surface triangles, plus 200 wall triangles.
    const counts = { triangles: 600, activeCells: 100, baseTriangles: 600 };
    expect(estimateExportTriangles(counts, "amf")).toBe(Math.round(400 * r * r + 200 * r));
  });

  it("estimates an STL from the base part only", () => {
    const counts = { triangles: 1000, activeCells: 200, baseTriangles: 600 };
    const factor = (800 * r * r + 200 * r) / 1000;
    expect(estimateExportTriangles(counts, "stl-binary")).toBe(Math.round(600 * factor));
    expect(estimateExportTriangles(counts, "amf")).toBe(Math.round(1000 * factor));
  });

  it("returns 0 for an empty preview", () => {
    expect(estimateExportTriangles({ triangles: 0, activeCells: 0, baseTriangles: 0 }, "amf")).toBe(0);
  });

  it("counts open edges as boundary + non-manifold", () => {
    expect(openEdgeCount({ watertight: false, boundaryEdges: 3, nonManifoldEdges: 2, degenerateTriangles: 7 })).toBe(5);
  });
});

describe("section resets", () => {
  it("detects changes per section", () => {
    const s = sanitizeSettings({ ...DEFAULTS, holeSize: 6 });
    expect(differsFromDefaults(s, SECTION_KEYS.size)).toBe(true);
    expect(differsFromDefaults(s, SECTION_KEYS.thickness)).toBe(false);
  });

  it("restores only the given keys, or everything", () => {
    const s = sanitizeSettings({ ...DEFAULTS, text: "Ada", holeSize: 6, baseColor: "#000000" });
    const sized = resetKeys(s, SECTION_KEYS.size);
    expect(sized.holeSize).toBe(DEFAULTS.holeSize);
    expect(sized.text).toBe("Ada");
    expect(sized.baseColor).toBe("#000000");
    expect(resetKeys(s)).toEqual(DEFAULTS);
    expect(resetKeys(s)).not.toBe(DEFAULTS);
  });
});

describe("colour presets", () => {
  it("are valid lowercase hex pairs and include the defaults", () => {
    for (const p of COLOUR_PRESETS) {
      expect(p.base).toMatch(/^#[0-9a-f]{6}$/);
      expect(p.text).toMatch(/^#[0-9a-f]{6}$/);
    }
    expect(findColourPreset(DEFAULTS.baseColor, DEFAULTS.textColor)?.label).toBe("Charcoal & orange");
  });

  it("matches case-insensitively and returns null for custom pairs", () => {
    expect(findColourPreset("#1F2A44", "#FFFFFF")?.id).toBe("navy-white");
    expect(findColourPreset("#1f2a44", "#000000")).toBeNull();
  });
});

describe("simple / advanced sections", () => {
  it("shows the name, font, height and colours in Simple mode", () => {
    expect(visibleSectionKeys("text", "simple")).toEqual(["text", "font"]);
    expect(visibleSectionKeys("size", "simple")).toEqual(["targetHeight"]);
    expect(visibleSectionKeys("thickness", "simple")).toEqual([]);
    expect(visibleSectionKeys("colours", "simple")).toEqual(["baseColor", "textColor"]);
  });

  it("shows every section key in Advanced mode", () => {
    for (const section of Object.keys(SECTION_KEYS) as (keyof typeof SECTION_KEYS)[]) {
      expect(visibleSectionKeys(section, "advanced")).toEqual(SECTION_KEYS[section]);
      for (const key of SIMPLE_SECTION_KEYS[section]) expect(SECTION_KEYS[section]).toContain(key);
    }
  });

  it("resets only what Simple mode shows", () => {
    const s = sanitizeSettings({ ...DEFAULTS, targetHeight: 30, outlineWidth: 6 });
    const reset = resetKeys(s, visibleSectionKeys("size", "simple"));
    expect(reset.targetHeight).toBe(DEFAULTS.targetHeight);
    expect(reset.outlineWidth).toBe(6);
    expect(differsFromDefaults(sanitizeSettings({ ...DEFAULTS, holeSize: 6 }), visibleSectionKeys("size", "simple"))).toBe(false);
  });
});

describe("undo announcements", () => {
  it("labels every setting", () => {
    expect(Object.keys(SETTING_LABELS).sort()).toEqual(Object.keys(DEFAULTS).sort());
  });

  it("lists the settings an undo changes, in inspector order", () => {
    const to = { ...DEFAULTS, holeSize: 6, text: "Ada", targetHeight: 30 };
    expect(changedSettingLabels(DEFAULTS, to)).toEqual(["Name", "Height", "Keyring hole"]);
    expect(changedSettingLabels(DEFAULTS, { ...DEFAULTS })).toEqual([]);
  });

  it("builds a short message and caps long lists", () => {
    expect(historyAnnouncement("undo", ["Height"])).toBe("Undone: Height");
    expect(historyAnnouncement("redo", ["Name", "Font"])).toBe("Redone: Name, Font");
    expect(historyAnnouncement("undo", [])).toBe("Undone");
    expect(historyAnnouncement("undo", ["Name", "Font", "Height", "Outline width", "Keyring hole"])).toBe(
      "Undone: Name, Font, Height, 2 more settings",
    );
  });
});
