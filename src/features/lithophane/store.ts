import { useEffect } from "react";
import { create, type StoreApi } from "zustand";
import { createJSONStorage, persist, type StateStorage } from "zustand/middleware";
import { wrapDegrees } from "@/lib/image/project";
import { attachHistory } from "@/lib/state/history";
import { snap } from "@/lib/utils";
import { sectionDefaults, type SectionId } from "./sections";
import { DEFAULTS, NUMERIC, resizeWithLock, sanitizeSettings, type LithophaneSettings, type NumericKey } from "./settings";

export const SETTINGS_STORAGE_KEY = "luna-lithophane-settings";

export interface LithophaneStore {
  settings: LithophaneSettings;
  /** Set one setting (numbers are clamped and snapped to their step). */
  set: <K extends keyof LithophaneSettings>(key: K, value: LithophaneSettings[K]) => void;
  setMany: (patch: Partial<LithophaneSettings>) => void;
  /** Apply a discrete change (placement preset, starter design) as exactly one undo step. */
  applyStep: (patch: Partial<LithophaneSettings>) => void;
  /** Width/height edit that keeps the current ratio while the lock is on (FIXES L1). */
  resize: (key: "width" | "height", value: number) => void;
  /** Reset one inspector section; one undo step. */
  resetSection: (section: SectionId) => void;
  /** Back to the defaults; one undo step. */
  resetAll: () => void;
  /** Replace all settings (e.g. from a project file); values are sanitised. One undo step. */
  loadSettings: (settings: unknown) => void;
}

function normalize<K extends keyof LithophaneSettings>(key: K, value: LithophaneSettings[K]): LithophaneSettings[K] {
  if (typeof value !== "number" || !(key in NUMERIC)) return value;
  const spec = NUMERIC[key as NumericKey];
  // Turning the moon past the far side keeps turning (190° is −170°); values in range are left as they
  // are, so the slider's −180 end doesn't jump to +180.
  const v = key === "moonLongitude" && (value < spec.min || value > spec.max) ? wrapDegrees(value) : value;
  return snap(v, spec.min, spec.max, spec.step) as LithophaneSettings[K];
}

function applyPatch(settings: LithophaneSettings, patch: Partial<LithophaneSettings>): LithophaneSettings {
  const next = { ...settings };
  for (const key of Object.keys(patch) as (keyof LithophaneSettings)[]) {
    const value = patch[key];
    if (value === undefined || !(key in DEFAULTS)) continue;
    Object.assign(next, { [key]: normalize(key, value) });
  }
  return next;
}

/** localStorage that never throws (private mode, blocked storage, server render). */
const safeLocalStorage: StateStorage = {
  getItem: (name) => {
    try {
      return globalThis.localStorage?.getItem(name) ?? null;
    } catch {
      return null;
    }
  },
  setItem: (name, value) => {
    try {
      globalThis.localStorage?.setItem(name, value);
    } catch {
      // Quota or privacy settings: settings simply aren't remembered.
    }
  },
  removeItem: (name) => {
    try {
      globalThis.localStorage?.removeItem(name);
    } catch {
      // Ignore, as above.
    }
  },
};

/** Run a discrete action (reset, load, preset) as its own undo step, never merged with neighbouring edits. */
function asOneStep(action: () => void): void {
  // The history is attached right after the store; actions only run once the module has loaded.
  useLithophaneHistory.getState().batch(action);
}

/**
 * Lithophane settings, autosaved to localStorage (FIXES P6). Hydration is manual
 * (`useHydrateLithophaneSettings`) so the server render and the first client render match.
 */
