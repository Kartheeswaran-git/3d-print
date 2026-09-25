"use client";

import { useCallback, useRef, useState } from "react";
import type { ManifoldReport } from "@/lib/geometry/types";
import { downloadBlob } from "@/lib/utils";
import { CANCELLED_MESSAGE, type MeshWorkerClient } from "@/lib/worker/client";
import { hasPrintableText, keychainFileName, keychainModelName, toKeychainJob } from "./derive";
import { ensureFontLoaded } from "./fonts";
import { rasterizeKeychain } from "./rasterize";
import { EXPORT_DPMM, type KeychainFormat } from "./settings";
import { keychainStore } from "./store";

const PREPARING_MESSAGE = "Tracing letters…";
const FALLBACK_MESSAGE = "The file couldn't be created. Try again.";

export interface KeychainExportResult {
  fileName: string;
  format: KeychainFormat;
  triangles: number;
  bytes: number;
  /** Result of the watertightness check the worker runs on every export (FIXES G5). */
  manifold: ManifoldReport | null;
}

export type KeychainExportPhase = "idle" | "working" | "done" | "error";

export interface KeychainExport {
  phase: KeychainExportPhase;
  /** What the export is doing right now (button label while working). */
  progress: string;
  result: KeychainExportResult | null;
  error: string | null;
  /** Export the current settings; ignored while an export is running or the name is empty. */
  start: () => void;
  /** Clear the last result or error. */
  dismiss: () => void;
}

interface ExportState {
  phase: KeychainExportPhase;
  progress: string;
  result: KeychainExportResult | null;
  error: string | null;
}

const IDLE: ExportState = { phase: "idle", progress: "", result: null, error: null };

/** Let the browser paint the busy button before the main thread rasterises at full density. */
function nextPaint(): Promise<void> {
  return new Promise((resolve) => {
    // rAF doesn't fire in background tabs; the timeout keeps the export moving there.
    const fallback = window.setTimeout(resolve, 100);
    requestAnimationFrame(() =>
      window.setTimeout(() => {
        window.clearTimeout(fallback);
        resolve();
      }, 0),
    );
  });
}

/**
 * Download flow: load the font, rasterise at EXPORT_DPMM, build + validate + write in the worker, download.
 * Exports are separate worker requests with their own ids, so an in-flight preview can never be
 * mistaken for the file (FIXES K1). Always reads the latest settings from the store.
 */
export function useKeychainExport(client: MeshWorkerClient): KeychainExport {
  const [state, setState] = useState<ExportState>(IDLE);
  const busy = useRef(false);

  const run = useCallback(async () => {
    const settings = keychainStore.getState().settings;
    if (busy.current || !hasPrintableText(settings.text)) return;
    busy.current = true;
    setState({ phase: "working", progress: PREPARING_MESSAGE, result: null, error: null });
    try {
      await ensureFontLoaded(settings.font, settings.text);
      await nextPaint();
      const raster = rasterizeKeychain(settings, EXPORT_DPMM);
      const file = await client.exportFile(
        toKeychainJob(raster, settings),
        settings.format,
        keychainModelName(settings.text),
        (_stage, message) => setState((s) => (s.phase === "working" ? { ...s, progress: message } : s)),
      );
      const fileName = keychainFileName(settings.text, file.extension);
      const bytes = file.stats.bytes ?? file.buffer.byteLength;
      downloadBlob(file.buffer, fileName, file.mime);
      setState({
        phase: "done",
        progress: "",
        error: null,
        result: {
          fileName,
          format: settings.format,
          triangles: file.stats.triangles,
          bytes,
          manifold: file.stats.manifold ?? null,
        },
      });
    } catch (error) {
      const message = error instanceof Error && error.message ? error.message : FALLBACK_MESSAGE;
      // Cancelled = the studio unmounted; nothing to report.
      setState(message === CANCELLED_MESSAGE ? IDLE : { phase: "error", progress: "", result: null, error: message });
    } finally {
      busy.current = false;
    }
  }, [client]);

  const start = useCallback(() => void run(), [run]);
  const dismiss = useCallback(() => setState((s) => (s.phase === "working" ? s : IDLE)), []);

  return { ...state, start, dismiss };
}
