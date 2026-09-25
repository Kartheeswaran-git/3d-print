"use client";

import { TriangleAlert } from "lucide-react";
import { useShallow } from "zustand/react/shallow";
import { MetricGrid } from "@/components/studio";
import { formatBytes, formatCount } from "@/lib/utils";
import { estimateExportTriangles, estimateFileBytes, exportGrid } from "../grid";
import type { LithophaneSettings } from "../settings";
import { useLithophaneStore } from "../store";
import type { LithophanePreview } from "../use-lithophane-preview";
import { CanvasSnapshot } from "./canvas-snapshot";

function Thumbnail({ label, source }: { label: string; source: HTMLCanvasElement | null }) {
  return (
    <figure className="w-[88px] shrink-0">
      <div className="h-14 w-[88px] overflow-hidden rounded-control border border-line bg-sunken">
        {source && <CanvasSnapshot source={source} maxSize={176} className="h-full w-full object-contain" />}
      </div>
      <figcaption className="mt-1 text-[12px] leading-4 text-secondary">{label}</figcaption>
    </figure>
  );
}

type FooterSettings = Pick<LithophaneSettings, "shape" | "sphereDiameter" | "width" | "height" | "resolution" | "format">;

/** Thumbnails plus preview / export estimates (FIXES G9). */
export function StageFooter({ preview }: { preview: LithophanePreview }) {
  const settings = useLithophaneStore(
    useShallow((state): FooterSettings => {
      const { shape, sphereDiameter, width, height, resolution, format } = state.settings;
      return { shape, sphereDiameter, width, height, resolution, format };
    }),
  );
  const live = preview.plan === "ready" || preview.plan === "moon-loading";
  const images = live ? preview.images : null;
  const mesh = live && !preview.error ? preview.mesh : null;
  const target = exportGrid(settings);
  const exportTriangles = mesh ? estimateExportTriangles(mesh.stats, mesh.kind, mesh.grid, target) : null;

  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-start">
      <div className="flex gap-2">
        <Thumbnail label="Original" source={images?.composite ?? null} />
        <Thumbnail label="Height map" source={images?.heightMap ?? null} />
      </div>
      <div className="min-w-0 flex-1 space-y-2">
        <MetricGrid
          columns={3}
          items={[
            { label: "Preview triangles", value: mesh ? formatCount(mesh.stats.triangles) : "—" },
            { label: "Export triangles (est.)", value: exportTriangles ? formatCount(exportTriangles) : "—" },
            {
              label: "File size (est.)",
              value: exportTriangles ? formatBytes(estimateFileBytes(exportTriangles, settings.format)) : "—",
            },
          ]}
        />
        {target.capped && (
          <p className="flex items-start gap-1.5 text-[12px] leading-4 text-warning">
            <TriangleAlert className="mt-px size-3.5 shrink-0" aria-hidden="true" />
            Detail limited to 720 samples on the longest side.
          </p>
        )}
      </div>
    </div>
  );
}
