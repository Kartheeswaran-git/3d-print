"use client";

import { useId, useState } from "react";
import { cn, snap } from "@/lib/utils";
import { FieldHint, FieldLabel, decimalsOf, parseLooseNumber } from "./field";
import { useSettledValue } from "./use-settled-value";

export interface NumberFieldProps {
  id?: string;
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  /** Shown inside the field, e.g. "mm". */
  unit?: string;
  /** Called with a clamped, step-snapped value on blur, Enter or arrow keys. */
  onChange: (v: number) => void;
  hint?: React.ReactNode;
  disabled?: boolean;
}

function show(n: number, decimals: number): string {
  return String(Number(n.toFixed(decimals)));
}

/**
 * "none": empty, partial ("-", ".") or in range. "pending": out of range but more typing could fix it.
 * "final": not a number, or already too large in magnitude for any further digits to help.
 */
function draftError(draft: string, min: number, max: number): "none" | "pending" | "final" {
  const trimmed = draft.trim();
  if (trimmed === "" || /^[+\-−]?[.,]?$/.test(trimmed)) return "none";
  const n = parseLooseNumber(trimmed);
  if (!Number.isFinite(n) || !/^[+\-−]?(\d+[.,]?\d*|[.,]\d+)$/.test(trimmed)) return "final";
  if (n >= min && n <= max) return "none";
  // More digits never change the sign.
  if ((n < 0 && min >= 0) || (n > 0 && max <= 0)) return "final";
  return Math.abs(n) > Math.max(Math.abs(min), Math.abs(max)) ? "final" : "pending";
}

/** Numeric input that validates while typing and commits a clamped, snapped value (FIXES L5). */
export function NumberField({ id, label, value, min, max, step, unit, onChange, hint, disabled = false }: NumberFieldProps) {
  const autoId = useId();
  const inputId = id ?? `number-${autoId}`;
  const messageId = `${inputId}-message`;
  const decimals = decimalsOf(step);
  const [draft, setDraft] = useState<string | null>(null);

  const settledDraft = useSettledValue(draft, 700);

  const text = draft ?? show(value, decimals);
  const error = draft === null ? "none" : draftError(draft, min, max);
  // "1" on the way to "150" only counts as an error once the user pauses on it.
  const invalid = error === "final" || (error === "pending" && settledDraft === draft);
  const rangeMessage = `Enter a value from ${show(min, decimals)} to ${show(max, decimals)}${unit ? ` ${unit}` : ""}`;

  const commit = () => {
    if (draft === null) return;
    const n = parseLooseNumber(draft);
    setDraft(null);
    if (draft.trim() === "" || !Number.isFinite(n)) return;
    const next = snap(n, min, max, step);
    if (next !== value) onChange(next);
  };

  const nudge = (direction: 1 | -1, large: boolean) => {
    const base = draft !== null && Number.isFinite(parseLooseNumber(draft)) ? parseLooseNumber(draft) : value;
    const next = snap(base + direction * step * (large ? 10 : 1), min, max, step);
    setDraft(null);
    if (next !== value) onChange(next);
  };

  return (
    <div className="min-w-0 space-y-1.5">
      <FieldLabel htmlFor={inputId} className={cn(disabled && "text-muted")}>
        {label}
      </FieldLabel>
      <div
        className={cn(
          "flex h-9 items-center rounded-control border bg-surface transition-[border-color,box-shadow] duration-[120ms]",
          "focus-within:shadow-focus",
          invalid ? "border-danger" : "border-line hover:border-line-strong focus-within:border-brand",
          disabled && "cursor-not-allowed bg-sunken hover:border-line",
        )}
      >
        <input
          id={inputId}
          type="text"
          inputMode="decimal"
          autoComplete="off"
          spellCheck={false}
          disabled={disabled}
          value={text}
          aria-invalid={invalid || undefined}
          aria-describedby={invalid || hint ? messageId : undefined}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              commit();
            } else if (e.key === "Escape" && draft !== null) {
              e.preventDefault();
              e.stopPropagation();
              setDraft(null);
            } else if (e.key === "ArrowUp" || e.key === "ArrowDown") {
              e.preventDefault();
              nudge(e.key === "ArrowUp" ? 1 : -1, e.shiftKey);
            }
          }}
          className="h-full min-w-0 flex-1 bg-transparent pl-3 text-[16px] tabular-nums text-body placeholder:text-muted focus-visible:outline-none! disabled:cursor-not-allowed disabled:text-muted sm:text-[13px]"
        />
        {unit && (
          <span className="pointer-events-none select-none pl-1.5 pr-3 text-[13px] text-muted" aria-hidden="true">
            {unit}
          </span>
        )}
      </div>
      {invalid ? (
        <FieldHint id={messageId} tone="danger">
          {rangeMessage}
        </FieldHint>
      ) : (
        hint && <FieldHint id={messageId}>{hint}</FieldHint>
      )}
    </div>
  );
}
