"use client";

import { useShallow } from "zustand/react/shallow";
import { Button, InlineAlert, Segmented } from "@/components/ui";
import { hiddenChangedSections, SECTION_TITLES, type InspectorMode } from "../sections";
import { useLithophaneStore } from "../store";
import { useLithophaneSession } from "../session";
import { useInspectorMode } from "../use-inspector-mode";
import { FormSection } from "./form-section";
import { PhotoSection } from "./photo-section";
import { CropSection, MoonSection, PlacementSection } from "./placement-section";
import { StartFromButton } from "./start-from";
import { ReliefSection, ToneSection } from "./tone-relief-sections";

const MODE_OPTIONS: { value: InspectorMode; label: string }[] = [
  { value: "simple", label: "Simple" },
  { value: "advanced", label: "Advanced" },
];

/** Joins section names for a sentence: "Tone", "Tone and Relief", "Crop, Tone and Relief". */
function listNames(names: string[]): string {
  return names.length <= 1 ? (names[0] ?? "") : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

/**
 * Left column: header (Simple / Advanced, Start from…) plus the settings sections, top to bottom in the
 * order people use them. Simple mode shows the essentials; Advanced adds Crop, Tone and Relief and the
 * finer shape controls.
 */
export function LithophaneInspector({ onChoosePhoto, onChooseMask }: { onChoosePhoto: () => void; onChooseMask: () => void }) {
  const [mode, setMode] = useInspectorMode();
  const appMode = useLithophaneSession((state) => state.mode);
  const advanced = mode === "advanced";

  return (
    <>
      <header className="space-y-3 px-1 pb-1">
        <div>
          <h1 className="text-[15px] font-semibold leading-6 text-ink">
            {appMode === "photo-panel" ? "Photo panel" : "Moon lamp"}
          </h1>
          <p className="mt-0.5 text-[13px] leading-5 text-secondary">Adjust the shape and image — the preview updates as you go.</p>
        </div>
        <div className="flex items-center justify-between gap-2">
          <Segmented size="sm" ariaLabel="Settings shown" value={mode} options={MODE_OPTIONS} onChange={setMode} />
          <StartFromButton />
        </div>
      </header>
      <PhotoSection onChoosePhoto={onChoosePhoto} />
      <FormSection onChooseMask={onChooseMask} advanced={advanced} />
      <PlacementSection />
      {appMode === "moon-lamp" && <MoonSection advanced={advanced} />}
      {advanced ? (
        <>
          <CropSection />
          <ToneSection />
          <ReliefSection />
        </>
      ) : (
        <HiddenChangesNote onShowAdvanced={() => setMode("advanced")} />
      )}
    </>
  );
}

/** Simple mode: say so when hidden controls still change the print (FIXES L9). */
function HiddenChangesNote({ onShowAdvanced }: { onShowAdvanced: () => void }) {
  const hidden = useLithophaneStore(useShallow((state) => hiddenChangedSections(state.settings)));
  if (hidden.length === 0) return null;
  // Form is on screen in Simple mode; only its finer controls are hidden.
  const names = listNames(hidden.map((section) => (section === "form" ? "Form details" : SECTION_TITLES[section])));
  return (
    <InlineAlert
      tone="info"
      action={
        <Button variant="secondary" size="xs" onClick={onShowAdvanced}>
          Show advanced settings
        </Button>
      }
    >
      Hidden advanced settings still shape your lamp: {names}.
    </InlineAlert>
  );
}
