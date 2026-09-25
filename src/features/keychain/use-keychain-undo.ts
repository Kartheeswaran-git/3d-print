"use client";

import { useCallback, useEffect, useEffectEvent, useState } from "react";
import { detectMac, isInsideDialog, matchShortcut, parseShortcut } from "@/components/ui/keys";
import { changedSettingLabels, historyAnnouncement } from "./derive";
import type { KeychainSettings } from "./settings";
import { keychainStore, useKeychainHistory } from "./store";

export const UNDO_SHORTCUT = "mod+z";
export const REDO_SHORTCUT = "mod+shift+z";
/** Windows-style alternative for redo. */
export const REDO_ALT_SHORTCUT = "mod+y";

const UNDO_KEYS = parseShortcut(UNDO_SHORTCUT);
const REDO_KEYS = [parseShortcut(REDO_SHORTCUT), parseShortcut(REDO_ALT_SHORTCUT)];

const NON_TEXT_INPUTS = new Set(["checkbox", "radio", "button", "submit", "reset", "range", "color", "file", "image"]);

/** Fields with their own text undo (the name, hex values, typed slider values): leave ⌘Z to the browser there. */
function isTextEditingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable || target instanceof HTMLTextAreaElement) return true;
  return target instanceof HTMLInputElement && !NON_TEXT_INPUTS.has(target.type);
}

export interface KeychainUndo {
  canUndo: boolean;
  canRedo: boolean;
  undo: () => void;
  redo: () => void;
  /** Open / close an undo group around a continuous gesture (slider drag). */
  begin: () => void;
  end: () => void;
  /** Apply a patch as its own undo step (a preset, a font or format pick). */
  applyStep: (patch: Partial<KeychainSettings>) => void;
  /** Run a discrete action (reset, opening a project) as one undo step. */
  batch: (action: () => void) => void;
  /** Polite screen-reader text naming what the last undo / redo changed. */
  announcement: string;
}

/**
 * Undo / redo for the keychain studio: toolbar actions, the ⌘Z / ⇧⌘Z / ⌘Y shortcuts (also while a slider
 * has focus, but not while typing in a text field) and an announcement of what changed.
 */
export function useKeychainUndo(): KeychainUndo {
  const canUndo = useKeychainHistory((h) => h.canUndo);
  const canRedo = useKeychainHistory((h) => h.canRedo);
  const [announcement, setAnnouncement] = useState("");

  const travel = useCallback((direction: "undo" | "redo") => {
    const history = useKeychainHistory.getState();
    const target = direction === "undo" ? history.peekUndo() : history.peekRedo();
    if (!target) return;
    const labels = changedSettingLabels(keychainStore.getState().settings, target);
    if (direction === "undo") history.undo();
    else history.redo();
    const message = historyAnnouncement(direction, labels);
    // A repeated message is still announced when the text changes.
    setAnnouncement((prev) => (prev === message ? `${message} ` : message));
  }, []);

  const undo = useCallback(() => travel("undo"), [travel]);
  const redo = useCallback(() => travel("redo"), [travel]);

  const onKeyDown = useEffectEvent((e: KeyboardEvent) => {
    if (e.defaultPrevented || e.isComposing) return;
    if (isInsideDialog(e.target) || isTextEditingTarget(e.target)) return;
    const isMac = detectMac();
    if (matchShortcut(e, UNDO_KEYS, isMac)) {
      e.preventDefault();
      undo();
    } else if (REDO_KEYS.some((keys) => matchShortcut(e, keys, isMac))) {
      e.preventDefault();
      redo();
    }
  });

  useEffect(() => {
    const listener = (e: KeyboardEvent) => onKeyDown(e);
    window.addEventListener("keydown", listener);
    return () => window.removeEventListener("keydown", listener);
  }, []);

  const begin = useCallback(() => useKeychainHistory.getState().begin(), []);
  const end = useCallback(() => useKeychainHistory.getState().end(), []);
  const batch = useCallback((action: () => void) => useKeychainHistory.getState().batch(action), []);
  const applyStep = useCallback(
    (patch: Partial<KeychainSettings>) => useKeychainHistory.getState().batch(() => keychainStore.getState().update(patch)),
    [],
  );

  return { canUndo, canRedo, undo, redo, begin, end, applyStep, batch, announcement };
}
