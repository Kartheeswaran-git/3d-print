"use client";

import { Crop, Moon, Move } from "lucide-react";
import { FieldHint, InspectorSection, SelectField, type SelectOption } from "@/components/ui";
import type { MoonSurface } from "@/lib/image";
import { computeCropRect } from "@/lib/image/compose";
import { placementModelAspect } from "../presets";
import { useLithophaneSession } from "../session";
import { formatMoonLongitude, MOON_SURFACE_LABELS, MOON_SURFACES, type CropRatio, type LithophaneSettings } from "../settings";
import { useLithophaneStore } from "../store";
import { PlacementPresetButtons } from "./placement-presets";
import { SectionReset, SettingSlider, SettingSwitch } from "./setting-controls";

const NO_PHOTO_PLACEMENT = "Add a photo to adjust its placement.";

function placementSummary(s: LithophaneSettings): string {
  const parts = [`${Math.round(s.imageScale)}%`, s.imageX === 0 && s.imageY === 0 ? "centred" : "offset"];
  if (s.rotation !== 0) parts.push(`${Math.round(s.rotation)}°`);
  return parts.join(" · ");
}

/** Image placement: presets, then where the photo sits on the lamp. */
export function PlacementSection() {
  const hasPhoto = useLithophaneSession((state) => state.photo !== null);
  const summary = useLithophaneStore((state) => (hasPhoto ? placementSummary(state.settings) : "No photo"));
  const noPhoto = hasPhoto ? null : NO_PHOTO_PLACEMENT;

  return (
    <InspectorSection id="lamp-placement" title="Image placement" icon={Move} tint="order" defaultOpen summary={summary}>
      <div className="space-y-1.5">
        <PlacementPresetButtons />
        <FieldHint>
          {hasPhoto
            ? "Or drag the photo in the Layout view, or with Move photo on the 3D model."
            : "Add a photo to fit, fill or badge it."}
        </FieldHint>
      </div>
      <SettingSlider setting="imageScale" label="Scale" disabledReason={noPhoto} />
      <SettingSlider setting="imageX" label="Horizontal position" disabledReason={noPhoto} />
      <SettingSlider setting="imageY" label="Vertical position" disabledReason={noPhoto} />
      <SettingSlider setting="rotation" label="Rotation" disabledReason={noPhoto} />
      <SectionReset section="placement" />
    </InspectorSection>
  );
}

const MOON_SURFACE_DESCRIPTIONS: Record<MoonSurface, string> = {
  lro: "Real brightness map from NASA's Lunar Reconnaissance Orbiter.",
  shaded: "Stylised relief with crisp crater shading.",
};

const MOON_SURFACE_OPTIONS: SelectOption<MoonSurface>[] = MOON_SURFACES.map((surface) => ({
  value: surface,
  label: MOON_SURFACE_LABELS[surface],
  description: MOON_SURFACE_DESCRIPTIONS[surface],
}));

const MOON_SURFACE_SHORT: Record<MoonSurface, string> = { lro: "NASA LRO", shaded: "Shaded craters" };

