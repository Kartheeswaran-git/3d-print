"use client";

import { useState } from "react";
import { Download, FolderOpen, RotateCcw } from "lucide-react";
import { useShallow } from "zustand/react/shallow";
import { Button, ConfirmDialog, FieldHint, InlineAlert, KeyCombo, Segmented, useFilePicker } from "@/components/ui";
import { toAriaKeyShortcuts } from "@/components/ui/keys";
import { Panel, SpecList } from "@/components/studio";
import { formatBytes, formatCount } from "@/lib/utils";
import { estimateExportTriangles, estimateFileBytes, exportGrid, formatSamples } from "../grid";
import { exportSizeLabel } from "../model";
import { PROJECT_ACCEPT, readProjectFile } from "../project";
import type { LithophaneSettings, StlFormat } from "../settings";
import { useLithophaneStore } from "../store";
import type { ExportStatus } from "../use-lithophane-export";
import type { LithophanePreview } from "../use-lithophane-preview";

const FORMAT_OPTIONS: { value: StlFormat; label: string }[] = [
  { value: "stl-binary", label: "Binary STL" },
  { value: "stl-ascii", label: "ASCII STL" },
];

/** ASCII files above this size get a heads-up (they are slow to write and to open). */
const LARGE_ASCII_BYTES = 150 * 1024 * 1024;

type ExportSettings = Pick<
  LithophaneSettings,
  "shape" | "sphereDiameter" | "width" | "height" | "resolution" | "format" | "base" | "minThickness" | "maxThickness"
>;

export interface ExportPanelProps {
  preview: LithophanePreview;
  status: ExportStatus;
  /** Why exporting is impossible right now, or null. */
  blockedReason: string | null;
  onExport: () => void;
}

/** The export button's label: progress while running, otherwise the action. */
export function exportButtonLabel(status: ExportStatus): string {
  return status.state === "running" ? status.label : "Download STL";
}

/** Export: format, printed size, detail, the one primary action and the result of the last export. */
export function ExportPanel({ preview, status, blockedReason, onExport }: ExportPanelProps) {
  const settings = useLithophaneStore(
    useShallow((state): ExportSettings => {
      const s = state.settings;
      return {
        shape: s.shape,
        sphereDiameter: s.sphereDiameter,
        width: s.width,
        height: s.height,
        resolution: s.resolution,
        format: s.format,
        base: s.base,
        minThickness: s.minThickness,
        maxThickness: s.maxThickness,
      };
    }),
  );
  const set = useLithophaneStore((state) => state.set);
  const grid = exportGrid(settings);
  const running = status.state === "running";
  const mesh = preview.mesh;
  const estimatedBytes = mesh ? estimateFileBytes(estimateExportTriangles(mesh.stats, mesh.kind, mesh.grid, grid), "stl-ascii") : 0;

  return (
    <Panel title="Export">
      <div className="space-y-4">
        <div className="space-y-1.5">
          <p className="text-[13px] font-medium leading-5 text-secondary">
            Format
          </p>
          <Segmented
            ariaLabel="File format"
            value={settings.format}
            options={FORMAT_OPTIONS}
            onChange={(v) => set("format", v)}
            className="w-full"
          />
          <FieldHint>
            {settings.format === "stl-ascii" && estimatedBytes > LARGE_ASCII_BYTES
              ? `About ${formatBytes(estimatedBytes)} as ASCII — Binary STL is about 5× smaller and much faster.`
              : "Binary files are about 5× smaller."}
          </FieldHint>
        </div>

        <SpecList
          items={[
            { label: "Size", value: exportSizeLabel(settings) },
            { label: "Export detail", value: formatSamples(grid) },
          ]}
        />

        <div className="space-y-2">
          {/* Below 1024px the same action lives in the sticky bar, so only one primary shows per view. */}
          <Button
            variant="primary"
            size="lg"
            className="w-full max-lg:hidden"
            icon={<Download aria-hidden="true" />}
            loading={running}
            disabled={Boolean(blockedReason)}
            onClick={onExport}
            aria-keyshortcuts={toAriaKeyShortcuts("mod+e")}
          >
            {exportButtonLabel(status)}
          </Button>
          {blockedReason && <FieldHint>{blockedReason}</FieldHint>}
        </div>

        <ExportResult status={status} onRetry={onExport} />

        <p className="text-[12px] leading-4 text-secondary">Your photo never leaves this device.</p>
      </div>
    </Panel>
  );
}

