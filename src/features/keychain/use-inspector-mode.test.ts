import { describe, expect, it } from "vitest";
import { DEFAULT_INSPECTOR_MODE, INSPECTOR_MODE_STORAGE_KEY, parseInspectorMode } from "./use-inspector-mode";

describe("inspector mode", () => {
  it("defaults to Simple under the shared storage key", () => {
    expect(DEFAULT_INSPECTOR_MODE).toBe("simple");
    expect(INSPECTOR_MODE_STORAGE_KEY).toBe("luna-inspector-mode");
    expect(parseInspectorMode(null)).toBe("simple");
    expect(parseInspectorMode(undefined)).toBe("simple");
  });

  it("reads the bare word or a JSON-encoded word", () => {
    expect(parseInspectorMode("advanced")).toBe("advanced");
    expect(parseInspectorMode(" simple ")).toBe("simple");
    expect(parseInspectorMode('"advanced"')).toBe("advanced");
  });

  it("falls back to Simple for anything else", () => {
    expect(parseInspectorMode("")).toBe("simple");
    expect(parseInspectorMode("expert")).toBe("simple");
    expect(parseInspectorMode('"advanced')).toBe("simple");
    expect(parseInspectorMode('{"mode":"advanced"}')).toBe("simple");
  });
});
