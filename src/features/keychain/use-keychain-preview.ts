"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { MeshStats } from "@/lib/geometry/types";
import { CANCELLED_MESSAGE, type MeshWorkerClient } from "@/lib/worker/client";
import type { PreviewPart } from "@/lib/worker/protocol";
import { geometryKey, hasPrintableText, keychainFitKey, toKeychainJob, type KeychainGeometry } from "./derive";
import { ensureFontLoaded } from "./fonts";
import { rasterizeKeychain } from "./rasterize";
import { DEFAULTS, PREVIEW_DPMM } from "./settings";

/** Wait this long after the last change before rasterising (UX §Keychain behaviour). */
export const PREVIEW_DEBOUNCE_MS = 120;

const FALLBACK_MESSAGE = "The preview couldn't be built. Try again.";

/** A preview mesh plus the facts of the job that produced it (a slightly older job may finish first). */
export interface KeychainPreviewMesh {
  /** `geometryKey` of the settings this mesh was built from. */
  key: string;
  parts: PreviewPart[];
  stats: MeshStats;
  /** Camera framing key of this mesh's job. */
  fitKey: string;
  /** Outline width the rasteriser actually used (capped on short plates). */
  outlineMm: number;
}

/**
 * - `waiting`: autosaved settings not loaded yet · `empty`: no name to print (FIXES K11)
 * - `updating`: the shown mesh is older than the settings · `ready` · `error`: the latest request failed
 */
export type KeychainPreviewStatus = "waiting" | "empty" | "updating" | "ready" | "error";

export interface KeychainPreview {
  status: KeychainPreviewStatus;
  /** Latest mesh received (kept while a newer one is on its way, or after an error). */
  mesh: KeychainPreviewMesh | null;
  /** Message of the failed request when `status` is "error". */
  error: string | null;
  retry: () => void;
}

/** Outcomes carry the request sequence number, so a newer success always beats an older failure. */
interface Applied {
  mesh: KeychainPreviewMesh;
  seq: number;
}

interface Failure {
  key: string;
  attempt: number;
  seq: number;
  message: string;
}

/**
 * Live keychain preview: debounce → load the selected font (FIXES K2) → rasterise at PREVIEW_DPMM (FIXES K4)
 * → mesh in the worker. Only geometry settings are inputs, so colour changes never remesh (FIXES K6).
 * Results are applied in request order as they arrive, so dragging a slider shows intermediate meshes.
 */
export function useKeychainPreview(client: MeshWorkerClient, geometry: KeychainGeometry, enabled: boolean): KeychainPreview {
  const { text, font, targetHeight, baseThickness, textThickness, outlineWidth, holeSize } = geometry;
  const key = geometryKey(geometry);
  const [applied, setApplied] = useState<Applied | null>(null);
  const [failure, setFailure] = useState<Failure | null>(null);
  const [attempt, setAttempt] = useState(0);
  const lastSeq = useRef(0);
  const appliedSeq = useRef(0);

  useEffect(() => {
    if (!enabled || !hasPrintableText(text)) return;
    const g: KeychainGeometry = { text, font, targetHeight, baseThickness, textThickness, outlineWidth, holeSize };
    const requestKey = geometryKey(g);
    const seq = ++lastSeq.current;
    let active = true;

    const run = async () => {
      await ensureFontLoaded(font, text);
      if (!active) return;
      try {
        const raster = rasterizeKeychain({ ...DEFAULTS, ...g }, PREVIEW_DPMM);
        const fitKey = keychainFitKey(font, targetHeight, raster.widthMm);
        const outlineMm = raster.outlineMm;
        const result = await client.preview(toKeychainJob(raster, g));
        // null = superseded by a newer request, which will deliver its own mesh.
        if (!result || seq < appliedSeq.current) return;
        appliedSeq.current = seq;
        setApplied({ mesh: { key: requestKey, parts: result.parts, stats: result.stats, fitKey, outlineMm }, seq });
      } catch (error) {
        const message = error instanceof Error ? error.message : "";
        // A newer request is pending (or the studio unmounted): its outcome is the one that matters.
        if (message === CANCELLED_MESSAGE || !active) return;
        setFailure({ key: requestKey, attempt, seq, message: message || FALLBACK_MESSAGE });
      }
    };

    const timer = window.setTimeout(() => void run(), PREVIEW_DEBOUNCE_MS);
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [client, enabled, text, font, targetHeight, baseThickness, textThickness, outlineWidth, holeSize, attempt]);

  const retry = useCallback(() => setAttempt((a) => a + 1), []);

  const mesh = applied?.mesh ?? null;
  const failed =
    failure !== null && failure.key === key && failure.attempt === attempt && (applied === null || failure.seq > applied.seq);

  let status: KeychainPreviewStatus;
  if (!hasPrintableText(text)) status = "empty";
  else if (!enabled) status = "waiting";
  else if (failed) status = "error";
  else if (mesh && mesh.key === key) status = "ready";
  else status = "updating";

  return { status, mesh, error: failed ? failure.message : null, retry };
}
