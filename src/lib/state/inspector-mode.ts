"use client";

import { useSyncExternalStore } from "react";

/**
 * Simple / Advanced inspector mode shared by both studios (FEATURE.md §2). One module holds the state, so a
 * choice made in one studio is what the other shows after client-side navigation in the same tab (storage
 * events only reach other tabs).
 */
export type InspectorMode = "simple" | "advanced";

/** localStorage key, stored as the bare word "simple" or "advanced". */
export const INSPECTOR_MODE_STORAGE_KEY = "luna-inspector-mode";
export const DEFAULT_INSPECTOR_MODE: InspectorMode = "simple";

function parseStored(raw: string | null | undefined): InspectorMode | null {
  if (typeof raw !== "string") return null;
  let value: unknown = raw.trim();
  if (typeof value === "string" && value.startsWith('"')) {
    try {
      value = JSON.parse(value);
    } catch {
      return null;
    }
  }
  return value === "advanced" || value === "simple" ? value : null;
}

/** Read a stored mode: the bare word, or the same word JSON-encoded. Anything else is the default. */
export function parseInspectorMode(raw: string | null | undefined): InspectorMode {
  return parseStored(raw) ?? DEFAULT_INSPECTOR_MODE;
}

const listeners = new Set<() => void>();
/** Fallback when storage can't be read or written (private mode, blocked storage, quota). */
let memoryMode: InspectorMode | null = null;

function readStored(): InspectorMode | null {
  try {
    return parseStored(globalThis.localStorage?.getItem(INSPECTOR_MODE_STORAGE_KEY));
  } catch {
    return null;
  }
}

function getSnapshot(): InspectorMode {
  return readStored() ?? memoryMode ?? DEFAULT_INSPECTOR_MODE;
}

function getServerSnapshot(): InspectorMode {
  return DEFAULT_INSPECTOR_MODE;
}

function notify() {
  for (const listener of listeners) listener();
}

function onStorage(event: StorageEvent) {
  // Another tab switched modes (or cleared storage): follow it.
  if (event.key === null || event.key === INSPECTOR_MODE_STORAGE_KEY) notify();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  if (listeners.size === 1) window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) window.removeEventListener("storage", onStorage);
  };
}

export function setInspectorMode(mode: InspectorMode): void {
  memoryMode = mode;
  try {
    globalThis.localStorage?.setItem(INSPECTOR_MODE_STORAGE_KEY, mode);
  } catch {
    // Not remembered across visits. Drop any older stored value so the in-memory choice applies.
    try {
      globalThis.localStorage?.removeItem(INSPECTOR_MODE_STORAGE_KEY);
    } catch {
      // Storage is blocked entirely; memoryMode is already the answer.
    }
  }
  notify();
}

/**
 * Inspector detail level ("simple" by default), remembered on this device. The server render and hydration
 * use the default, then the saved choice applies.
 */
export function useInspectorMode(): [InspectorMode, (mode: InspectorMode) => void] {
  const mode = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  return [mode, setInspectorMode];
}
