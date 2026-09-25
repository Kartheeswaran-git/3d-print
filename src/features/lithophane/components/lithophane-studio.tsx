"use client";

import { useEffect, useRef } from "react";
import { Download } from "lucide-react";
import { Button, useFilePicker, useToast } from "@/components/ui";
import { StudioLayout, useShortcuts } from "@/components/studio";
import type { CameraView, ModelViewerHandle } from "@/components/viewer";
import { MASK_ACCEPT, PHOTO_ACCEPT } from "@/lib/image";
import { useMeshWorker } from "@/lib/worker/use-mesh-worker";
import { downloadProjectFile } from "../project";
import { useLithophaneSession } from "../session";
import { useHydrateLithophaneSettings, useLithophaneHistory, useLithophaneStore } from "../store";
import { useHistoryShortcuts } from "../use-history-shortcuts";
import { useLithophaneExport } from "../use-lithophane-export";
import { useLithophanePreview } from "../use-lithophane-preview";
import { ExportPanel, exportButtonLabel, PrintPanel, ProjectPanel } from "./aside-panels";
import { LithophaneInspector } from "./inspector";
import { LithophaneStage } from "./lithophane-stage";
import { exportBlockedReason, studioStatus, StudioStatusBadge } from "./studio-status";

/** The moon lamp studio (`/moon-lamp`): inspector, live 3D / layout stage and export aside. */
export function LithophaneStudio({ mode = "moon-lamp" }: { mode?: "moon-lamp" | "photo-panel" }) {
  useHydrateLithophaneSettings();
  const client = useMeshWorker();
  
  // Sync mode
  const setMode = useLithophaneSession((state) => state.setMode);
  useEffect(() => {
    setMode(mode);
    const store = useLithophaneStore.getState();
    if (mode === "moon-lamp") {
      if (store.settings.shape !== "sphere") store.set("shape", "sphere");
    } else if (mode === "photo-panel") {
      if (store.settings.shape !== "rectangle") store.set("shape", "rectangle");
      if (store.settings.moonBackground !== false) store.set("moonBackground", false);
    }
  }, [mode, setMode]);
  
  const preview = useLithophanePreview(client);
  const exporter = useLithophaneExport(client);
  const { toast } = useToast();
  const viewerRef = useRef<ModelViewerHandle>(null);

  // The lunar map is fetched the first time it is shown, and again when the surface style changes.
  const moonBackground = useLithophaneStore((state) => state.settings.moonBackground);
  const moonSurface = useLithophaneStore((state) => state.settings.moonSurface);
  const ensureMoon = useLithophaneSession((state) => state.ensureMoon);
  useEffect(() => {
    if (moonBackground) ensureMoon(moonSurface);
  }, [moonBackground, moonSurface, ensureMoon]);

  const loadPhoto = useLithophaneSession((state) => state.loadPhoto);
  const loadMask = useLithophaneSession((state) => state.loadMask);
  const setView = useLithophaneSession((state) => state.setView);
  const photoPicker = useFilePicker(PHOTO_ACCEPT, (file) => void loadPhoto(file));
  const maskPicker = useFilePicker(MASK_ACCEPT, (file) => void loadMask(file));

  const undo = useLithophaneHistory((state) => state.undo);
  const redo = useLithophaneHistory((state) => state.redo);
  useHistoryShortcuts({ undo, redo });

  const exporting = exporter.status.state === "running";
  const status = studioStatus(preview, exporting);
  const blockedReason = exportBlockedReason(preview);
  const startExport = () => {
    if (!blockedReason) exporter.start();
  };

  const setCamera = (camera: CameraView) => {
    setView("model");
    viewerRef.current?.setView(camera);
  };
  const resetView = () => {
    setView("model");
    viewerRef.current?.resetView();
  };
  const toggle = (key: "wireframe" | "backlight") => {
    const store = useLithophaneStore.getState();
    store.set(key, !store.settings[key]);
  };
  /** Move photo (M): drag on the 3D model to place the photo. Needs a photo; switches to the 3D view. */
  const togglePlacing = () => {
    const session = useLithophaneSession.getState();
    if (!session.photo) return;
    const on = session.view !== "model" || !session.placing;
    session.setView("model");
    session.setPlacing(on);
  };
  const saveSettings = () => {
    downloadProjectFile(useLithophaneStore.getState().settings);
    toast("Settings saved");
  };
  const resetEverything = () => {
    useLithophaneStore.getState().resetAll();
    useLithophaneSession.getState().clear();
    exporter.reset();
    toast("Everything is back to the defaults");
  };

  useShortcuts({
    "1": () => setView("model"),
    "2": () => setView("layout"),
    "3": () => setView("heightmap"),
    p: () => setCamera("perspective"),
    f: () => setCamera("front"),
    s: () => setCamera("side"),
    r: resetView,
    m: togglePlacing,
    w: () => toggle("wireframe"),
    b: () => toggle("backlight"),
    "mod+s": saveSettings,
    "mod+e": startExport,
    "mod+o": photoPicker.open,
  });

  return (
    <>
      <StudioLayout
        inspector={<LithophaneInspector onChoosePhoto={photoPicker.open} onChooseMask={maskPicker.open} />}
        stage={
          <LithophaneStage
            preview={preview}
            status={status}
            viewerRef={viewerRef}
            onCamera={setCamera}
            onResetView={resetView}
            onToggle={toggle}
            onTogglePlacing={togglePlacing}
            onChoosePhoto={photoPicker.open}
            onChooseMask={maskPicker.open}
          />
        }
        aside={
          <>
            <ExportPanel preview={preview} status={exporter.status} blockedReason={blockedReason} onExport={startExport} />
            <PrintPanel />
            <ProjectPanel onSave={saveSettings} onLoaded={() => toast("Project loaded")} onResetAll={resetEverything} />
          </>
        }
        mobileAction={
          <div className="flex items-center gap-3">
            <StudioStatusBadge status={status} />
            <Button
              variant="primary"
              size="lg"
              className="min-w-0 flex-1"
              icon={<Download aria-hidden="true" />}
              loading={exporting}
              disabled={Boolean(blockedReason)}
              onClick={startExport}
            >
              {exportButtonLabel(exporter.status)}
            </Button>
          </div>
        }
      />
      {photoPicker.input}
      {maskPicker.input}
    </>
  );
}
