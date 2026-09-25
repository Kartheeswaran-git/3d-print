"use client";

import { useId, type Ref } from "react";
import { Layers, Palette, RotateCcw, Ruler, SlidersHorizontal, Type } from "lucide-react";
import { Button, ColorField, FieldHint, FieldLabel, InspectorSection, Segmented, SliderField, inputClassName } from "@/components/ui";
import { cn } from "@/lib/utils";
import {
  differsFromDefaults,
  hasPrintableText,
  thicknessSummary,
  visibleSectionKeys,
  type InspectorMode,
  type InspectorSectionId,
} from "../derive";
import { COLOUR_PRESETS, findColourPreset } from "../presets";
import {
  DEFAULTS,
  MAX_TEXT_LENGTH,
  NUMERIC,
  type KeychainNumericKey,
  type KeychainSettings,
} from "../settings";
import { FontPicker } from "./font-picker";

const MODE_OPTIONS: { value: InspectorMode; label: string }[] = [
  { value: "simple", label: "Simple" },
  { value: "advanced", label: "Advanced" },
];

export interface KeychainInspectorProps {
  settings: KeychainSettings;
  /** Continuous edits (typing, slider moves, colour pickers); edits close together form one undo step. */
  update: (patch: Partial<KeychainSettings>) => void;
  /** Discrete picks (font, colour preset), each its own undo step. */
  applyStep: (patch: Partial<KeychainSettings>) => void;
  /** Restore `keys` to their defaults as one undo step. */
  resetKeys: (keys: readonly (keyof KeychainSettings)[]) => void;
  /** A slider drag starts / ends: the whole drag is one undo step. */
  onGestureStart: () => void;
  onGestureEnd: () => void;
  /** Simple shows the name, font, height and colours; Advanced shows everything. */
  mode: InspectorMode;
  onModeChange: (mode: InspectorMode) => void;
  /** Outline width the last preview actually used (it is capped on short plates). */
  appliedOutlineMm: number | null;
  nameInputRef: Ref<HTMLInputElement>;
}

/** Left column: header (with the Simple / Advanced switch) plus the Text, Size, Thickness and Colours sections. */
export function KeychainInspector({
  settings,
  update,
  applyStep,
  resetKeys,
  onGestureStart,
  onGestureEnd,
  mode,
  onModeChange,
  appliedOutlineMm,
  nameInputRef,
}: KeychainInspectorProps) {
  const s = settings;
  const advanced = mode === "advanced";
  const outlineCapped = appliedOutlineMm !== null && appliedOutlineMm < s.outlineWidth - 0.05;
  const cappedHint = outlineCapped
    ? `Outline limited to ${appliedOutlineMm.toFixed(1)} mm at this height so the letters stay readable.`
    : null;
  const preset = findColourPreset(s.baseColor, s.textColor);

  const slider = (key: KeychainNumericKey, label: string, hint?: React.ReactNode) => {
    const spec = NUMERIC[key];
    return (
      <SliderField
        id={`keychain-${key}`}
        label={label}
        value={s[key]}
        min={spec.min}
        max={spec.max}
        step={spec.step}
        format={spec.format}
        defaultValue={DEFAULTS[key]}
        onChange={(v) => {
          const patch: Partial<KeychainSettings> = {};
          patch[key] = v;
          update(patch);
        }}
        onDragStart={onGestureStart}
        onDragEnd={onGestureEnd}
        hint={hint}
      />
    );
  };

  const sectionReset = (section: InspectorSectionId) => {
    const keys = visibleSectionKeys(section, mode);
    return <SectionReset visible={differsFromDefaults(s, keys)} onReset={() => resetKeys(keys)} />;
  };

  return (
    <>
      <header className="space-y-0.5 px-1 pb-1">
        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
          <h1 className="text-[15px] font-semibold leading-6 text-ink">Name keychain</h1>
          <Segmented size="sm" ariaLabel="Settings shown" value={mode} options={MODE_OPTIONS} onChange={onModeChange} />
        </div>
        <p className="text-[13px] leading-5 text-secondary">Type a name, choose a font, and export a two-colour model.</p>
      </header>

      <InspectorSection
        id="keychain-text"
        title="Text"
        icon={Type}
        tint="product"
        defaultOpen
        summary={hasPrintableText(s.text) ? s.text.trim() : "No name yet"}
      >
        <NameField value={s.text} onChange={(text) => update({ text })} inputRef={nameInputRef} />
        <FontField settings={s} onChange={(font) => applyStep({ font })} />
      </InspectorSection>

      <InspectorSection id="keychain-size" title="Size" icon={Ruler} tint="plan" defaultOpen summary={`${s.targetHeight} mm tall`}>
        {/* In Simple mode the outline slider is hidden, so the cap is explained under the height instead. */}
        {slider("targetHeight", "Height", (!advanced && cappedHint) || "Total plate height, outline included.")}
        {advanced && (
          <>
            {slider("outlineWidth", "Outline width", cappedHint ?? "Width of the plate border around the letters.")}
            {slider("holeSize", "Keyring hole", "Diameter of the hole for the key ring.")}
          </>
        )}
        {sectionReset("size")}
      </InspectorSection>

      {advanced && (
        <InspectorSection
          id="keychain-thickness"
          title="Thickness"
          icon={Layers}
          tint="status"
          defaultOpen
          summary={thicknessSummary(s)}
        >
          {slider("baseThickness", "Base thickness", "Solid plate under the letters.")}
          {slider("textThickness", "Raised text", "How far the letters stand above the base.")}
          {sectionReset("thickness")}
        </InspectorSection>
      )}

      <InspectorSection
        id="keychain-colours"
        title="Colours"
        icon={Palette}
        tint="date"
        defaultOpen
        summary={
          <span className="inline-flex max-w-full items-center gap-1.5 align-middle">
            <Swatch color={s.baseColor} />
            <Swatch color={s.textColor} />
            <span className="truncate">{preset ? preset.label : "Custom colours"}</span>
          </span>
        }
      >
        <div className="@container">
          <div className="grid gap-4 @[17rem]:grid-cols-2 @[17rem]:gap-3">
            <ColorField id="keychain-base-color" label="Base colour" value={s.baseColor} onChange={(baseColor) => update({ baseColor })} />
            <ColorField id="keychain-text-color" label="Text colour" value={s.textColor} onChange={(textColor) => update({ textColor })} />
          </div>
        </div>
        <ColourPresets
          activeId={preset?.id ?? null}
          onPick={(base, text) => applyStep({ baseColor: base, textColor: text })}
        />
        {sectionReset("colours")}
      </InspectorSection>

      {!advanced && (
        <div className="flex items-center justify-between gap-3 px-1">
          <p className="min-w-0 text-[12px] leading-4 text-secondary">Outline, keyring hole and thickness are in Advanced.</p>
          <Button variant="ghost" size="xs" icon={<SlidersHorizontal />} onClick={() => onModeChange("advanced")} className="shrink-0">
            Show all
          </Button>
        </div>
      )}
    </>
  );
}

