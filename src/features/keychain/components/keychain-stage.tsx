"use client";

import { useMemo, type Ref } from "react";
import { Box, RectangleVertical, Redo2, Rotate3d, RotateCcw, Square, SquareDashed, Type, Undo2 } from "lucide-react";
import { Button, IconButton, InlineAlert, Segmented, Separator, Skeleton } from "@/components/ui";
import { MetricGrid, ShortcutsButton, StageFrame } from "@/components/studio";
import { ModelViewer, type CameraView, type ModelViewerHandle, type ViewerPart } from "@/components/viewer";
import { cn, formatCount } from "@/lib/utils";
import { estimateExportTriangles, formatDimensions, formatFootprint } from "../derive";
import type { KeychainFormat } from "../settings";
import type { KeychainOutline } from "../use-keychain-outline";
import type { KeychainPreview } from "../use-keychain-preview";
import { REDO_SHORTCUT, UNDO_SHORTCUT } from "../use-keychain-undo";
import { KeychainStatusBadge, type KeychainStudioStatus } from "./keychain-status";
import { OutlineView } from "./outline-view";

export type KeychainStageView = "model" | "outline";

const KEYCHAIN_SHORTCUTS = [
  { keys: "1", label: "3D model" },
  { keys: "2", label: "Outline" },
  { keys: "p", label: "Perspective view" },
  { keys: "f", label: "Front view" },
  { keys: "s", label: "Side view" },
  { keys: "r", label: "Reset view" },
  { keys: UNDO_SHORTCUT, label: "Undo" },
  { keys: REDO_SHORTCUT, label: "Redo" },
  { keys: "mod+s", label: "Save settings" },
  { keys: "mod+e", label: "Download file" },
];

const VIEW_OPTIONS: { value: KeychainStageView; label: string; icon: React.ReactNode }[] = [
  { value: "model", label: "3D model", icon: <Box /> },
  { value: "outline", label: "Outline", icon: <SquareDashed /> },
];

const CAMERA_BUTTONS: { view: CameraView | "reset"; label: string; shortcut: string; icon: React.ReactNode }[] = [
  { view: "perspective", label: "Perspective", shortcut: "p", icon: <Rotate3d /> },
  { view: "front", label: "Front", shortcut: "f", icon: <Square /> },
  { view: "side", label: "Side", shortcut: "s", icon: <RectangleVertical /> },
  { view: "reset", label: "Reset view", shortcut: "r", icon: <RotateCcw /> },
];

export interface KeychainStageProps {
  view: KeychainStageView;
  onViewChange: (view: KeychainStageView) => void;
  status: KeychainStudioStatus;
  preview: KeychainPreview;
  outline: KeychainOutline;
  text: string;
  baseColor: string;
  textColor: string;
  /** Export format, for the file's triangle estimate. */
  format: KeychainFormat;
  printable: boolean;
  viewerRef: Ref<ModelViewerHandle>;
  onCamera: (view: CameraView | "reset") => void;
  /** Move focus to the name field (empty-state action). */
  onEditName: () => void;
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
  /** What the last undo / redo changed, for screen readers. */
  historyAnnouncement: string;
}

