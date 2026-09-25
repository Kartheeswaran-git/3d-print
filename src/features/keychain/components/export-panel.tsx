"use client";

import { Download, X } from "lucide-react";
import { Button, FieldHint, InlineAlert, SelectField } from "@/components/ui";
import { Panel, SpecList } from "@/components/studio";
import { toAriaKeyShortcuts } from "@/components/ui/keys";
import { cn, formatBytes, formatCount } from "@/lib/utils";
import { FORMAT_OPTIONS, exportLabel, openEdgeCount } from "../derive";
import type { KeychainFormat } from "../settings";
import type { KeychainExport } from "../use-keychain-export";

export interface ExportButtonProps {
  exporter: KeychainExport;
  format: KeychainFormat;
  printable: boolean;
  className?: string;
}

/** The studio's one primary action. The label follows the export's progress (FIXES K9). */
export function ExportButton({ exporter, format, printable, className }: ExportButtonProps) {
  const working = exporter.phase === "working";
  return (
    <Button
      variant="primary"
      size="lg"
      icon={<Download />}
      loading={working}
      disabled={!printable}
      aria-keyshortcuts={toAriaKeyShortcuts("mod+e")}
      onClick={exporter.start}
      className={cn("w-full", className)}
    >
      {working ? exporter.progress : exportLabel(format)}
    </Button>
  );
}

export interface ExportPanelProps {
  exporter: KeychainExport;
  format: KeychainFormat;
  onFormatChange: (format: KeychainFormat) => void;
  printable: boolean;
  /** Plate size from the latest preview, e.g. "112.4 × 25.0 × 3.5 mm". */
  size: string | null;
}

/** Aside panel: format, the download button (in the mobile bar below 1024px) and the export outcome. */
export function ExportPanel({ exporter, format, onFormatChange, printable, size }: ExportPanelProps) {
  const selected = FORMAT_OPTIONS.find((o) => o.value === format);
  const { phase, result, error } = exporter;
  const dismiss = (
    <Button variant="ghost" size="xs" icon={<X />} onClick={exporter.dismiss}>
      Dismiss
    </Button>
  );

  return (
    <Panel title="Export">
      <div className="space-y-4">
        <SelectField
          id="keychain-format"
          label="Format"
          value={format}
          options={FORMAT_OPTIONS}
          onChange={onFormatChange}
          hint={selected?.description}
        />
        <SpecList
          items={[
            { label: "Size", value: size ?? "—" },
            { label: "Parts in file", value: format === "amf" ? "Base + text" : "One solid" },
          ]}
        />
        <div className="space-y-2">
          {/* Below 1024px the same button lives in the sticky action bar: one primary per view. */}
          <ExportButton exporter={exporter} format={format} printable={printable} className="max-lg:hidden" />
          {!printable && <FieldHint>Type a name to enable the download.</FieldHint>}
        </div>

        {phase === "done" && result && (
          <InlineAlert
            tone={!result.manifold || result.manifold.watertight ? "success" : "warning"}
            title={`Exported ${result.fileName}`}
            action={dismiss}
          >
            {formatCount(result.triangles, "full")} triangles · {formatBytes(result.bytes)}
            {result.manifold && result.manifold.watertight && " · Watertight"}
            {result.manifold && !result.manifold.watertight && (
              <span className="mt-0.5 block">
                Exported with {formatCount(openEdgeCount(result.manifold), "full")} open edges — most slicers will repair this.
              </span>
            )}
          </InlineAlert>
        )}

        {phase === "error" && error && (
          <InlineAlert
            tone="danger"
            title="Export failed"
            action={
              <>
                <Button size="xs" icon={<Download />} onClick={exporter.start} disabled={!printable}>
                  Try again
                </Button>
                {dismiss}
              </>
            }
          >
            {error}
          </InlineAlert>
        )}

        <p className="text-[12px] leading-4 text-secondary">Files are made on this device — your name is never uploaded.</p>
      </div>
    </Panel>
  );
}
