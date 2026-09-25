"use client";

import { RadioGroup } from "radix-ui";
import { Check } from "lucide-react";
import { cn } from "@/lib/utils";

export interface TileOption<T extends string> {
  value: T;
  label: string;
  icon: React.ReactNode;
}

export interface TilePickerProps<T extends string> {
  value: T;
  options: TileOption<T>[];
  onChange: (v: T) => void;
  ariaLabel: string;
  /** Maximum columns; narrow containers drop one column so labels never clip. */
  columns?: 2 | 3 | 4;
}

// Container queries: a tile needs ~64px for a 9-letter 12px label plus padding.
const COLUMNS = {
  2: "grid-cols-2",
  3: "grid-cols-2 @[13rem]:grid-cols-3",
  4: "grid-cols-3 @[17.5rem]:grid-cols-4",
} as const;

/** Grid of icon tiles acting as a radio group (arrow keys move the selection). */
export function TilePicker<T extends string>({ value, options, onChange, ariaLabel, columns = 4 }: TilePickerProps<T>) {
  return (
    <RadioGroup.Root
      value={value}
      onValueChange={(v) => {
        const next = options.find((o) => o.value === v);
        if (next) onChange(next.value);
      }}
      aria-label={ariaLabel}
      className="@container"
    >
      <div className={cn("grid gap-1.5", COLUMNS[columns])}>
        {options.map((o) => (
          <RadioGroup.Item
            key={o.value}
            value={o.value}
            className={cn(
              "relative flex min-w-0 flex-col items-center justify-center gap-1.5 rounded-control border px-1 pb-2 pt-2.5",
              "text-[12px] font-medium leading-4 transition-colors duration-[120ms] [&_svg]:size-5 [&_svg]:shrink-0",
              "border-line bg-surface text-secondary hover:border-line-strong hover:bg-sunken hover:text-body",
              "data-[state=checked]:border-brand data-[state=checked]:bg-brand-tint data-[state=checked]:text-brand",
              "disabled:cursor-not-allowed disabled:text-muted",
            )}
          >
            {o.icon}
            <span className="max-w-full truncate">{o.label}</span>
            <RadioGroup.Indicator className="absolute right-1 top-1 flex size-3.5 items-center justify-center rounded-full bg-brand text-on-brand">
              <Check className="size-2.5!" strokeWidth={3} aria-hidden="true" />
            </RadioGroup.Indicator>
          </RadioGroup.Item>
        ))}
      </div>
    </RadioGroup.Root>
  );
}
