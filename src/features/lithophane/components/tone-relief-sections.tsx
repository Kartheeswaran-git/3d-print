"use client";

import { Layers, SlidersHorizontal } from "lucide-react";
import { Badge, InspectorSection } from "@/components/ui";
import { isSectionModified } from "../sections";
import { effectiveMaxThickness, MIN_THICKNESS_GAP } from "../settings";
import { useLithophaneStore } from "../store";
import { SectionReset, SettingSlider, SettingSwitch } from "./setting-controls";

/** Tone: how the image's brightness maps to wall thickness before meshing (FIXES L3, L9, L17). */
export function ToneSection() {
  const edited = useLithophaneStore((state) => isSectionModified("tone", state.settings));
  return (
    <InspectorSection
      id="lamp-tone"
      title="Tone"
      icon={SlidersHorizontal}
      tint="date"
      badge={<Badge>Advanced</Badge>}
      summary={edited ? "Edited" : "Default"}
    >
      <SettingSlider setting="brightness" label="Brightness" />
      <SettingSlider setting="contrast" label="Contrast" />
      <SettingSlider setting="gamma" label="Gamma" />
      <SettingSlider setting="blur" label="Blur" />
      <SettingSlider setting="sharpen" label="Sharpen" />
      <SettingSwitch setting="autoLevels" label="Auto levels" hint="Stretch the darkest and lightest tones to full range." />
      <SettingSwitch setting="invert" label="Invert" hint="Swap thick and thin areas." />
      <SectionReset section="tone" />
    </InspectorSection>
  );
}

/** Relief: wall thickness range, tone curve and mesh detail (FIXES L9). */
export function ReliefSection() {
  const min = useLithophaneStore((state) => state.settings.minThickness);
  const max = useLithophaneStore((state) => state.settings.maxThickness);
  const effectiveMax = effectiveMaxThickness({ minThickness: min, maxThickness: max });
  const raised = effectiveMax - max > 1e-6;

  return (
    <InspectorSection
      id="lamp-relief"
      title="Relief"
      icon={Layers}
      tint="status"
      badge={<Badge>Advanced</Badge>}
      summary={`${min.toFixed(1)}–${effectiveMax.toFixed(1)} mm`}
    >
      <SettingSlider setting="minThickness" label="Thinnest wall" />
      <SettingSlider
        setting="maxThickness"
        label="Thickest wall"
        hint={raised ? `Kept at least ${MIN_THICKNESS_GAP} mm above the thinnest wall.` : undefined}
      />
      <SettingSlider setting="thicknessGamma" label="Tone curve" />
      <SettingSlider setting="resolution" label="Detail" hint="Smaller values add detail and file size." />
      <SectionReset section="relief" />
    </InspectorSection>
  );
}
