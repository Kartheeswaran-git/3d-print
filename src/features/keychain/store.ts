import { useEffect, useSyncExternalStore } from "react";
import { createStore, useStore } from "zustand";
import { persist, type PersistStorage, type StateStorage, type StorageValue } from "zustand/middleware";
import { attachHistory } from "@/lib/state/history";
import { resetKeys } from "./derive";
import { DEFAULTS, sanitizeSettings, type KeychainSettings } from "./settings";

/** localStorage key for the autosaved keychain settings (FIXES P6). */
export const SETTINGS_STORAGE_KEY = "luna-keychain-settings";

export interface KeychainStoreState {
  settings: KeychainSettings;
  /** Merge a patch; every value goes through `sanitizeSettings` (clamped, snapped, validated). */
  update: (patch: Partial<KeychainSettings>) => void;
  /** Replace every setting, e.g. after opening a project file. */
  replace: (settings: KeychainSettings) => void;
  /** Restore `keys` (or everything) to their defaults. */
  reset: (keys?: readonly (keyof KeychainSettings)[]) => void;
}

interface PersistedKeychain {
  settings: KeychainSettings;
}

function sameSettings(a: KeychainSettings, b: KeychainSettings): boolean {
  return (Object.keys(a) as (keyof KeychainSettings)[]).every((k) => a[k] === b[k]);
}

function browserStorage(): StateStorage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    // Access to storage can throw (blocked cookies, sandboxed frames).
    return null;
  }
}

/**
 * JSON storage that never throws: unreadable or corrupt data counts as "nothing saved" (so hydration
 * always finishes) and failed writes (quota, private mode) are ignored — autosave is a convenience.
 */
export function createSafeStorage(getStorage: () => StateStorage | null = browserStorage): PersistStorage<PersistedKeychain> {
  return {
    getItem: (name) => {
      try {
        const raw = getStorage()?.getItem(name);
        if (typeof raw !== "string" || !raw) return null;
        const parsed: unknown = JSON.parse(raw);
        return parsed && typeof parsed === "object" ? (parsed as StorageValue<PersistedKeychain>) : null;
      } catch {
        return null;
      }
    },
    setItem: (name, value) => {
      try {
        getStorage()?.setItem(name, JSON.stringify(value));
      } catch {
        // Storage full or unavailable: keep working without autosave.
      }
    },
    removeItem: (name) => {
      try {
        getStorage()?.removeItem(name);
      } catch {
        // Nothing to clean up.
      }
    },
  };
}

/**
 * Keychain settings store with autosave. Hydration is manual (`skipHydration`) so server and first client
 * render agree; persisted data is merged through `sanitizeSettings`, whatever its version or shape.
 */
export function createKeychainStore(storage: PersistStorage<PersistedKeychain> = createSafeStorage()) {
  return createStore<KeychainStoreState>()(
    persist(
      (set, get) => {
        const commit = (next: KeychainSettings) => {
          if (!sameSettings(next, get().settings)) set({ settings: next });
        };
        return {
          settings: { ...DEFAULTS },
          update: (patch) => commit(sanitizeSettings({ ...get().settings, ...patch })),
          replace: (settings) => commit(sanitizeSettings(settings)),
          reset: (keys) => commit(resetKeys(get().settings, keys)),
        };
      },
      {
        name: SETTINGS_STORAGE_KEY,
        version: 1,
        storage,
        skipHydration: true,
        partialize: (state) => ({ settings: state.settings }),
        // Older or newer shapes are accepted as-is; `merge` sanitises them.
        migrate: (persisted) => persisted as PersistedKeychain,
        merge: (persisted, current) => {
          const saved = persisted && typeof persisted === "object" ? (persisted as { settings?: unknown }).settings : undefined;
          return saved === undefined ? current : { ...current, settings: sanitizeSettings(saved) };
        },
      },
    ),
  );
}

export type KeychainStore = ReturnType<typeof createKeychainStore>;

/** The app-wide keychain store. */
export const keychainStore: KeychainStore = createKeychainStore();

/**
 * Undo / redo for the keychain settings (FEATURE §2). Edits less than 500 ms apart form one step, slider
 * drags are grouped with `begin()` / `end()`, and discrete actions (presets, reset, opening a project) run
 * through `batch()` so each is exactly one step. Loading the autosave clears it, so the first undo never
 * reverts to the defaults. Use as a hook (`useKeychainHistory((h) => h.canUndo)`) or via `getState()`.
 */
export const useKeychainHistory = attachHistory(keychainStore);

/** Select from the keychain store. */
export function useKeychainStore<T>(selector: (state: KeychainStoreState) => T): T {
  return useStore(keychainStore, selector);
}

const subscribeHydration = (onChange: () => void) => keychainStore.persist.onFinishHydration(onChange);
const getHydrated = () => keychainStore.persist.hasHydrated();
const getServerHydrated = () => false;

/**
 * Load the autosaved settings after mount and report when they are in place. The studio waits for this
 * before its first preview so it never meshes (and frames the camera on) the defaults by mistake.
 */
export function useKeychainHydration(): boolean {
  const hydrated = useSyncExternalStore(subscribeHydration, getHydrated, getServerHydrated);
  useEffect(() => {
    if (!keychainStore.persist.hasHydrated()) void keychainStore.persist.rehydrate();
  }, []);
  return hydrated;
}
