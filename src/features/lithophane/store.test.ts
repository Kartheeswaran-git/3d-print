import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { hiddenChangedSections, isSectionModified, MODE_SECTIONS, sectionDefaults, sectionKeys, type SectionId } from "./sections";
import { DEFAULTS, SHAPES } from "./settings";

/** In-memory localStorage so the persist middleware can be exercised in Node. */
function memoryStorage() {
  const items = new Map<string, string>();
  return {
    getItem: (key: string) => items.get(key) ?? null,
    setItem: (key: string, value: string) => void items.set(key, value),
    removeItem: (key: string) => void items.delete(key),
    clear: () => items.clear(),
    key: (i: number) => [...items.keys()][i] ?? null,
    get length() {
      return items.size;
    },
  };
}

const storage = memoryStorage();
vi.stubGlobal("localStorage", storage);

const { SETTINGS_STORAGE_KEY, designSettings, useLithophaneHistory, useLithophaneStore } = await import("./store");

beforeEach(() => {
  storage.clear();
  useLithophaneStore.getState().resetAll();
  useLithophaneHistory.getState().clear();
});

describe("sections", () => {
  const sections: SectionId[] = ["form", "placement", "moon", "crop", "tone", "relief"];

  it("reports no modifications on defaults, for every shape", () => {
    for (const shape of SHAPES) {
      for (const section of sections) expect(isSectionModified(section, { ...DEFAULTS, shape })).toBe(false);
    }
  });

  it("never resets the shape and only covers controls of the current shape", () => {
    for (const shape of SHAPES) expect(sectionKeys("form", shape)).not.toContain("shape");
    expect(sectionKeys("form", "sphere")).toEqual(["sphereDiameter", "sphereOpening"]);
    expect(sectionKeys("form", "circle")).toContain("outerRadius");
    expect(sectionKeys("form", "circle")).not.toContain("crescent");
    expect(sectionDefaults("tone", "sphere")).toMatchObject({ brightness: 0, autoLevels: false, invert: false });
    expect(sectionDefaults("moon", "sphere")).toEqual({
      moonBackground: DEFAULTS.moonBackground,
      moonSurface: DEFAULTS.moonSurface,
      moonLongitude: DEFAULTS.moonLongitude,
      edgeBlend: DEFAULTS.edgeBlend,
    });
  });

  it("covers every design setting in exactly one section", () => {
    for (const shape of SHAPES) {
      const keys = sections.flatMap((section) => sectionKeys(section, shape));
      expect(new Set(keys).size).toBe(keys.length);
    }
    expect(MODE_SECTIONS.advanced).toEqual(sections);
  });

  it("names the hidden sections whose changes still apply in Simple mode (FIXES L9)", () => {
    expect(hiddenChangedSections(DEFAULTS)).toEqual([]);
    // Visible in Simple mode: never reported.
    expect(hiddenChangedSections({ ...DEFAULTS, sphereDiameter: 150, imageX: 20, moonLongitude: 40, edgeBlend: 30 })).toEqual([]);
    expect(hiddenChangedSections({ ...DEFAULTS, sphereOpening: 30, blur: 2, resolution: 0.2 })).toEqual(["form", "tone", "relief"]);
    expect(hiddenChangedSections({ ...DEFAULTS, shape: "crescent", crescent: 0.5, moonRotation: 10 })).toEqual([]);
    expect(hiddenChangedSections({ ...DEFAULTS, shape: "crescent", innerRadius: 0.6, cropScale: 0.8 })).toEqual(["form", "crop"]);
  });
});

describe("useLithophaneStore", () => {
  it("clamps and snaps numeric values", () => {
    const { set } = useLithophaneStore.getState();
    set("sphereDiameter", 9999);
    set("contrast", 1.234);
    set("minThickness", -3);
    const s = useLithophaneStore.getState().settings;
    expect(s.sphereDiameter).toBe(220);
    expect(s.contrast).toBe(1.2);
    expect(s.minThickness).toBe(0.4);
  });

  it("wraps moon longitudes turned past the far side", () => {
    const { set } = useLithophaneStore.getState();
    set("moonLongitude", 200);
    expect(useLithophaneStore.getState().settings.moonLongitude).toBe(-160);
    set("moonLongitude", -181.4);
    expect(useLithophaneStore.getState().settings.moonLongitude).toBe(179);
    set("moonLongitude", -180);
    expect(useLithophaneStore.getState().settings.moonLongitude).toBe(-180);
  });

  it("keeps the current aspect ratio while locked (FIXES L1)", () => {
    const { setMany, resize } = useLithophaneStore.getState();
    setMany({ shape: "rectangle", width: 150, height: 100, lockRatio: true });
    resize("width", 120);
    expect(useLithophaneStore.getState().settings).toMatchObject({ width: 120, height: 80 });
    useLithophaneStore.getState().set("lockRatio", false);
    useLithophaneStore.getState().resize("height", 50);
    expect(useLithophaneStore.getState().settings).toMatchObject({ width: 120, height: 50 });
  });

  it("resets one section without touching the others", () => {
    const store = useLithophaneStore.getState();
    store.setMany({ shape: "crescent", crescent: 0.6, brightness: 30, width: 140 });
    useLithophaneStore.getState().resetSection("form");
    const s = useLithophaneStore.getState().settings;
    expect(s).toMatchObject({ shape: "crescent", crescent: DEFAULTS.crescent, width: DEFAULTS.width, brightness: 30 });
  });

  it("loads sanitised settings (FIXES L7)", () => {
    useLithophaneStore.getState().loadSettings({ width: 5000, shape: "pentagon", moonBg: false, evil: "<script>" });
    const s = useLithophaneStore.getState().settings;
    expect(s.width).toBe(300);
    expect(s.shape).toBe(DEFAULTS.shape);
    expect(s.moonBackground).toBe(false);
    expect(s).not.toHaveProperty("evil");
  });

  it("autosaves only the settings (FIXES P6)", () => {
    useLithophaneStore.getState().set("brightness", 25);
    const saved = JSON.parse(storage.getItem(SETTINGS_STORAGE_KEY) ?? "null");
    expect(Object.keys(saved.state)).toEqual(["settings"]);
    expect(saved.state.settings.brightness).toBe(25);
  });

  it("rehydrates through sanitizeSettings", async () => {
    storage.setItem(
      SETTINGS_STORAGE_KEY,
      JSON.stringify({ version: 1, state: { settings: { shape: "heart", width: 0, gamma: "2", junk: true } } }),
    );
    await useLithophaneStore.persist.rehydrate();
    const s = useLithophaneStore.getState().settings;
    expect(s).toMatchObject({ shape: "heart", width: 20, gamma: 2, invert: DEFAULTS.invert });
    expect(s).not.toHaveProperty("junk");
    expect(typeof useLithophaneStore.getState().set).toBe("function");
  });

  it("keeps the current settings when nothing is stored", async () => {
    useLithophaneStore.getState().set("brightness", 12);
    storage.clear();
    await useLithophaneStore.persist.rehydrate();
    expect(useLithophaneStore.getState().settings.brightness).toBe(12);
  });
});

