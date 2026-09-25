import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { StateStorage } from "zustand/middleware";
import { attachHistory } from "@/lib/state/history";
import { DEFAULTS, NUMERIC } from "./settings";
import { SETTINGS_STORAGE_KEY, createKeychainStore, createSafeStorage } from "./store";

function memoryStorage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  const storage: StateStorage = {
    getItem: (name) => data.get(name) ?? null,
    setItem: (name, value) => {
      data.set(name, value);
    },
    removeItem: (name) => {
      data.delete(name);
    },
  };
  return { data, storage };
}

function storeWith(initial: Record<string, string> = {}) {
  const mem = memoryStorage(initial);
  return { ...mem, store: createKeychainStore(createSafeStorage(() => mem.storage)) };
}

describe("keychain store", () => {
  it("starts at the defaults and waits for manual hydration", () => {
    const { store } = storeWith({ [SETTINGS_STORAGE_KEY]: JSON.stringify({ state: { settings: { text: "Ada" } }, version: 1 }) });
    expect(store.getState().settings).toEqual(DEFAULTS);
    expect(store.persist.hasHydrated()).toBe(false);
  });

  it("sanitises every update (clamp, snap, validate)", () => {
    const { store } = storeWith();
    store.getState().update({ targetHeight: 500, baseThickness: 2.04, textColor: "orange", text: "Ada\u0007  Lovelace" });
    const s = store.getState().settings;
    expect(s.targetHeight).toBe(NUMERIC.targetHeight.max);
    expect(s.baseThickness).toBe(2);
    expect(s.textColor).toBe(DEFAULTS.textColor);
    expect(s.text).toBe("Ada Lovelace");
  });

  it("skips no-op updates", () => {
    const { store } = storeWith();
    const listener = vi.fn();
    store.subscribe(listener);
    store.getState().update({ targetHeight: DEFAULTS.targetHeight });
    expect(listener).not.toHaveBeenCalled();
    store.getState().update({ targetHeight: 30 });
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("resets chosen keys or everything", () => {
    const { store } = storeWith();
    store.getState().update({ text: "Ada", holeSize: 6, baseColor: "#000000" });
    store.getState().reset(["holeSize"]);
    expect(store.getState().settings).toMatchObject({ text: "Ada", holeSize: DEFAULTS.holeSize, baseColor: "#000000" });
    store.getState().reset();
    expect(store.getState().settings).toEqual(DEFAULTS);
  });

  it("replaces all settings through the sanitiser (project load)", () => {
    const { store } = storeWith();
    store.getState().replace({ ...DEFAULTS, text: "Grace", holeSize: 99 });
    expect(store.getState().settings).toMatchObject({ text: "Grace", holeSize: NUMERIC.holeSize.max });
  });

  it("autosaves only the settings", () => {
    const { store, data } = storeWith();
    store.getState().update({ text: "Ada" });
    const saved = JSON.parse(data.get(SETTINGS_STORAGE_KEY) ?? "null");
    expect(saved).toEqual({ state: { settings: { ...DEFAULTS, text: "Ada" } }, version: 1 });
  });

  it("rehydrates through sanitizeSettings, whatever the version", async () => {
    const saved = { state: { settings: { text: "Grace", targetHeight: 999, font: "comic-sans", evil: "x" } }, version: 7 };
    const { store } = storeWith({ [SETTINGS_STORAGE_KEY]: JSON.stringify(saved) });
    await store.persist.rehydrate();
    expect(store.persist.hasHydrated()).toBe(true);
    const s = store.getState().settings;
    expect(s).toMatchObject({ text: "Grace", targetHeight: NUMERIC.targetHeight.max, font: DEFAULTS.font });
    expect(s).not.toHaveProperty("evil");
  });

  it("finishes hydration with defaults when the saved data is corrupt", async () => {
    const { store } = storeWith({ [SETTINGS_STORAGE_KEY]: "{not json" });
    await store.persist.rehydrate();
    expect(store.persist.hasHydrated()).toBe(true);
    expect(store.getState().settings).toEqual(DEFAULTS);
  });

  it("keeps working when storage is unavailable or full", async () => {
    const failing: StateStorage = {
      getItem: () => {
        throw new Error("SecurityError");
      },
      setItem: () => {
        throw new Error("QuotaExceededError");
      },
      removeItem: () => {
        throw new Error("SecurityError");
      },
    };
    const store = createKeychainStore(createSafeStorage(() => failing));
    await store.persist.rehydrate();
    expect(store.persist.hasHydrated()).toBe(true);
    expect(() => store.getState().update({ text: "Ada" })).not.toThrow();
    expect(store.getState().settings.text).toBe("Ada");
  });
});

describe("keychain undo history", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  /** Let the coalescing window (500 ms) pass so the next edit is a new step. */
  const pause = () => vi.advanceTimersByTime(600);

  it("undoes and redoes sanitised edits, and autosave follows", () => {
    const { store, data } = storeWith();
    const history = attachHistory(store);
    store.getState().update({ targetHeight: 30 });
    pause();
    store.getState().update({ text: "Ada" });
    expect(history.getState().canUndo).toBe(true);

    history.getState().undo();
    expect(store.getState().settings).toEqual({ ...DEFAULTS, targetHeight: 30 });
    expect(JSON.parse(data.get(SETTINGS_STORAGE_KEY) ?? "null").state.settings.text).toBe(DEFAULTS.text);

    history.getState().undo();
    expect(store.getState().settings).toEqual(DEFAULTS);
    expect(history.getState().canUndo).toBe(false);

    history.getState().redo();
    history.getState().redo();
    expect(store.getState().settings).toEqual({ ...DEFAULTS, targetHeight: 30, text: "Ada" });
  });

  it("merges quick typing into one step and groups a slider drag", () => {
    const { store } = storeWith();
    const history = attachHistory(store);
    for (const text of ["A", "Ad", "Ada"]) {
      store.getState().update({ text });
      vi.advanceTimersByTime(150);
    }
    pause();
    history.getState().begin();
    for (const outlineWidth of [4.5, 5, 5.5, 6]) {
      store.getState().update({ outlineWidth });
      vi.advanceTimersByTime(900);
    }
    history.getState().end();

    history.getState().undo();
    expect(store.getState().settings).toMatchObject({ text: "Ada", outlineWidth: DEFAULTS.outlineWidth });
    history.getState().undo();
    expect(store.getState().settings.text).toBe(DEFAULTS.text);
  });

  it("makes reset and project load single steps, even right after an edit", () => {
    const { store } = storeWith();
    const history = attachHistory(store);
    store.getState().update({ text: "Ada", holeSize: 6 });
    vi.advanceTimersByTime(100);
    history.getState().batch(() => store.getState().reset());
    vi.advanceTimersByTime(100);
    history.getState().batch(() => store.getState().replace({ ...DEFAULTS, text: "Grace", font: "pacifico" }));

    history.getState().undo();
    expect(store.getState().settings).toEqual(DEFAULTS);
    history.getState().undo();
    expect(store.getState().settings).toMatchObject({ text: "Ada", holeSize: 6 });
  });

  it("does not count loading the autosave as an undo step", async () => {
    const saved = { state: { settings: { ...DEFAULTS, text: "Grace" } }, version: 1 };
    const { store } = storeWith({ [SETTINGS_STORAGE_KEY]: JSON.stringify(saved) });
    const history = attachHistory(store);
    await store.persist.rehydrate();
    expect(store.getState().settings.text).toBe("Grace");
    expect(history.getState().canUndo).toBe(false);
  });

  it("ignores no-op edits", () => {
    const { store } = storeWith();
    const history = attachHistory(store);
    store.getState().update({ baseColor: DEFAULTS.baseColor.toUpperCase() });
    expect(history.getState().canUndo).toBe(false);
  });
});
