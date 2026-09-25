"use client";

import { useCallback, useEffect, useState } from "react";
import { geometryKey, hasPrintableText, type KeychainGeometry } from "./derive";
import { ensureFontLoaded } from "./fonts";
import { rasterizeKeychain } from "./rasterize";
import { DEFAULTS } from "./settings";
import { PREVIEW_DEBOUNCE_MS } from "./use-keychain-preview";

/**
 * Density of the 2D "Outline" view. The 4 px/mm mesh raster looks soft when a 25 mm plate fills the
 * stage, so the view gets its own sharper raster; it is only computed while the view is showing.
 */
export const OUTLINE_VIEW_DPMM = 8;

const FALLBACK_MESSAGE = "The outline couldn't be drawn. Try again.";

export interface KeychainOutline {
  /** White plate, grey letters, transparent hole (from `rasterizeKeychain`). Null until the first raster. */
  canvas: HTMLCanvasElement | null;
  /** True while the canvas is older than the settings. */
  updating: boolean;
  error: string | null;
  retry: () => void;
}

interface OutlineState {
  key: string;
  attempt: number;
  canvas: HTMLCanvasElement | null;
  error: string | null;
}

/** Sharp 2D silhouette of the keychain for the stage's "Outline" view. */
export function useKeychainOutline(geometry: KeychainGeometry, enabled: boolean): KeychainOutline {
  const { text, font, targetHeight, baseThickness, textThickness, outlineWidth, holeSize } = geometry;
  const key = geometryKey(geometry);
  const [state, setState] = useState<OutlineState | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!enabled || !hasPrintableText(text)) return;
    const g: KeychainGeometry = { text, font, targetHeight, baseThickness, textThickness, outlineWidth, holeSize };
    const requestKey = geometryKey(g);
    let active = true;

    const run = async () => {
      await ensureFontLoaded(font, text);
      if (!active) return;
      try {
        const raster = rasterizeKeychain({ ...DEFAULTS, ...g }, OUTLINE_VIEW_DPMM);
        setState({ key: requestKey, attempt, canvas: raster.outline, error: null });
      } catch (error) {
        const message = error instanceof Error && error.message ? error.message : FALLBACK_MESSAGE;
        setState((prev) => ({ key: requestKey, attempt, canvas: prev?.canvas ?? null, error: message }));
      }
    };

    const timer = window.setTimeout(() => void run(), PREVIEW_DEBOUNCE_MS);
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [enabled, text, font, targetHeight, baseThickness, textThickness, outlineWidth, holeSize, attempt]);

  const retry = useCallback(() => setAttempt((a) => a + 1), []);
  const current = state !== null && state.key === key && state.attempt === attempt;

  return {
    canvas: state?.canvas ?? null,
    updating: !current,
    error: current ? state.error : null,
    retry,
  };
}
