"use client";

import { useRef, useState } from "react";
import { StudioLayout, useShortcuts } from "@/components/studio";
import type { CameraView, ModelViewerHandle } from "@/components/viewer";
import { useMeshWorker } from "@/lib/worker/use-mesh-worker";
import { formatDimensions, hasPrintableText } from "../derive";
import { useKeychainHydration, useKeychainStore } from "../store";
import { useKeychainExport } from "../use-keychain-export";
import { useKeychainOutline } from "../use-keychain-outline";
import { useKeychainPreview } from "../use-keychain-preview";
import { useKeychainProject } from "../use-keychain-project";
import { useKeychainUndo } from "../use-keychain-undo";
import { useInspectorMode } from "../use-inspector-mode";
import type { KeychainSettings } from "../settings";
import { ExportButton, ExportPanel } from "./export-panel";
import { KeychainInspector } from "./keychain-inspector";
import { KeychainStage, type KeychainStageView } from "./keychain-stage";
import { KeychainStatusBadge, type KeychainStudioStatus } from "./keychain-status";
import { PrintingTipsPanel } from "./printing-tips-panel";
import { ProjectPanel } from "./project-panel";

/** The /keychain studio: inspector · live preview · export, project and printing tips. */
export function KeychainStudio() {
  const hydrated = useKeychainHydration();
  const settings = useKeychainStore((s) => s.settings);
  const update = useKeychainStore((s) => s.update);
  const reset = useKeychainStore((s) => s.reset);

  const client = useMeshWorker();
  const [view, setView] = useState<KeychainStageView>("model");
  const preview = useKeychainPreview(client, settings, hydrated);
  const outline = useKeychainOutline(settings, hydrated && view === "outline");
  const exporter = useKeychainExport(client);
  const project = useKeychainProject();
  const history = useKeychainUndo();
  const [mode, setMode] = useInspectorMode();
  // Section resets are single undo steps, even right after another edit.
  const resetKeys = (keys: readonly (keyof KeychainSettings)[]) => history.batch(() => reset(keys));

  const viewerRef = useRef<ModelViewerHandle>(null);
  const nameInputRef = useRef<HTMLInputElement>(null);

  const printable = hasPrintableText(settings.text);
  const status: KeychainStudioStatus = exporter.phase === "working" ? "exporting" : preview.status;
  const mesh = preview.mesh;
  const size = printable && mesh ? formatDimensions(mesh.stats.bounds) : null;

  const editName = () => {
    const input = nameInputRef.current;
    if (!input) return;
    input.scrollIntoView({ block: "center" });
    input.focus();
  };

  const camera = (target: CameraView | "reset") => {
    setView("model");
    if (target === "reset") viewerRef.current?.resetView();
    else viewerRef.current?.setView(target);
  };

  const download = () => {
    if (!printable) editName();
    else exporter.start();
  };

  useShortcuts({
    "1": () => setView("model"),
    "2": () => setView("outline"),
    p: () => camera("perspective"),
    f: () => camera("front"),
    s: () => camera("side"),
    r: () => camera("reset"),
    "mod+s": () => project.save(),
    "mod+e": download,
  });

  return (
    <StudioLayout
      inspector={
        <KeychainInspector
          settings={settings}
          update={update}
          applyStep={history.applyStep}
          resetKeys={resetKeys}
          onGestureStart={history.begin}
          onGestureEnd={history.end}
          mode={mode}
          onModeChange={setMode}
          appliedOutlineMm={printable && mesh ? mesh.outlineMm : null}
          nameInputRef={nameInputRef}
        />
      }
      stage={
        <KeychainStage
          view={view}
          onViewChange={setView}
          status={status}
          preview={preview}
          outline={outline}
          text={settings.text}
          baseColor={settings.baseColor}
          textColor={settings.textColor}
          format={settings.format}
          printable={printable}
          viewerRef={viewerRef}
          onCamera={camera}
          onEditName={editName}
          canUndo={history.canUndo}
          canRedo={history.canRedo}
          onUndo={history.undo}
          onRedo={history.redo}
          historyAnnouncement={history.announcement}
        />
      }
      aside={
        <>
          <ExportPanel
            exporter={exporter}
            format={settings.format}
            onFormatChange={(format) => history.applyStep({ format })}
            printable={printable}
            size={size}
          />
          <PrintingTipsPanel baseThickness={settings.baseThickness} />
          <ProjectPanel project={project} />
        </>
      }
      mobileAction={
        <div className="flex items-center gap-3">
          <KeychainStatusBadge status={status} />
          <ExportButton exporter={exporter} format={settings.format} printable={printable} className="min-w-0 flex-1" />
        </div>
      }
    />
  );
}
