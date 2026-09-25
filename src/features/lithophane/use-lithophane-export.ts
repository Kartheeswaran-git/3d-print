"use client";

import { useRef, useState } from "react";
import type { ManifoldReport } from "@/lib/geometry/types";
import { getPhotoPixels, loadMoonMap, renderLuminance } from "@/lib/image";
import { downloadBlob } from "@/lib/utils";
import { CANCELLED_MESSAGE, type MeshWorkerClient } from "@/lib/worker/client";
import type { ProgressStage } from "@/lib/worker/protocol";
import { exportGrid } from "./grid";
import { buildMeshJob, domainFor, exportBaseName, exportFileName } from "./model";
import { useLithophaneSession } from "./session";
import { useLithophaneStore } from "./store";

export type ExportStatus =
  | { state: "idle" }
  | { state: "running"; label: string }
  | { state: "done"; fileName: string; triangles: number; bytes: number; manifold: ManifoldReport | null }
  | { state: "error"; message: string };

export const EXPORT_STAGE_LABELS: Record<ProgressStage, string> = {
  mesh: "Building mesh…",
  validate: "Checking watertightness…",
  write: "Writing file…",
};

/** Let the browser paint the busy button before the main thread renders the export grid. */
function nextPaint(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => window.setTimeout(resolve, 0)));
}

function errorMessage(error: unknown): string {
  return error instanceof Error && error.message ? error.message : "The STL couldn't be created. Try again.";
}

/**
 * Full-detail export: render the composition on the export grid, mesh + validate + write in the worker,
 * then download. Reports progress, exact counts and the real manifold check (FIXES G5, G9).
 */
export function useLithophaneExport(client: MeshWorkerClient): {
  status: ExportStatus;
  start: () => void;
  reset: () => void;
} {
  const [status, setStatus] = useState<ExportStatus>({ state: "idle" });
  const running = useRef(false);

  const run = async () => {
    const settings = useLithophaneStore.getState().settings;
    const { photo, mask } = useLithophaneSession.getState();
    setStatus({ state: "running", label: EXPORT_STAGE_LABELS.mesh });
    try {
      await nextPaint();
      // Exports sample the full-resolution (4K) lunar map.
      const moon = settings.moonBackground ? await loadMoonMap(settings.moonSurface, "export") : null;
      const grid = exportGrid(settings);
      const maskField = settings.shape === "custom" ? (mask?.mask ?? null) : null;
      const render = renderLuminance({
        domain: domainFor(settings, maskField),
        width: grid.width,
        height: grid.height,
        photo: photo ? getPhotoPixels(photo) : null,
        moon,
        settings,
      });
      const job = buildMeshJob(settings, render.field, maskField);
      const result = await client.exportFile(job, settings.format, exportBaseName(photo?.name ?? null, settings.shape), (stage) =>
        setStatus({ state: "running", label: EXPORT_STAGE_LABELS[stage] }),
      );
      const name = exportFileName(photo?.name ?? null, settings.shape, result.extension);
      downloadBlob(result.buffer, name, result.mime);
      setStatus({
        state: "done",
        fileName: name,
        triangles: result.stats.triangles,
        bytes: result.stats.bytes ?? result.buffer.byteLength,
        manifold: result.stats.manifold ?? null,
      });
    } catch (error) {
      const text = errorMessage(error);
      if (text === CANCELLED_MESSAGE) {
        setStatus({ state: "idle" });
        return;
      }
      setStatus({ state: "error", message: text });
    }
  };

  const start = () => {
    if (running.current) return;
    running.current = true;
    void run().finally(() => {
      running.current = false;
    });
  };

  const reset = () => {
    if (!running.current) setStatus({ state: "idle" });
  };

  return { status, start, reset };
}
