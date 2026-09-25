import { useSyncExternalStore } from "react";

/** A parsed keyboard shortcut such as "mod+s", "shift+?" or "1". */
export interface ParsedShortcut {
  key: string;
  mod: boolean;
  ctrl: boolean;
  meta: boolean;
  alt: boolean;
  shift: boolean;
}

const KEY_ALIASES: Record<string, string> = {
  esc: "escape",
  space: " ",
  up: "arrowup",
  down: "arrowdown",
  left: "arrowleft",
  right: "arrowright",
  del: "delete",
  return: "enter",
};

/** Parse "mod+shift+s" style strings. `mod` means ⌘ on Apple platforms and Ctrl elsewhere. */
export function parseShortcut(combo: string): ParsedShortcut {
  const raw = combo.trim().toLowerCase();
  // A trailing "+" is the plus key itself ("mod++").
  const parts = raw.endsWith("++") ? [...raw.slice(0, -2).split("+"), "+"] : raw.split("+");
  const last = parts.pop() ?? "";
  const key = KEY_ALIASES[last] ?? last;
  const mods = new Set(parts.map((p) => p.trim()));
  return {
    key,
    mod: mods.has("mod"),
    ctrl: mods.has("ctrl") || mods.has("control"),
    meta: mods.has("meta") || mods.has("cmd"),
    alt: mods.has("alt") || mods.has("option"),
    shift: mods.has("shift"),
  };
}

/** True when the keyboard event matches the parsed shortcut exactly (no extra modifiers). */
export function matchShortcut(e: KeyboardEvent, s: ParsedShortcut, isMac: boolean): boolean {
  const wantMeta = s.meta || (s.mod && isMac);
  const wantCtrl = s.ctrl || (s.mod && !isMac);
  if (e.metaKey !== wantMeta || e.ctrlKey !== wantCtrl || e.altKey !== s.alt) return false;
  const isLetter = /^[a-z]$/.test(s.key);
  // Shift is significant for letters; symbols like "?" need it implicitly.
  if (s.shift ? !e.shiftKey : isLetter && e.shiftKey) return false;
  const key = e.key.toLowerCase();
  if (key === s.key) return true;
  // Layout-independent fallbacks (AZERTY digits, Option-modified letters, non-Latin layouts).
  if (/^[0-9]$/.test(s.key)) return e.code === `Digit${s.key}` || e.code === `Numpad${s.key}`;
  if (isLetter) return e.code === `Key${s.key.toUpperCase()}`;
  return false;
}

/** Elements where plain-key shortcuts must not fire because the key has a local meaning. */
export function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  if (target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement) return true;
  if (target instanceof HTMLInputElement) {
    return !["checkbox", "radio", "button", "submit", "reset", "range", "color", "file", "image"].includes(target.type);
  }
  // Listboxes and closed select triggers use letters for type-ahead.
  return target.closest('[role="listbox"],[role="combobox"],[role="menu"],[role="menubar"]') !== null;
}

/** True when focus is inside a modal surface, where page shortcuts should stay quiet. */
export function isInsideDialog(target: EventTarget | null): boolean {
  return target instanceof Element && target.closest('[role="dialog"],[role="alertdialog"]') !== null;
}

export function detectMac(): boolean {
  if (typeof navigator === "undefined") return false;
  return /mac|iphone|ipad|ipod/i.test(navigator.platform || navigator.userAgent);
}

const noopSubscribe = () => () => {};

/** Hydration-safe platform check (false during SSR and hydration, then the real value). */
export function useIsMac(): boolean {
  return useSyncExternalStore(noopSubscribe, detectMac, () => false);
}

const KEY_LABELS: Record<string, string> = {
  escape: "Esc",
  " ": "Space",
  arrowup: "↑",
  arrowdown: "↓",
  arrowleft: "←",
  arrowright: "→",
  enter: "Enter",
  delete: "Del",
  backspace: "⌫",
  tab: "Tab",
};

/** Human-readable key caps for display, e.g. "mod+s" → ["⌘", "S"] or ["Ctrl", "S"]. */
export function formatShortcutKeys(combo: string, isMac: boolean): string[] {
  const s = parseShortcut(combo);
  const caps: string[] = [];
  if (s.ctrl) caps.push(isMac ? "⌃" : "Ctrl");
  if (s.mod) caps.push(isMac ? "⌘" : "Ctrl");
  if (s.meta) caps.push(isMac ? "⌘" : "Win");
  if (s.alt) caps.push(isMac ? "⌥" : "Alt");
  if (s.shift) caps.push(isMac ? "⇧" : "Shift");
  caps.push(KEY_LABELS[s.key] ?? (s.key.length === 1 ? s.key.toUpperCase() : s.key.charAt(0).toUpperCase() + s.key.slice(1)));
  return caps;
}

/** Value for `aria-keyshortcuts`, listing both platform variants for `mod`. */
export function toAriaKeyShortcuts(combo: string): string {
  const s = parseShortcut(combo);
  const key = s.key === " " ? "Space" : s.key.length === 1 ? s.key.toUpperCase() : s.key.charAt(0).toUpperCase() + s.key.slice(1);
  const build = (primary: string | null) =>
    [primary, s.ctrl && "Control", s.meta && "Meta", s.alt && "Alt", s.shift && "Shift", key].filter(Boolean).join("+");
  return s.mod ? `${build("Meta")} ${build("Control")}` : build(null);
}
