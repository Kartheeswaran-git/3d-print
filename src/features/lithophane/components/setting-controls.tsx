"use client";

import { RotateCcw } from "lucide-react";
import { Button, SliderField, SwitchField } from "@/components/ui";
import { isSectionModified, type SectionId } from "../sections";
import { DEFAULTS, NUMERIC, type BooleanKey, type NumericKey } from "../settings";
import { useLithophaneHistory, useLithophaneStore } from "../store";

/**
 * Slider bound to one numeric setting: range, step, format and default come from settings.ts.
 * A drag is a single undo step.
 */
export function SettingSlider({
  setting,
  label,
  hint,
  disabledReason,
}: {
  setting: NumericKey;
  label: string;
  hint?: React.ReactNode;
  /** Disables the slider and explains why (FIXES L11). */
  disabledReason?: string | null;
}) {
  const value = useLithophaneStore((state) => state.settings[setting]);
  const set = useLithophaneStore((state) => state.set);
  const begin = useLithophaneHistory((state) => state.begin);
  const end = useLithophaneHistory((state) => state.end);
  const spec = NUMERIC[setting];
  return (
    <SliderField
      id={`litho-${setting}`}
      label={label}
      value={value}
      min={spec.min}
      max={spec.max}
      step={spec.step}
      format={spec.format}
      defaultValue={DEFAULTS[setting]}
      onChange={(v) => set(setting, v)}
      onDragStart={begin}
      onDragEnd={end}
      hint={hint}
      disabled={Boolean(disabledReason)}
      disabledReason={disabledReason ?? undefined}
    />
  );
}

/** Switch bound to one boolean setting. */
export function SettingSwitch({
  setting,
  label,
  hint,
  disabled,
}: {
  setting: BooleanKey;
  label: string;
  hint?: React.ReactNode;
  disabled?: boolean;
}) {
  const checked = useLithophaneStore((state) => state.settings[setting]);
  const set = useLithophaneStore((state) => state.set);
  return (
    <SwitchField id={`litho-${setting}`} label={label} checked={checked} onChange={(v) => set(setting, v)} hint={hint} disabled={disabled} />
  );
}

/** Section footer with "Reset section", shown only while a value in the section differs from its default. */
export function SectionReset({ section }: { section: SectionId }) {
  const modified = useLithophaneStore((state) => isSectionModified(section, state.settings));
  const resetSection = useLithophaneStore((state) => state.resetSection);
  if (!modified) return null;
  return (
    <div className="flex justify-end border-t border-line-subtle pt-3">
      <Button variant="ghost" size="xs" icon={<RotateCcw aria-hidden="true" />} onClick={() => resetSection(section)}>
        Reset section
      </Button>
    </div>
  );
}