function ExportResult({ status, onRetry }: { status: ExportStatus; onRetry: () => void }) {
  if (status.state === "error") {
    return (
      <InlineAlert
        tone="danger"
        title="The STL couldn't be created."
        action={
          <Button variant="secondary" size="xs" icon={<RotateCcw aria-hidden="true" />} onClick={onRetry}>
            Try again
          </Button>
        }
      >
        {status.message}
      </InlineAlert>
    );
  }
  if (status.state !== "done") return null;

  const facts = `${formatCount(status.triangles, "full")} triangles · ${formatBytes(status.bytes)}`;
  const m = status.manifold;
  if (!m || m.watertight) {
    return (
      <InlineAlert tone="success" title={`Exported ${status.fileName}`}>
        {m ? `${facts} · Watertight` : facts}
      </InlineAlert>
    );
  }
  const openEdges = m.boundaryEdges + m.nonManifoldEdges;
  const problem =
    openEdges > 0
      ? `${formatCount(openEdges, "full")} open ${openEdges === 1 ? "edge" : "edges"}`
      : `${formatCount(m.degenerateTriangles, "full")} degenerate ${m.degenerateTriangles === 1 ? "triangle" : "triangles"}`;
  return (
    <InlineAlert tone="warning" title={`Exported with ${problem} — most slicers will repair this.`}>
      {status.fileName} · {facts}
    </InlineAlert>
  );
}

/** NASA Scientific Visualization Studio, CGI Moon Kit (public/moon/CREDITS.md). */
const MOON_CREDIT_URL = "https://svs.gsfc.nasa.gov/4720";

const PRINT_SPECS = {
  sphere: { orientation: "Opening down", supports: "None needed" },
  flat: { orientation: "Upright, relief facing out", supports: "None" },
};

/** Print settings that suit lithophanes, plus the credit for the lunar maps. */
export function PrintPanel() {
  const isSphere = useLithophaneStore((state) => state.settings.shape === "sphere");
  const spec = PRINT_SPECS[isSphere ? "sphere" : "flat"];
  return (
    <Panel title="Print settings">
      <SpecList
        items={[
          { label: "Material", value: "White PLA" },
          { label: "Layer height", value: "0.08–0.16 mm" },
          { label: "Nozzle", value: "0.4 mm" },
          { label: "Infill", value: "100%" },
          { label: "Orientation", value: spec.orientation },
          { label: "Supports", value: spec.supports },
        ]}
      />
      <p className="mt-3 text-[13px] leading-5 text-secondary">Thin walls glow brightest — test with a small print first.</p>
      <p className="mt-3 border-t border-line-subtle pt-3 text-[12px] leading-4 text-secondary">
        Moon imagery:{" "}
        <a
          href={MOON_CREDIT_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="rounded-chip underline decoration-line-strong underline-offset-2 transition-colors duration-[120ms] hover:text-body hover:decoration-current"
        >
          NASA SVS / LRO
        </a>
      </p>
    </Panel>
  );
}

export interface ProjectPanelProps {
  onSave: () => void;
  onLoaded: () => void;
  onResetAll: () => void;
}

/** Save / open settings files and reset everything (with confirmation). */
export function ProjectPanel({ onSave, onLoaded, onResetAll }: ProjectPanelProps) {
  const loadSettings = useLithophaneStore((state) => state.loadSettings);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);

  const openFile = async (file: File) => {
    try {
      const settings = await readProjectFile(file);
      loadSettings(settings);
      setLoadError(null);
      onLoaded();
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : "This file couldn't be opened.");
    }
  };
  const picker = useFilePicker(
    PROJECT_ACCEPT,
    (file) => void openFile(file),
    (file) => setLoadError(`“${file.name}” isn't a settings file. Choose a .json project saved from Luna Litho.`),
  );

  return (
    <Panel title="Project">
      <div className="flex flex-wrap gap-2">
        <Button size="sm" icon={<Download aria-hidden="true" />} onClick={onSave} aria-keyshortcuts={toAriaKeyShortcuts("mod+s")}>
          Save settings
          <KeyCombo keys="mod+s" className="ml-0.5" />
        </Button>
        <Button size="sm" icon={<FolderOpen aria-hidden="true" />} onClick={picker.open}>
          Open settings…
        </Button>
        <Button size="sm" variant="danger-ghost" icon={<RotateCcw aria-hidden="true" />} onClick={() => setConfirmOpen(true)}>
          Reset everything
        </Button>
      </div>
      {picker.input}
      {loadError && (
        <InlineAlert
          tone="danger"
          title="Settings not loaded"
          className="mt-3"
          action={
            <Button variant="ghost" size="xs" className="-ml-2.5" onClick={picker.open}>
              Choose another file
            </Button>
          }
        >
          {loadError}
        </InlineAlert>
      )}
      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title="Reset everything?"
        description="All settings return to their defaults and the photo is removed from this session."
        confirmLabel="Reset"
        tone="danger"
        onConfirm={() => {
          setLoadError(null);
          onResetAll();
        }}
      />
    </Panel>
  );
}