function NameField({ value, onChange, inputRef }: { value: string; onChange: (text: string) => void; inputRef: Ref<HTMLInputElement> }) {
  const id = "keychain-name";
  const hintId = `${id}-hint`;
  const counterId = `${id}-counter`;
  const empty = !hasPrintableText(value);
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between gap-3">
        <FieldLabel htmlFor={id}>Name</FieldLabel>
        <span id={counterId} className="font-mono text-[12px] leading-4 text-secondary tabular-nums">
          {value.length}/{MAX_TEXT_LENGTH}
        </span>
      </div>
      <input
        ref={inputRef}
        id={id}
        type="text"
        value={value}
        maxLength={MAX_TEXT_LENGTH}
        autoComplete="off"
        autoCorrect="off"
        spellCheck={false}
        enterKeyHint="done"
        placeholder="Type a name"
        aria-invalid={empty || undefined}
        aria-describedby={`${hintId} ${counterId}`}
        onChange={(e) => onChange(e.target.value)}
        className={cn(inputClassName, "h-10 text-[16px] sm:text-[16px]")}
      />
      {empty ? (
        <FieldHint id={hintId} tone="danger">
          Type a name to preview your keychain.
        </FieldHint>
      ) : (
        <FieldHint id={hintId}>Letters, numbers and spaces, up to {MAX_TEXT_LENGTH} characters.</FieldHint>
      )}
    </div>
  );
}

function FontField({ settings, onChange }: { settings: KeychainSettings; onChange: (font: KeychainSettings["font"]) => void }) {
  const labelId = useId();
  return (
    <div className="space-y-1.5">
      <FieldLabel id={labelId}>Font</FieldLabel>
      <FontPicker labelId={labelId} value={settings.font} text={settings.text} onChange={onChange} />
    </div>
  );
}

function ColourPresets({ activeId, onPick }: { activeId: string | null; onPick: (base: string, text: string) => void }) {
  const labelId = useId();
  return (
    <div className="space-y-1.5">
      <FieldLabel id={labelId}>Presets</FieldLabel>
      <div role="group" aria-labelledby={labelId} className="flex flex-wrap gap-1.5">
        {COLOUR_PRESETS.map((p) => {
          const active = p.id === activeId;
          return (
            <button
              key={p.id}
              type="button"
              aria-pressed={active}
              onClick={() => onPick(p.base, p.text)}
              className={cn(
                "inline-flex h-7 max-w-full items-center gap-1.5 rounded-control border px-2 text-[12px] font-medium leading-4",
                "transition-colors duration-[120ms] ease-[cubic-bezier(0.2,0,0.38,0.9)]",
                active
                  ? "border-brand bg-brand-tint text-brand-hover"
                  : "border-line bg-surface text-body hover:border-line-strong hover:bg-sunken",
              )}
            >
              <span className="flex shrink-0 -space-x-1" aria-hidden="true">
                <Swatch color={p.base} />
                <Swatch color={p.text} />
              </span>
              <span className="truncate">{p.label}</span>
            </button>
          );
        })}
      </div>
      <FieldHint>Preview colours only — pick matching filaments in your slicer.</FieldHint>
    </div>
  );
}

/** 12px colour dot. The colour is user data (filament preview), so it is applied inline. */
function Swatch({ color }: { color: string }) {
  return (
    <span
      aria-hidden="true"
      className="inline-block size-3 shrink-0 rounded-full border border-line-strong"
      style={{ backgroundColor: color }}
    />
  );
}

function SectionReset({ visible, onReset }: { visible: boolean; onReset: () => void }) {
  if (!visible) return null;
  return (
    <div className="flex justify-end border-t border-line-subtle pt-3">
      <Button variant="ghost" size="xs" icon={<RotateCcw />} onClick={onReset}>
        Reset section
      </Button>
    </div>
  );
}