/** Moon: the lunar surface around (or instead of) the photo, and which side of the moon faces out. */
export function MoonSection({ advanced }: { advanced: boolean }) {
  const moonBackground = useLithophaneStore((state) => state.settings.moonBackground);
  const moonSurface = useLithophaneStore((state) => state.settings.moonSurface);
  const summary = useLithophaneStore((state) =>
    state.settings.moonBackground
      ? `${MOON_SURFACE_SHORT[state.settings.moonSurface]} · ${formatMoonLongitude(state.settings.moonLongitude)}`
      : "Off",
  );
  const set = useLithophaneStore((state) => state.set);
  const hasPhoto = useLithophaneSession((state) => state.photo !== null);
  const off = moonBackground ? null : "Turn on the moon surface background to choose a side.";

  return (
    <InspectorSection id="lamp-moon" title="Moon" icon={Moon} tint="product" defaultOpen summary={summary}>
      <SettingSwitch
        setting="moonBackground"
        label="Moon surface background"
        hint="Fills the space around your photo with lunar surface detail."
      />
      <SelectField
        id="litho-moonSurface"
        label="Moon surface"
        value={moonSurface}
        options={MOON_SURFACE_OPTIONS}
        onChange={(v) => set("moonSurface", v)}
        hint={moonBackground ? undefined : "Used when the moon surface background is on."}
      />
      <SettingSlider setting="moonLongitude" label="Moon side" hint="Drag the moon in Layout view to turn it." disabledReason={off} />
      {advanced && (
        <SettingSlider
          setting="edgeBlend"
          label="Edge blend"
          disabledReason={
            !moonBackground ? "Turn on the moon surface background to blend photo edges." : hasPhoto ? null : "Add a photo to blend its edges."
          }
        />
      )}
      <SectionReset section="moon" />
    </InspectorSection>
  );
}

const CROP_OPTIONS: SelectOption<CropRatio>[] = [
  { value: "original", label: "Original" },
  { value: "model", label: "Match model shape", description: "Crop to the proportions of the piece (square on the globe)." },
  { value: "1:1", label: "1:1 square" },
  { value: "4:3", label: "4:3 landscape" },
  { value: "3:4", label: "3:4 portrait" },
  { value: "16:9", label: "16:9 wide" },
  { value: "9:16", label: "9:16 tall" },
];

const CROP_SHORT: Record<CropRatio, string> = {
  original: "Original",
  model: "Model shape",
  "1:1": "1:1",
  "4:3": "4:3",
  "3:4": "3:4",
  "16:9": "16:9",
  "9:16": "9:16",
};

/** Free room (source px) around the crop rectangle, so offsets that can't move anything are disabled. */
function useCropSlack(): { x: boolean; y: boolean } | null {
  const photo = useLithophaneSession((state) => state.photo);
  const slackX = useLithophaneStore((state) => {
    if (!photo) return 0;
    const rect = computeCropRect(photo.width, photo.height, state.settings, placementModelAspect(state.settings));
    return photo.width - rect.w;
  });
  const slackY = useLithophaneStore((state) => {
    if (!photo) return 0;
    const rect = computeCropRect(photo.width, photo.height, state.settings, placementModelAspect(state.settings));
    return photo.height - rect.h;
  });
  return photo ? { x: slackX > 0.5, y: slackY > 0.5 } : null;
}

/** Crop: which part of the photo is used. */
export function CropSection() {
  const cropRatio = useLithophaneStore((state) => state.settings.cropRatio);
  const summary = useLithophaneStore((state) => `${CROP_SHORT[state.settings.cropRatio]} · ${Math.round(state.settings.cropScale * 100)}%`);
  const set = useLithophaneStore((state) => state.set);
  const slack = useCropSlack();
  const noPhoto = slack ? null : "Add a photo to crop it.";
  const fixed = "Make the crop smaller or change the aspect ratio to move it.";

  return (
    <InspectorSection id="lamp-crop" title="Crop" icon={Crop} tint="order" summary={summary}>
      <SelectField
        id="litho-cropRatio"
        label="Aspect ratio"
        value={cropRatio}
        options={CROP_OPTIONS}
        onChange={(v) => set("cropRatio", v)}
        hint={slack ? undefined : "Applies once you add a photo."}
      />
      <SettingSlider setting="cropScale" label="Crop size" disabledReason={noPhoto} />
      <SettingSlider setting="cropX" label="Crop horizontal" disabledReason={noPhoto ?? (slack?.x ? null : fixed)} />
      <SettingSlider setting="cropY" label="Crop vertical" disabledReason={noPhoto ?? (slack?.y ? null : fixed)} />
      <SectionReset section="crop" />
    </InspectorSection>
  );
}
