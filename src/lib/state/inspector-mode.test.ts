import { afterEach, describe, expect, it, vi } from "vitest";
import { INSPECTOR_MODE_STORAGE_KEY, setInspectorMode } from "./inspector-mode";
import * as keychainMode from "@/features/keychain/use-inspector-mode";
import * as lampMode from "@/features/lithophane/use-inspector-mode";

function fakeStorage(): Storage {
  const data = new Map<string, string>();
  return {
    get length() {
      return data.size;
    },
    clear: () => data.clear(),
    getItem: (key) => data.get(key) ?? null,
    key: (i) => [...data.keys()][i] ?? null,
    removeItem: (key) => void data.delete(key),
    setItem: (key, value) => void data.set(key, String(value)),
  };
}

describe("shared inspector mode", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("is one implementation for both studios", () => {
    expect(lampMode.useInspectorMode).toBe(keychainMode.useInspectorMode);
    expect(lampMode.setInspectorMode).toBe(keychainMode.setInspectorMode);
    expect(lampMode.INSPECTOR_MODE_STORAGE_KEY).toBe(keychainMode.INSPECTOR_MODE_STORAGE_KEY);
  });

  it("stores the bare word", () => {
    const storage = fakeStorage();
    vi.stubGlobal("localStorage", storage);
    setInspectorMode("advanced");
    expect(storage.getItem(INSPECTOR_MODE_STORAGE_KEY)).toBe("advanced");
    setInspectorMode("simple");
    expect(storage.getItem(INSPECTOR_MODE_STORAGE_KEY)).toBe("simple");
  });
});
