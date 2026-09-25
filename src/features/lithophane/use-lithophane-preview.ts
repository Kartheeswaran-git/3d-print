"use client";

import { useEffect, useRef, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import type { ViewerPart } from "@/components/viewer/types";
import { NO_PRINTABLE_AREA_MESSAGE } from "@/lib/geometry/heightfield";
import type { MeshStats } from "@/lib/geometry/types";
import { getPhotoPixels, renderLuminance, type GrayMap, type SourceImage } from "@/lib/image";
import { CANCELLED_MESSAGE, type MeshWorkerClient } from "@/lib/worker/client";
import type { MeshJob, PreviewResult } from "@/lib/worker/protocol";
import { previewGrid, type SampleGrid } from "./grid";
import {
  buildMeshJob,
  domainFor,
  fitKeyFor,
  stageSizeLabel,
  wallRange,
  type PreviewSettings,
} from "./model";
import { useLithophaneSession, type LoadedMask } from "./session";
import type { LithophaneSettings } from "./settings";
import { useLithophaneStore } from "./store";

/** Quiet period after the last change before the preview is rebuilt. */
export const PREVIEW_DEBOUNCE_MS = 60;
/** Viewer part colour (only used by the "plastic" appearance; lithophanes render warm white). */
const LITHOPHANE_PART_COLOR = "#f3efe7";

/**
 * What the preview can do with the current inputs:
 * empty = no photo and no moon texture; needs-mask = custom shape without a mask;
 * moon-loading / moon-error = waiting for (or failed to get) the moon texture; ready = build a mesh.
 */
export type PreviewPlan = "empty" | "needs-mask" | "moon-loading" | "moon-error" | "ready";

/** A preview mesh plus the facts about the job that produced it (the settings may have moved on). */
export interface PreviewMesh {
  parts: ViewerPart[];
  stats: MeshStats;
  fitKey: string;
  kind: "flat" | "sphere";
  grid: SampleGrid;
  /** Whole-wall thickness range for the backlight glow. */
  wallRange: { min: number; max: number };
  sizeLabel: string;
}

export interface PreviewImages {
  /** The composition before tone processing ("Original"). */
  composite: HTMLCanvasElement;
  /** Toned luminance, transparent outside the shape. */
  heightMap: HTMLCanvasElement;
}

export interface LithophanePreview {
  plan: PreviewPlan;
  mesh: PreviewMesh | null;
  images: PreviewImages | null;
  /** A newer preview is being built. */
  pending: boolean;
  /** Error of the latest preview, if it failed. */
  error: string | null;
  /** The latest preview failed only because the shape has no solid area. */
  unprintable: boolean;
  retry: () => void;
}

interface PreviewState {
  mesh: PreviewMesh | null;
  images: PreviewImages | null;
  pending: boolean;
  error: string | null;
}

const INITIAL: PreviewState = { mesh: null, images: null, pending: false, error: null };

const NON_PREVIEW_KEYS = new Set<keyof LithophaneSettings>(["wireframe", "backlight", "format", "lockRatio"]);

function pickPreviewSettings(settings: LithophaneSettings): PreviewSettings {
  const out: Partial<LithophaneSettings> = {};
  for (const key of Object.keys(settings) as (keyof LithophaneSettings)[]) {
    if (!NON_PREVIEW_KEYS.has(key)) Object.assign(out, { [key]: settings[key] });
  }
  return out as PreviewSettings;
}

export function planPreview(
  s: Pick<LithophaneSettings, "shape" | "moonBackground">,
  photo: SourceImage | null,
  mask: LoadedMask | null,
  moon: GrayMap | null,
  moonError: string | null,
): PreviewPlan {
  if (!photo && !s.moonBackground) return "empty";
  if (s.shape === "custom" && !mask) return "needs-mask";
  if (s.moonBackground && !moon) return moonError ? "moon-error" : "moon-loading";
  return "ready";
}

function errorMessage(error: unknown): string {
  return error instanceof Error && error.message ? error.message : "The preview couldn't be built. Try again.";
}

function toViewerParts(result: PreviewResult): ViewerPart[] {
  return result.parts.map((part) => ({
    key: part.role,
    role: part.role,
    positions: part.positions,
    indices: part.indices,
    uvs: part.uvs,
    thickness: part.thickness,
    color: LITHOPHANE_PART_COLOR,
  }));
}

/**
 * Live preview: 60 ms after the last relevant change, render the composition on the preview grid and
 * mesh it in the worker with the same builders as the export (FIXES G2). Superseded previews are dropped;
 * results are applied newest-wins, and each carries the fitKey of the job that produced it.
 */
export function useLithophanePreview(client: MeshWorkerClient): LithophanePreview {
  const settings = useLithophaneStore(useShallow((state) => pickPreviewSettings(state.settings)));
  const photo = useLithophaneSession((state) => state.photo);
  const mask = useLithophaneSession((state) => state.mask);
  const moon = useLithophaneSession((state) => state.moon);
  const moonError = useLithophaneSession((state) => state.moonError);

  const plan = planPreview(settings, photo, mask, moon, moonError);
  // Only inputs that affect the result: a mask matters for the custom shape, the moon only when shown.
  const maskInput = settings.shape === "custom" ? mask : null;
  const moonInput = settings.moonBackground ? moon : null;

  const [state, setState] = useState<PreviewState>(INITIAL);
  const [attempt, setAttempt] = useState(0);
  const latestRequest = useRef(0);
  const appliedRequest = useRef(0);

  useEffect(() => {
    const request = ++latestRequest.current;
    if (plan !== "ready") {
      // Nothing to build; make sure an older in-flight result can't land on top of this state.
      appliedRequest.current = request;
      return;
    }
    const timer = window.setTimeout(() => {
      let job: MeshJob;
      let images: PreviewImages;
      let meta: Omit<PreviewMesh, "parts" | "stats">;
      try {
        const grid = previewGrid(settings);
        const kind = settings.shape === "sphere" ? "sphere" : "flat";
        const maskField = maskInput?.mask ?? null;
        const render = renderLuminance({
          domain: domainFor(settings, maskField),
          width: grid.width,
          height: grid.height,
          photo: photo ? getPhotoPixels(photo) : null,
          moon: moonInput,
          settings,
        });
        job = buildMeshJob(settings, render.field, maskField);
        images = { composite: render.composite, heightMap: render.heightMap };
        meta = {
          fitKey: fitKeyFor(settings),
          kind,
          grid,
          wallRange: wallRange(settings),
          sizeLabel: stageSizeLabel(settings),
        };
      } catch (error) {
        setState((prev) => ({ ...prev, pending: false, error: errorMessage(error) }));
        return;
      }

      setState((prev) => ({ ...prev, images, pending: true, error: null }));
      client.preview(job).then(
        (result) => {
          // null = replaced by a newer request; older results never overwrite newer ones.
          if (!result || request <= appliedRequest.current) return;
          appliedRequest.current = request;
          const mesh: PreviewMesh = { ...meta, parts: toViewerParts(result), stats: result.stats };
          setState((prev) => ({ ...prev, mesh, error: null, pending: request !== latestRequest.current }));
        },
        (error: unknown) => {
          const text = errorMessage(error);
          if (text === CANCELLED_MESSAGE || request !== latestRequest.current) return;
          setState((prev) => ({ ...prev, pending: false, error: text }));
        },
      );
    }, PREVIEW_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [client, settings, photo, maskInput, moonInput, plan, attempt]);

  const ready = plan === "ready";
  return {
    plan,
    mesh: state.mesh,
    images: state.images,
    pending: ready && state.pending,
    error: ready ? state.error : null,
    unprintable: ready && !state.pending && state.error === NO_PRINTABLE_AREA_MESSAGE,
    retry: () => setAttempt((n) => n + 1),
  };
}
