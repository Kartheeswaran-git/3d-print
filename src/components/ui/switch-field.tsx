"use client";

import { useId } from "react";
import { Switch } from "radix-ui";
import { cn } from "@/lib/utils";
import { FieldHint } from "./field";

export interface SwitchFieldProps {
  id?: string;
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  hint?: React.ReactNode;
  disabled?: boolean;
}

/** Label + hint on the left, switch on the right. */
export function SwitchField({ id, label, checked, onChange, hint, disabled = false }: SwitchFieldProps) {
  const autoId = useId();
  const switchId = id ?? `switch-${autoId}`;
  const hintId = `${switchId}-hint`;
  return (
    <div className="flex items-start justify-between gap-3">
      <div className="min-w-0 space-y-0.5">
        <label
          htmlFor={switchId}
          className={cn("block text-[13px] font-medium leading-5", disabled ? "text-muted" : "cursor-pointer text-secondary")}
        >
          {label}
        </label>
        {hint && <FieldHint id={hintId}>{hint}</FieldHint>}
      </div>
      <Switch.Root
        id={switchId}
        checked={checked}
        onCheckedChange={onChange}
        disabled={disabled}
        aria-describedby={hint ? hintId : undefined}
        className="relative inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full bg-line-strong p-0.5 transition-colors duration-[120ms] data-[state=checked]:bg-brand disabled:cursor-not-allowed disabled:opacity-50"
      >
        <Switch.Thumb className="block size-4 rounded-full bg-surface shadow-e1 transition-[translate,background-color] duration-[120ms] ease-[cubic-bezier(0.2,0,0.38,0.9)] data-[state=checked]:translate-x-4 data-[state=checked]:bg-on-brand" />
      </Switch.Root>
    </div>
  );
}