export const useLithophaneStore = create<LithophaneStore>()(
  persist(
    (set) => ({
      settings: { ...DEFAULTS },
      set: (key, value) => set((state) => ({ settings: applyPatch(state.settings, { [key]: value }) })),
      setMany: (patch) => set((state) => ({ settings: applyPatch(state.settings, patch) })),
      applyStep: (patch) => asOneStep(() => set((state) => ({ settings: applyPatch(state.settings, patch) }))),
      resize: (key, value) => set((state) => ({ settings: { ...state.settings, ...resizeWithLock(state.settings, key, value) } })),
      resetSection: (section) =>
        asOneStep(() => set((state) => ({ settings: { ...state.settings, ...sectionDefaults(section, state.settings.shape) } }))),
      resetAll: () => asOneStep(() => set({ settings: { ...DEFAULTS } })),
      loadSettings: (settings) => asOneStep(() => set({ settings: sanitizeSettings(settings) })),
    }),
    {
      name: SETTINGS_STORAGE_KEY,
      version: 1,
      storage: createJSONStorage(() => safeLocalStorage),
      skipHydration: true,
      partialize: (state) => ({ settings: state.settings }),
      // Stored settings may be old, hand-edited or from another version: always sanitise.
      migrate: (persisted) => persisted,
      merge: (persisted, current) => {
        if (!persisted || typeof persisted !== "object" || !("settings" in persisted)) return current;
        return { ...current, settings: sanitizeSettings((persisted as { settings: unknown }).settings) };
      },
    },
  ),
);

// ── Undo history ──────────────────────────────────────────────────────────────────────────────────

/** Viewer toggles and the file format: preferences rather than part of the design, so undo leaves them alone. */
export const VIEW_PREFERENCE_KEYS = ["wireframe", "backlight", "format"] as const satisfies readonly (keyof LithophaneSettings)[];
type ViewPreferenceKey = (typeof VIEW_PREFERENCE_KEYS)[number];

/** The settings that undo/redo track. */
export type DesignSettings = Omit<LithophaneSettings, ViewPreferenceKey>;

export function designSettings(settings: LithophaneSettings): DesignSettings {
  const out: Partial<LithophaneSettings> = { ...settings };
  for (const key of VIEW_PREFERENCE_KEYS) delete out[key];
  return out as DesignSettings;
}

type DesignState = { settings: DesignSettings };

/**
 * The design part of the settings seen as a store of its own. Changes that only touch view preferences
 * look like no change to the history, and undo/redo merge their snapshot into the current settings (which
 * goes through persist, so the autosave follows).
 */
const designStore: StoreApi<DesignState> = {
  getState: () => ({ settings: designSettings(useLithophaneStore.getState().settings) }),
  getInitialState: () => ({ settings: designSettings(useLithophaneStore.getInitialState().settings) }),
  setState: (partial: DesignState | Partial<DesignState> | ((state: DesignState) => DesignState | Partial<DesignState>)) => {
    const next = typeof partial === "function" ? partial(designStore.getState()) : partial;
    const design = next.settings;
    if (design) useLithophaneStore.setState((state) => ({ settings: { ...state.settings, ...design } }));
  },
  subscribe: (listener) =>
    useLithophaneStore.subscribe((state, prev) => {
      if (state.settings !== prev.settings) {
        listener({ settings: designSettings(state.settings) }, { settings: designSettings(prev.settings) });
      }
    }),
};

/**
 * Undo/redo for the moon lamp design. Edits within 500 ms merge; slider drags and 3D / layout gestures are
 * grouped with begin()/end(); reset, load, presets and starter designs are single steps.
 */
export const useLithophaneHistory = attachHistory(designStore);

// Loading the autosave replaces the document: the first undo must never go back to the defaults.
useLithophaneStore.persist.onFinishHydration(() => useLithophaneHistory.getState().clear());

/** Load the autosaved settings once on the client (after hydration, so SSR markup matches). */
export function useHydrateLithophaneSettings(): void {
  useEffect(() => {
    // Once per page load: coming back to the studio keeps the live settings and their undo history.
    if (!useLithophaneStore.persist.hasHydrated()) void useLithophaneStore.persist.rehydrate();
  }, []);
}
