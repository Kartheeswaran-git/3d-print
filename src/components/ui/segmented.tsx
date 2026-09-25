"use client";

import { ToggleGroup } from "radix-ui";
import { cn } from "@/lib/utils";

export interface SegmentedOption<T extends string> {
  value: T;
  label: string;
  icon?: React.ReactNode;
}

export interface SegmentedProps<T extends string> {
  value: T;
  options: SegmentedOption<T>[];
  onChange: (v: T) => void;
  ariaLabel: string;
  size?: "sm" | "md";
  className?: string;
}

const TRACK = { sm: "h-8", md: "h-9" } as const;
const ITEM = { sm: "h-7 px-2.5", md: "h-8 px-3" } as const;

/** Segmented control for 2–4 exclusive options (Radix ToggleGroup, arrow-key navigation). */
export function Segmented<T extends string>({ value, options, onChange, ariaLabel, size = "md", className }: SegmentedProps<T>) {
  return (
    <ToggleGroup.Root
      type="single"
      value={value}
      onValueChange={(v) => {
        // Radix allows deselecting the active item; a segmented control always keeps one.
        const next = options.find((o) => o.value === v);
        if (next) onChange(next.value);
      }}
      aria-label={ariaLabel}
      className={cn("inline-flex items-center gap-0.5 rounded-control border border-line bg-sunken p-0.5", TRACK[size], className)}
    >
      {options.map((o) => (
        <ToggleGroup.Item
          key={o.value}
          value={o.value}
          className={cn(
            "inline-flex flex-1 items-center justify-center gap-1.5 whitespace-nowrap rounded-chip text-[13px] font-medium text-secondary",
            "transition-colors duration-[120ms] hover:text-body disabled:cursor-not-allowed disabled:text-muted",
            "data-[state=on]:bg-surface data-[state=on]:text-ink data-[state=on]:shadow-e1 [&_svg]:size-3.5 [&_svg]:shrink-0",
            ITEM[size],
          )}
        >
          {o.icon}
          <span className="truncate">{o.label}</span>
        </ToggleGroup.Item>
      ))}
    </ToggleGroup.Root>
  );
}
