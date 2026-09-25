"use client";

import { useId } from "react";
import { Select } from "radix-ui";
import { Check, ChevronDown } from "lucide-react";
import { FieldHint, FieldLabel } from "./field";

export interface SelectOption<T extends string> {
  value: T;
  label: string;
  description?: string;
}

export interface SelectFieldProps<T extends string> {
  id?: string;
  label: string;
  value: T;
  options: SelectOption<T>[];
  onChange: (v: T) => void;
  hint?: React.ReactNode;
}

/** Labelled dropdown (Radix Select). Options may carry a one-line description. */
export function SelectField<T extends string>({ id, label, value, options, onChange, hint }: SelectFieldProps<T>) {
  const autoId = useId();
  const triggerId = id ?? `select-${autoId}`;
  const labelId = `${triggerId}-label`;
  const hintId = `${triggerId}-hint`;
  const byValue = new Map(options.map((o) => [o.value as string, o.value]));

  return (
    <div className="min-w-0 space-y-1.5">
      <FieldLabel id={labelId} htmlFor={triggerId}>
        {label}
      </FieldLabel>
      <Select.Root
        value={value}
        onValueChange={(v) => {
          const next = byValue.get(v);
          if (next !== undefined) onChange(next);
        }}
      >
        <Select.Trigger
          id={triggerId}
          aria-labelledby={labelId}
          aria-describedby={hint ? hintId : undefined}
          className="flex h-9 w-full min-w-0 items-center justify-between gap-2 rounded-control border border-line bg-surface px-3 text-left text-[13px] text-body transition-colors duration-[120ms] hover:border-line-strong data-[state=open]:border-brand data-[placeholder]:text-muted"
        >
          <span className="min-w-0 truncate">
            <Select.Value />
          </span>
          <Select.Icon asChild>
            <ChevronDown className="size-4 shrink-0 text-muted" aria-hidden="true" />
          </Select.Icon>
        </Select.Trigger>
        <Select.Portal>
          <Select.Content
            position="popper"
            sideOffset={4}
            collisionPadding={8}
            className="z-[60] max-h-[var(--radix-select-content-available-height)] w-[var(--radix-select-trigger-width)] min-w-48 overflow-hidden rounded-card border border-line bg-surface shadow-e2 transition-[opacity,translate] duration-[160ms] starting:translate-y-0.5 starting:opacity-0"
          >
            <Select.Viewport className="p-1">
              {options.map((o) => (
                <Select.Item
                  key={o.value}
                  value={o.value}
                  className="relative flex min-h-8 cursor-default select-none flex-col justify-center rounded-control py-1.5 pl-2.5 pr-8 text-[13px] leading-5 text-body outline-none focus-visible:outline-none! data-[highlighted]:bg-surface-hover data-[state=checked]:bg-brand-tint data-[state=checked]:font-medium data-[state=checked]:text-brand-hover data-[state=checked]:data-[highlighted]:bg-brand-100 data-[disabled]:text-muted"
                >
                  <Select.ItemText>{o.label}</Select.ItemText>
                  {o.description && (
                    <span className="text-[12px] font-normal leading-4 text-secondary">{o.description}</span>
                  )}
                  <Select.ItemIndicator className="absolute right-2.5 top-2.5">
                    <Check className="size-3.5" aria-hidden="true" />
                  </Select.ItemIndicator>
                </Select.Item>
              ))}
            </Select.Viewport>
          </Select.Content>
        </Select.Portal>
      </Select.Root>
      {hint && <FieldHint id={hintId}>{hint}</FieldHint>}
    </div>
  );
}
