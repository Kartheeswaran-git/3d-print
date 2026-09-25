"use client";

import { Button, Tooltip } from "@/components/ui";
import { cn } from "@/lib/utils";
import { PLACEMENT_PRESETS, placementPreset, type PlacementPreset } from "../presets";
import { useLithophaneSession } from "../session";
import { useLithophaneStore } from "../store";

/** Apply a placement preset for the current photo as one undo step. */
export function applyPlacementPreset(preset: PlacementPreset): void {
  const { settings, applyStep } = useLithophaneStore.getState();
  applyStep(placementPreset(preset, settings, useLithophaneSession.getState().photo));
}

/**
 * Center / Fit / Fill / Badge. "chips" = small secondary buttons in the Placement section; "toolbar" = ghost
 * buttons for the stage toolbar in the Layout view. Everything but Center needs a photo.
 */
export function PlacementPresetButtons({ variant = "chips", className }: { variant?: "chips" | "toolbar"; className?: string }) {
  const hasPhoto = useLithophaneSession((state) => state.photo !== null);
  const toolbar = variant === "toolbar";

  return (
    <div role="group" aria-label="Placement presets" className={cn("flex flex-wrap items-center", toolbar ? "gap-0.5" : "gap-1.5", className)}>
      {PLACEMENT_PRESETS.map((preset) => {
        const enabled = hasPhoto || preset.worksWithoutPhoto;
        const button = (
          <Button
            key={preset.id}
            variant={toolbar ? "ghost" : "secondary"}
            size={toolbar ? "sm" : "xs"}
            disabled={!enabled}
            aria-description={preset.description}
            onClick={() => applyPlacementPreset(preset.id)}
          >
            {preset.label}
          </Button>
        );
        // Disabled buttons get no pointer events, so only enabled ones carry a tooltip.
        return enabled ? (
          <Tooltip key={preset.id} content={preset.description}>
            {button}
          </Tooltip>
        ) : (
          button
        );
      })}
    </div>
  );
}
