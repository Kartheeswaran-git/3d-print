"use client";

import { useEffect, useEffectEvent, useId, useRef, useState } from "react";
import { Slider } from "radix-ui";
import { RotateCcw } from "lucide-react";
import { cn, snap } from "@/lib/utils";
import { FieldHint, decimalsOf, parseLooseNumber } from "./field";
import { Tooltip } from "./tooltip";

export interface SliderFieldProps {
  id?: string;
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  /** Display text for a value, e.g. `(v) => `${v.toFixed(1)} mm``. */
  format: (v: number) => string;
  /** Fires continuously while dragging and on typed/reset values. */
  onChange: (v: number) => void;
  /** Fires once when the user finishes an interaction (pointer up, key, typed value, reset). */
  onCommit?: (v: number) => void;
  /** Fires when a pointer press on the slider starts a drag, e.g. to open an undo group (`history.begin()`). */
  onDragStart?: () => void;
  /**
   * Fires exactly once per `onDragStart`, when the drag ends: pointer up or cancel, lost pointer capture,
   * or the field unmounting mid-drag — even when the value didn't change (`history.end()`).
   */
  onDragEnd?: () => void;
  /** Shows a reset button while the value differs from it. */
  defaultValue?: number;
  hint?: React.ReactNode;
  disabled?: boolean;
  /** Replaces the hint while disabled, explaining how to enable the control. */
  disabledReason?: string;
}

interface DisplayUnits {
  /** Display value = stored value × scale (e.g. 0..1 shown as %). */
  scale: number;
  decimals: number;
  suffix: string;
}

const LEADING_NUMBER = /^\s*[+\-−]?(\d+\.?\d*|\.\d+)/;

/**
 * Work out how `format` presents numbers so the inline editor can speak the same units:
 * a power-of-ten scale (0..1 → %), the decimals of one step, and the unit suffix.
 */
function inferUnits(format: (v: number) => string, min: number, max: number, step: number): DisplayUnits {
  const ref = Math.abs(max) >= Math.abs(min) ? max : min;
  let scale = 1;
  const sample = ref === 0 ? "" : format(ref);
  if (ref !== 0) {
    const ratio = parseLooseNumber(sample) / ref;
    if (Number.isFinite(ratio) && ratio > 0) {
      const p = Math.round(Math.log10(ratio));
      if (Math.abs(ratio - 10 ** p) <= 1e-6 * 10 ** p) scale = 10 ** p;
    }
  }
  const suffix = LEADING_NUMBER.test(sample) ? sample.replace(LEADING_NUMBER, "").trim() : "";
  return { scale, decimals: decimalsOf(step * scale), suffix };
}

