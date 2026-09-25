"use client";

import { Axis3d, Box, Frame, Grid3x3, ImageIcon, Lightbulb, Move, RectangleVertical, Redo2, Scan, Square, Undo2 } from "lucide-react";
import { IconButton, Segmented, Separator } from "@/components/ui";
import { ShortcutsButton } from "@/components/studio";
import type { CameraView } from "@/components/viewer";
import { useLithophaneSession, type StageView } from "../session";
import { useLithophaneHistory, useLithophaneStore } from "../store";
import { PlacementPresetButtons } from "./placement-presets";

/** Shortcut list shown in the stage's keyboard popover (bound in the studio root). */
export const LAMP_SHORTCUTS = [
  { keys: "1", label: "3D model" },
  { keys: "2", label: "Layout" },
  { keys: "3", label: "Height map" },
  { keys: "p", label: "Perspective view" },
  { keys: "f", label: "Front view" },
  { keys: "s", label: "Side view" },
  { keys: "r", label: "Reset view" },
  { keys: "m", label: "Move photo on the model" },
  { keys: "w", label: "Wireframe" },
  { keys: "b", label: "Backlight" },
  { keys: "mod+z", label: "Undo" },
  { keys: "mod+shift+z", label: "Redo" },
  { keys: "mod+o", label: "Choose photo" },
  { keys: "mod+s", label: "Save settings" },
  { keys: "mod+e", label: "Download STL" },
];

const VIEW_OPTIONS: { value: StageView; label: string; icon: React.ReactNode }[] = [
  { value: "model", label: "3D model", icon: <Box /> },
  { value: "layout", label: "Layout", icon: <Frame /> },
  { value: "heightmap", label: "Height map", icon: <ImageIcon /> },
];

/** Undo / redo for the design (mod+Z, mod+shift+Z). */
export function HistoryButtons() {
  const canUndo = useLithophaneHistory((state) => state.canUndo);
  const canRedo = useLithophaneHistory((state) => state.canRedo);
  const undo = useLithophaneHistory((state) => state.undo);
  const redo = useLithophaneHistory((state) => state.redo);
  return (
    <>
      <IconButton size="sm" label="Undo" shortcut="mod+z" icon={<Undo2 />} disabled={!canUndo} onClick={undo} />
      <IconButton size="sm" label="Redo" shortcut="mod+shift+z" icon={<Redo2 />} disabled={!canRedo} onClick={redo} />
    </>
  );
}

export interface StageToolbarProps {
  onCamera: (view: CameraView) => void;
  onResetView: () => void;
  onToggle: (key: "wireframe" | "backlight") => void;
  onTogglePlacing: () => void;
}

/**
 * Stage toolbar: view mode · undo/redo · then per view: camera presets and viewer toggles (3D model),
 * placement presets (Layout) · keyboard shortcuts.
 */
export function StageToolbar({ onCamera, onResetView, onToggle, onTogglePlacing }: StageToolbarProps) {
  const view = useLithophaneSession((state) => state.view);
  const setView = useLithophaneSession((state) => state.setView);
  const hasPhoto = useLithophaneSession((state) => state.photo !== null);
  const placing = useLithophaneSession((state) => state.placing);
  const wireframe = useLithophaneStore((state) => state.settings.wireframe);
  const backlight = useLithophaneStore((state) => state.settings.backlight);

  return (
    <>
      <Segmented size="sm" ariaLabel="Preview mode" value={view} options={VIEW_OPTIONS} onChange={setView} />
      <Separator />
      <HistoryButtons />
      {view === "model" && (
        <>
          <Separator />
          <IconButton size="sm" label="Perspective" shortcut="p" icon={<Axis3d />} onClick={() => onCamera("perspective")} />
          <IconButton size="sm" label="Front" shortcut="f" icon={<Square />} onClick={() => onCamera("front")} />
          <IconButton size="sm" label="Side" shortcut="s" icon={<RectangleVertical />} onClick={() => onCamera("side")} />
          <IconButton size="sm" label="Reset view" shortcut="r" icon={<Scan />} onClick={onResetView} />
          <Separator />
          {hasPhoto && (
            <IconButton size="sm" label="Move photo" shortcut="m" icon={<Move />} pressed={placing} onClick={onTogglePlacing} />
          )}
          <IconButton
            size="sm"
            label="Wireframe"
            shortcut="w"
            icon={<Grid3x3 />}
            pressed={wireframe}
            onClick={() => onToggle("wireframe")}
          />
          <IconButton
            size="sm"
            label="Backlight"
            shortcut="b"
            icon={<Lightbulb />}
            pressed={backlight}
            onClick={() => onToggle("backlight")}
          />
        </>
      )}
      {view === "layout" && (
        <>
          <Separator />
          <PlacementPresetButtons variant="toolbar" />
        </>
      )}
      <ShortcutsButton size="sm" items={LAMP_SHORTCUTS} />
    </>
  );
}
