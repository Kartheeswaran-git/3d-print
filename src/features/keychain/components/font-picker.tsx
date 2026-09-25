"use client";

import { RadioGroup } from "radix-ui";
import { Check } from "lucide-react";
import { cn } from "@/lib/utils";
import { KEYCHAIN_FONT_FACES } from "../fonts";
import { KEYCHAIN_FONTS, type KeychainFont } from "../settings";

export interface FontPickerProps {
  value: KeychainFont;
  onChange: (font: KeychainFont) => void;
  /** The name being designed; each row renders it in its own typeface. */
  text: string;
  labelId: string;
}

/** Live font list: one radio row per face showing the current name in that face (arrow keys move the selection). */
export function FontPicker({ value, onChange, text, labelId }: FontPickerProps) {
  const sample = text.trim() || "Aa";
  return (
    <RadioGroup.Root
      value={value}
      onValueChange={(v) => {
        const next = KEYCHAIN_FONTS.find((f) => f === v);
        if (next) onChange(next);
      }}
      aria-labelledby={labelId}
      className="space-y-1.5"
    >
      {KEYCHAIN_FONTS.map((id) => {
        const face = KEYCHAIN_FONT_FACES[id];
        return (
          <RadioGroup.Item
            key={id}
            value={id}
            aria-label={`${face.label} (${face.name})`}
            className={cn(
              "group flex h-12 w-full min-w-0 items-center gap-3 rounded-control border px-3 text-left",
              "transition-colors duration-[120ms] ease-[cubic-bezier(0.2,0,0.38,0.9)]",
              "border-line bg-surface hover:border-line-strong hover:bg-sunken",
              "data-[state=checked]:border-brand data-[state=checked]:bg-brand-tint",
            )}
          >
            {/* Faces are self-hosted by next/font; this row is also what makes the browser fetch each one. */}
            <span
              aria-hidden="true"
              className={cn(face.className, "min-w-0 flex-1 truncate py-1 text-[20px] leading-8 text-ink")}
              style={{ fontWeight: face.weight }}
            >
              {sample}
            </span>
            <span
              aria-hidden="true"
              className="shrink-0 text-[13px] leading-5 text-secondary group-data-[state=checked]:text-brand-hover"
            >
              {face.label}
            </span>
            <span className="flex size-4 shrink-0 items-center justify-center" aria-hidden="true">
              <RadioGroup.Indicator className="flex size-4 items-center justify-center rounded-full bg-brand text-on-brand">
                <Check className="size-3" strokeWidth={3} />
              </RadioGroup.Indicator>
            </span>
          </RadioGroup.Item>
        );
      })}
    </RadioGroup.Root>
  );
}