/** Centre column: 3D preview (base + text parts in their colours) or the flat outline, plus metrics. */
export function KeychainStage({
  view,
  onViewChange,
  status,
  preview,
  outline,
  text,
  baseColor,
  textColor,
  format,
  printable,
  viewerRef,
  onCamera,
  onEditName,
  canUndo,
  canRedo,
  onUndo,
  onRedo,
  historyAnnouncement,
}: KeychainStageProps) {
  const { mesh, error, retry } = preview;

  // The real base and text parts that the AMF contains (FIXES K12). Colours only touch materials (FIXES K6).
  const parts = useMemo<ViewerPart[]>(
    () =>
      mesh
        ? mesh.parts.map((p) => ({
            key: p.role,
            role: p.role,
            positions: p.positions,
            indices: p.indices,
            color: p.role === "text" ? textColor : baseColor,
          }))
        : [],
    [mesh, baseColor, textColor],
  );

  const showModel = view === "model" && printable;
  const hasTextPart = mesh?.parts.some((p) => p.role === "text") ?? false;
  const exportTriangles = mesh
    ? estimateExportTriangles(
        {
          triangles: mesh.stats.triangles,
          activeCells: mesh.stats.activeCells,
          baseTriangles: (mesh.parts.find((p) => p.role === "base")?.indices.length ?? 0) / 3,
        },
        format,
      )
    : 0;
  const name = text.trim();

  const toolbar = (
    <>
      <Segmented size="sm" ariaLabel="Preview mode" value={view} options={VIEW_OPTIONS} onChange={onViewChange} />
      <Separator />
      <IconButton size="sm" label="Undo" shortcut={UNDO_SHORTCUT} icon={<Undo2 />} disabled={!canUndo} onClick={onUndo} />
      <IconButton size="sm" label="Redo" shortcut={REDO_SHORTCUT} icon={<Redo2 />} disabled={!canRedo} onClick={onRedo} />
      <p aria-live="polite" className="sr-only">
        {historyAnnouncement}
      </p>
      {view === "model" && (
        <>
          <Separator />
          {CAMERA_BUTTONS.map((b) => (
            <IconButton
              key={b.view}
              size="sm"
              label={b.label}
              shortcut={b.shortcut}
              icon={b.icon}
              disabled={!mesh || !printable}
              onClick={() => onCamera(b.view)}
            />
          ))}
        </>
      )}
      {/* Touch-only devices have no keyboard to use the shortcuts with. */}
      <span className="flex items-center gap-1 [@media(hover:none)]:hidden">
        <Separator />
        <ShortcutsButton size="sm" items={KEYCHAIN_SHORTCUTS} />
      </span>
    </>
  );

  const overlay =
    printable && mesh ? (
      <>
        <span className="rounded-chip border border-line bg-surface/90 px-2 py-1 font-mono text-[12px] leading-4 text-body tabular-nums">
          {formatDimensions(mesh.stats.bounds)}
        </span>
        <span className="hidden text-right text-[12px] leading-4 text-muted sm:block [@media(hover:none)]:hidden">
          {view === "model" ? "Drag to rotate · Scroll to zoom" : "White is the plate · grey is the raised text"}
        </span>
      </>
    ) : undefined;

  // A blank name has nothing to print: don't report the last mesh's numbers.
  const shown = printable ? mesh : null;
  const metrics = [
    {
      label: "Size",
      value: shown ? formatFootprint(shown.stats.bounds) : "—",
      hint: shown ? `${(shown.stats.bounds.max[2] - shown.stats.bounds.min[2]).toFixed(1)} mm thick` : undefined,
    },
    {
      label: "Triangles",
      value: shown ? formatCount(shown.stats.triangles) : "—",
      hint: shown ? `About ${formatCount(exportTriangles)} in the file` : undefined,
    },
    {
      label: "Parts",
      value: shown ? (hasTextPart ? "2 · base + text" : "1 · base") : "—",
    },
  ];

  return (
    <StageFrame
      title="Preview"
      status={<KeychainStatusBadge status={status} />}
      toolbar={toolbar}
      overlay={overlay}
      footer={<MetricGrid columns={3} items={metrics} />}
    >
      {/* Mounted once the first mesh exists and kept alive, so the camera and WebGL context survive view switches. */}
      {mesh && (
        <div className={cn("absolute inset-0 flex flex-col", !showModel && "invisible")} inert={!showModel}>
          <ModelViewer
            ref={viewerRef}
            parts={parts}
            fitKey={mesh.fitKey}
            appearance="plastic"
            ariaLabel={name ? `3D preview of the “${name}” keychain` : "3D preview of the keychain"}
            className="flex-1"
          />
        </div>
      )}

      {!printable ? (
        <EmptyName onEditName={onEditName} />
      ) : view === "outline" ? (
        <OutlineView outline={outline} label={`Flat outline of the “${name}” keychain`} />
      ) : !mesh ? (
        error ? (
          <div className="flex flex-1 items-center justify-center p-6">
            <PreviewError message={error} onRetry={retry} className="max-w-sm" />
          </div>
        ) : (
          <div role="status" className="flex flex-1 flex-col items-center justify-center gap-3 p-6">
            <Skeleton className="h-16 w-64 max-w-full rounded-card" />
            <span className="text-[13px] leading-5 text-secondary">Building your keychain…</span>
          </div>
        )
      ) : (
        error && (
          <div className="absolute inset-x-3 top-3 z-10">
            <PreviewError message={error} onRetry={retry} className="shadow-e2" />
          </div>
        )
      )}
    </StageFrame>
  );
}

function PreviewError({ message, onRetry, className }: { message: string; onRetry: () => void; className?: string }) {
  return (
    <InlineAlert
      tone="danger"
      title="Preview failed"
      className={className}
      action={
        <Button size="sm" icon={<RotateCcw />} onClick={onRetry}>
          Try again
        </Button>
      }
    >
      {message}
    </InlineAlert>
  );
}

/** Stage empty state for a blank name (FIXES K11). */
function EmptyName({ onEditName }: { onEditName: () => void }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center p-6 text-center">
      <span
        className="mb-4 flex size-11 items-center justify-center rounded-card border border-line bg-surface text-icon-muted"
        aria-hidden="true"
      >
        <Type className="size-5" />
      </span>
      <h3 className="text-[14px] font-semibold leading-5 text-ink">Type a name to preview your keychain</h3>
      <p className="mt-1 max-w-sm text-[13px] leading-5 text-secondary">
        Letters, numbers and spaces all work, up to 24 characters.
      </p>
      <Button size="sm" className="mt-4" onClick={onEditName}>
        Type a name
      </Button>
    </div>
  );
}