/** Labelled slider with a click-to-type value and an optional reset to default. */
export function SliderField({
  id,
  label,
  value,
  min,
  max,
  step,
  format,
  onChange,
  onCommit,
  onDragStart,
  onDragEnd,
  defaultValue,
  hint,
  disabled = false,
  disabledReason,
}: SliderFieldProps) {
  const autoId = useId();
  const thumbId = id ?? `slider-${autoId}`;
  const labelId = `${thumbId}-label`;
  const hintId = `${thumbId}-hint`;
  const [editing, setEditing] = useState(false);
  const valueButtonRef = useRef<HTMLButtonElement>(null);
  const refocusValue = useRef(false);
  const dragging = useRef(false);

  useEffect(() => {
    if (!editing && refocusValue.current) {
      refocusValue.current = false;
      valueButtonRef.current?.focus();
    }
  }, [editing]);

  const startDrag = () => {
    if (disabled || dragging.current) return;
    dragging.current = true;
    onDragStart?.();
  };
  const endDrag = () => {
    if (!dragging.current) return;
    dragging.current = false;
    onDragEnd?.();
  };
  // Never leave a drag (and its undo group) open when the field goes away mid-gesture.
  const endDragOnUnmount = useEffectEvent(endDrag);
  useEffect(() => () => endDragOnUnmount(), []);

  const tolerance = step / 1000;
  const showReset = defaultValue !== undefined && Math.abs(value - defaultValue) > tolerance && !disabled;
  const hintContent = disabled && disabledReason ? disabledReason : hint;
  const units = inferUnits(format, min, max, step);

  const apply = (v: number) => {
    onChange(v);
    onCommit?.(v);
  };

  const finishEditing = (text: string | null, viaKeyboard: boolean) => {
    if (text !== null) {
      const parsed = parseLooseNumber(text);
      if (Number.isFinite(parsed)) {
        const next = snap(parsed / units.scale, min, max, step);
        if (Math.abs(next - value) > tolerance) apply(next);
      }
    }
    refocusValue.current = viaKeyboard;
    setEditing(false);
  };

  return (
    <div className="group/field space-y-2">
      <div className="flex min-h-6 items-center gap-1">
        <span id={labelId} className={cn("min-w-0 flex-1 truncate text-[13px] font-medium leading-5", disabled ? "text-muted" : "text-secondary")}>
          {label}
        </span>
        {showReset && (
          <Tooltip content={`Reset to ${format(defaultValue)}`}>
            <button
              type="button"
              aria-label={`Reset ${label} to ${format(defaultValue)}`}
              onClick={() => apply(defaultValue)}
              className={cn(
                "inline-flex size-6 shrink-0 items-center justify-center rounded-chip text-muted",
                "opacity-0 transition-[opacity,color,background-color] duration-[120ms] hover:bg-surface-hover hover:text-body",
                "focus-visible:opacity-100 group-focus-within/field:opacity-100 group-hover/field:opacity-100 [@media(hover:none)]:opacity-100",
              )}
            >
              <RotateCcw className="size-3" aria-hidden="true" />
            </button>
          </Tooltip>
        )}
        {editing ? (
          <InlineNumberEditor
            label={label}
            initial={(value * units.scale).toFixed(units.decimals)}
            suffix={units.suffix}
            onDone={finishEditing}
          />
        ) : (
          <Tooltip content="Type a value">
            <button
              ref={valueButtonRef}
              type="button"
              disabled={disabled}
              onClick={() => setEditing(true)}
              aria-label={`${label}: ${format(value)}. Type a value`}
              className="inline-flex h-6 shrink-0 items-center rounded-chip px-1.5 font-mono text-[13px] tabular-nums text-body transition-colors duration-[120ms] hover:bg-surface-hover disabled:cursor-not-allowed disabled:bg-transparent disabled:text-muted"
            >
              {format(value)}
            </button>
          </Tooltip>
        )}
      </div>
      <Slider.Root
        value={[value]}
        min={min}
        max={max}
        step={step}
        disabled={disabled}
        onValueChange={(v) => {
          if (v[0] !== undefined) onChange(v[0]);
        }}
        onValueCommit={(v) => {
          if (v[0] !== undefined) onCommit?.(v[0]);
        }}
        // Radix captures the pointer on press and commits only changed values, so the drag's end is
        // tracked from the pointer itself.
        onPointerDown={startDrag}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onLostPointerCapture={endDrag}
        className="relative flex h-5 w-full touch-none select-none items-center data-[disabled]:cursor-not-allowed"
      >
        <Slider.Track className="relative h-1 grow overflow-hidden rounded-full bg-line">
          <Slider.Range className="absolute h-full bg-brand data-[disabled]:bg-line-strong" />
        </Slider.Track>
        <Slider.Thumb
          id={thumbId}
          aria-labelledby={labelId}
          aria-describedby={hintContent ? hintId : undefined}
          aria-valuetext={format(value)}
          className="block size-3.5 rounded-full border-2 border-brand bg-surface transition-[scale,border-color] duration-[120ms] hover:scale-110 data-[disabled]:border-line-strong data-[disabled]:hover:scale-100"
        />
      </Slider.Root>
      {hintContent && <FieldHint id={hintId}>{hintContent}</FieldHint>}
    </div>
  );
}

/** Inline value editor: Enter commits, Escape cancels, blur commits. */
function InlineNumberEditor({
  label,
  initial,
  suffix,
  onDone,
}: {
  label: string;
  initial: string;
  suffix: string;
  onDone: (text: string | null, viaKeyboard: boolean) => void;
}) {
  const [text, setText] = useState(initial);
  const inputRef = useRef<HTMLInputElement>(null);
  const settled = useRef(false);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  const finish = (result: string | null, viaKeyboard: boolean) => {
    if (settled.current) return;
    settled.current = true;
    onDone(result, viaKeyboard);
  };

  return (
    <span className="flex h-7 shrink-0 items-center rounded-chip border border-brand bg-surface shadow-focus">
      <input
        ref={inputRef}
        type="text"
        inputMode="decimal"
        aria-label={`${label} value${suffix ? ` in ${suffix}` : ""}`}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onBlur={() => finish(text, false)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            finish(text, true);
          } else if (e.key === "Escape") {
            e.preventDefault();
            e.stopPropagation();
            finish(null, true);
          }
        }}
        className="h-full w-16 min-w-0 bg-transparent px-1.5 text-right font-mono text-[16px] tabular-nums text-body focus-visible:outline-none! sm:text-[13px]"
      />
      {suffix && <span className="pr-1.5 font-mono text-[12px] text-muted">{suffix}</span>}
    </span>
  );
}
