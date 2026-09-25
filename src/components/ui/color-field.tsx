"use client";

import { useId, useState } from "react";
import { cn } from "@/lib/utils";
import { FieldHint, FieldLabel, inputClassName } from "./field";
import { useSettledValue } from "./use-settled-value";

export interface ColorFieldProps {
  id?: string;
  label: string;
  /** "#rrggbb". */
  value: string;
  onChange: (hex: string) => void;
}

/** Normalise "#abc", "abc", "#AABBCC" or "aabbcc" to "#aabbcc"; null when not a hex colour. */
export function normalizeHex(input: string): string | null {
  const raw = input.trim().replace(/^#/, "").toLowerCase();
  if (/^[0-9a-f]{6}$/.test(raw)) return `#${raw}`;
  if (/^[0-9a-f]{3}$/.test(raw)) return `#${raw.split("").map((c) => c + c).join("")}`;
  return null;
}

/** Colour swatch (native picker) + validated hex input. */
export function ColorField({ id, label, value, onChange }: ColorFieldProps) {
  const autoId = useId();
  const inputId = id ?? `color-${autoId}`;
  const messageId = `${inputId}-message`;
  const [draft, setDraft] = useState<string | null>(null);
  const settledDraft = useSettledValue(draft, 900);
  const current = normalizeHex(value) ?? "#000000";
  const text = draft ?? current;
  const digits = (draft ?? "").trim().replace(/^#/, "");
  // Non-hex characters are wrong straight away; a short value may still be mid-typing.
  const malformed = draft !== null && (!/^[0-9a-f]*$/i.test(digits) || digits.length > 6);
  const incomplete = draft !== null && digits !== "" && normalizeHex(draft) === null && !malformed;
  const invalid = malformed || (incomplete && settledDraft === draft);

  const commit = () => {
    if (draft === null) return;
    const hex = normalizeHex(draft);
    setDraft(null);
    if (hex && hex !== current) onChange(hex);
  };

  return (
    <div className="min-w-0 space-y-1.5">
      <FieldLabel htmlFor={inputId}>{label}</FieldLabel>
      <div className="flex items-center gap-2">
        <span
          className="relative size-9 shrink-0 overflow-hidden rounded-control border border-line has-focus-visible:outline-2 has-focus-visible:outline-offset-2 has-focus-visible:outline-brand"
          style={{ backgroundColor: current }}
        >
          <input
            type="color"
            value={current}
            aria-label={`${label}: choose a colour`}
            onChange={(e) => {
              setDraft(null);
              const hex = normalizeHex(e.target.value);
              if (hex) onChange(hex);
            }}
            className="absolute inset-0 size-full cursor-pointer opacity-0"
          />
        </span>
        <input
          id={inputId}
          type="text"
          autoComplete="off"
          autoCapitalize="off"
          spellCheck={false}
          maxLength={7}
          value={text}
          aria-invalid={invalid || undefined}
          aria-describedby={invalid ? messageId : undefined}
          onChange={(e) => {
            const next = e.target.value;
            setDraft(next);
            // Apply complete six-digit colours live; shorthand waits for blur/Enter.
            const hex = /^#?[0-9a-f]{6}$/i.test(next.trim()) ? normalizeHex(next) : null;
            if (hex && hex !== current) onChange(hex);
          }}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              commit();
            } else if (e.key === "Escape" && draft !== null) {
              e.preventDefault();
              e.stopPropagation();
              setDraft(null);
            }
          }}
          className={cn(inputClassName, "font-mono tabular-nums")}
        />
      </div>
      {invalid && (
        <FieldHint id={messageId} tone="danger">
          Enter a colour as #rrggbb, for example #3f49c9.
        </FieldHint>
      )}
    </div>
  );
}
