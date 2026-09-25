"use client";

import { useEffect, useEffectEvent } from "react";
import { detectMac, isInsideDialog, matchShortcut, parseShortcut } from "@/components/ui/keys";

const UNDO = parseShortcut("mod+z");
const REDO = [parseShortcut("mod+shift+z"), parseShortcut("mod+y")];

/** Input types where the browser's own text undo should win. */
const TEXT_INPUT_TYPES = new Set(["text", "search", "url", "tel", "email", "password", "number", ""]);

/** Typing targets: text fields, text areas and editable content. Sliders, buttons and the canvas are not. */
export function isTextEntry(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable || target instanceof HTMLTextAreaElement) return true;
  return target instanceof HTMLInputElement && TEXT_INPUT_TYPES.has(target.type);
}

/**
 * Undo (mod+Z) and redo (mod+shift+Z, mod+Y) anywhere on the page — including while a slider or the layout
 * editor has focus — but not while typing in a text field (its own text undo applies) or inside a dialog.
 * Held keys repeat, so holding mod+Z walks back through the steps.
 */
export function useHistoryShortcuts(history: { undo: () => void; redo: () => void }): void {
  const onKeyDown = useEffectEvent((event: KeyboardEvent) => {
    if (event.defaultPrevented || event.isComposing) return;
    if (isTextEntry(event.target) || isInsideDialog(event.target)) return;
    const isMac = detectMac();
    if (matchShortcut(event, UNDO, isMac)) {
      event.preventDefault();
      history.undo();
    } else if (REDO.some((shortcut) => matchShortcut(event, shortcut, isMac))) {
      event.preventDefault();
      history.redo();
    }
  });

  useEffect(() => {
    const listener = (event: KeyboardEvent) => onKeyDown(event);
    window.addEventListener("keydown", listener);
    return () => window.removeEventListener("keydown", listener);
  }, []);
}