describe("useLithophaneHistory", () => {
  const history = () => useLithophaneHistory.getState();
  const settings = () => useLithophaneStore.getState().settings;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
    useLithophaneHistory.getState().clear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("undoes and redoes design edits, merging quick successive changes", () => {
    const { set } = useLithophaneStore.getState();
    set("imageScale", 70);
    vi.advanceTimersByTime(100);
    set("imageScale", 80);
    vi.advanceTimersByTime(600);
    set("brightness", 20);
    history().undo();
    expect(settings()).toMatchObject({ imageScale: 80, brightness: 0 });
    history().undo();
    expect(settings().imageScale).toBe(DEFAULTS.imageScale);
    expect(history().canUndo).toBe(false);
    history().redo();
    history().redo();
    expect(settings()).toMatchObject({ imageScale: 80, brightness: 20 });
  });

  it("never records or reverts viewer toggles and the file format", () => {
    const { set } = useLithophaneStore.getState();
    set("wireframe", true);
    set("format", "stl-ascii");
    expect(history().canUndo).toBe(false);
    vi.advanceTimersByTime(600);
    set("imageX", 25);
    vi.advanceTimersByTime(600);
    set("backlight", false);
    history().undo();
    expect(settings()).toMatchObject({ imageX: 0, wireframe: true, backlight: false, format: "stl-ascii" });
    expect(designSettings(settings())).not.toHaveProperty("wireframe");
  });

  it("keeps a gesture (begin/end) as one step, apart from the edits around it", () => {
    const { set, setMany } = useLithophaneStore.getState();
    set("rotation", 10);
    history().begin();
    setMany({ imageX: 5, imageY: 5 });
    vi.advanceTimersByTime(2000);
    setMany({ imageX: 30, imageY: -10 });
    history().end();
    history().undo();
    expect(settings()).toMatchObject({ rotation: 10, imageX: 0, imageY: 0 });
    history().undo();
    expect(settings().rotation).toBe(0);
  });

  it("makes reset, load, presets and section resets single undo steps", () => {
    const store = useLithophaneStore.getState();
    store.set("brightness", 30);
    store.applyStep({ imageScale: 35, imageX: 0, imageY: 0 });
    history().undo();
    expect(settings()).toMatchObject({ brightness: 30, imageScale: DEFAULTS.imageScale });
    history().redo();
    store.resetAll();
    expect(settings()).toEqual(DEFAULTS);
    history().undo();
    expect(settings()).toMatchObject({ brightness: 30, imageScale: 35 });
    store.loadSettings({ shape: "heart", width: 110 });
    history().undo();
    expect(settings()).toMatchObject({ shape: "sphere", brightness: 30 });
    store.resetSection("tone");
    expect(settings().brightness).toBe(0);
    history().undo();
    expect(settings().brightness).toBe(30);
  });

  it("starts empty after loading the autosave", async () => {
    useLithophaneStore.getState().set("brightness", 10);
    expect(history().canUndo).toBe(true);
    storage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify({ version: 1, state: { settings: { shape: "heart", brightness: 40 } } }));
    await useLithophaneStore.persist.rehydrate();
    expect(settings()).toMatchObject({ shape: "heart", brightness: 40 });
    expect(history().canUndo).toBe(false);
  });

  it("autosaves what undo restores", () => {
    const { set } = useLithophaneStore.getState();
    set("contrast", 2);
    history().undo();
    const saved = JSON.parse(storage.getItem(SETTINGS_STORAGE_KEY) ?? "null");
    expect(saved.state.settings.contrast).toBe(DEFAULTS.contrast);
  });
});
