import { describe, expect, it } from "vitest";
import { formatShortcutKeys, matchShortcut, parseShortcut, toAriaKeyShortcuts } from "./keys";
import { decimalsOf, parseLooseNumber } from "./field";
import { acceptsFile, describeAccept } from "./file-drop";
import { normalizeHex } from "./color-field";

type KeyInit = Partial<Pick<KeyboardEvent, "key" | "code" | "metaKey" | "ctrlKey" | "altKey" | "shiftKey">>;
const key = (init: KeyInit) =>
  ({ key: "", code: "", metaKey: false, ctrlKey: false, altKey: false, shiftKey: false, ...init }) as KeyboardEvent;

describe("shortcuts", () => {
  it("parses modifiers and aliases", () => {
    expect(parseShortcut("mod+s")).toMatchObject({ key: "s", mod: true, shift: false });
    expect(parseShortcut("Shift+Esc")).toMatchObject({ key: "escape", shift: true });
    expect(parseShortcut("mod++")).toMatchObject({ key: "+", mod: true });
  });

  it("maps mod to ⌘ on Apple and Ctrl elsewhere", () => {
    const s = parseShortcut("mod+s");
    expect(matchShortcut(key({ key: "s", metaKey: true }), s, true)).toBe(true);
    expect(matchShortcut(key({ key: "s", ctrlKey: true }), s, true)).toBe(false);
    expect(matchShortcut(key({ key: "s", ctrlKey: true }), s, false)).toBe(true);
    expect(matchShortcut(key({ key: "s" }), s, false)).toBe(false);
  });

  it("rejects extra modifiers and shifted letters, but allows shift for symbols", () => {
    expect(matchShortcut(key({ key: "w", ctrlKey: true }), parseShortcut("w"), false)).toBe(false);
    expect(matchShortcut(key({ key: "W", shiftKey: true }), parseShortcut("w"), false)).toBe(false);
    expect(matchShortcut(key({ key: "?", shiftKey: true }), parseShortcut("?"), false)).toBe(true);
  });

  it("falls back to physical codes for digits and letters", () => {
    expect(matchShortcut(key({ key: "&", code: "Digit1" }), parseShortcut("1"), false)).toBe(true);
    expect(matchShortcut(key({ key: "π", code: "KeyP", altKey: true }), parseShortcut("alt+p"), true)).toBe(true);
  });

  it("formats key caps and aria-keyshortcuts", () => {
    expect(formatShortcutKeys("mod+s", true)).toEqual(["⌘", "S"]);
    expect(formatShortcutKeys("mod+s", false)).toEqual(["Ctrl", "S"]);
    expect(formatShortcutKeys("esc", false)).toEqual(["Esc"]);
    expect(toAriaKeyShortcuts("mod+e")).toBe("Meta+E Control+E");
    expect(toAriaKeyShortcuts("w")).toBe("W");
  });
});

describe("number parsing", () => {
  it("parses loosely", () => {
    expect(parseLooseNumber("12 mm")).toBe(12);
    expect(parseLooseNumber("−3")).toBe(-3);
    expect(parseLooseNumber("0,5")).toBe(0.5);
    expect(parseLooseNumber("+85%")).toBe(85);
    expect(parseLooseNumber(".25")).toBe(0.25);
    expect(parseLooseNumber("abc")).toBeNaN();
  });

  it("counts step decimals", () => {
    expect(decimalsOf(1)).toBe(0);
    expect(decimalsOf(0.1)).toBe(1);
    expect(decimalsOf(0.05 * 100)).toBe(0);
    expect(decimalsOf(0.01)).toBe(2);
  });
});

describe("file accept matching", () => {
  const photo = "image/jpeg,image/png,image/webp";

  it("accepts by MIME type or by extension when the type is missing", () => {
    expect(acceptsFile(new File(["x"], "a.jpg", { type: "image/jpeg" }), photo)).toBe(true);
    expect(acceptsFile(new File(["x"], "SCAN.PNG", { type: "" }), photo)).toBe(true);
    expect(acceptsFile(new File(["x"], "b.jpeg", { type: "" }), photo)).toBe(true);
    expect(acceptsFile(new File(["x"], "c.gif", { type: "image/gif" }), photo)).toBe(false);
    expect(acceptsFile(new File(["x"], "d.svg", { type: "" }), "image/svg+xml,image/png")).toBe(true);
    expect(acceptsFile(new File(["x"], "e.json", { type: "" }), ".json")).toBe(true);
    expect(acceptsFile(new File(["x"], "f.bin", { type: "image/avif" }), "image/*")).toBe(true);
  });

  it("describes accepted formats in words", () => {
    expect(describeAccept(photo)).toBe("a JPG, PNG or WebP file");
    expect(describeAccept("image/svg+xml,image/png")).toBe("a SVG or PNG file");
    expect(describeAccept("")).toBe("a file");
  });
});

describe("hex colours", () => {
  it("normalises shorthand and case", () => {
    expect(normalizeHex("#ABC")).toBe("#aabbcc");
    expect(normalizeHex("3f49c9")).toBe("#3f49c9");
    expect(normalizeHex("#3F49C9")).toBe("#3f49c9");
    expect(normalizeHex("#12345")).toBeNull();
    expect(normalizeHex("red")).toBeNull();
  });
});
