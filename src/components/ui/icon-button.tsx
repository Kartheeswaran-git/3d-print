"use client";

import { cn } from "@/lib/utils";
import { KeyCombo } from "./kbd";
import { toAriaKeyShortcuts } from "./keys";
import { Tooltip } from "./tooltip";

export type IconButtonProps = Omit<React.ComponentProps<"button">, "children"> & {
  /** Accessible name, also shown as the tooltip. */
  label: string;
  icon: React.ReactNode;
  /** Makes the button a toggle (`aria-pressed`) with cobalt tint when on. */
  pressed?: boolean;
  variant?: "ghost" | "secondary";
  size?: "sm" | "md";
  /** Shortcut shown in the tooltip, e.g. "w" or "mod+s". */
  shortcut?: string;
  tooltipSide?: "top" | "bottom" | "left" | "right";
};

const SIZES = { sm: "size-8", md: "size-9" } as const;

/** Square icon-only button with a tooltip and an accessible label. */
export function IconButton({
  label,
  icon,
  pressed,
  variant = "ghost",
  size = "md",
  shortcut,
  tooltipSide,
  className,
  type = "button",
  ...props
}: IconButtonProps) {
  const isToggle = pressed !== undefined;
  return (
    <Tooltip
      side={tooltipSide}
      content={
        <span className="flex items-center gap-2">
          {label}
          {shortcut && <KeyCombo keys={shortcut} />}
        </span>
      }
    >
      <button
        type={type}
        aria-label={label}
        aria-pressed={isToggle ? pressed : undefined}
        aria-keyshortcuts={shortcut ? toAriaKeyShortcuts(shortcut) : undefined}
        className={cn(
          "inline-flex shrink-0 items-center justify-center rounded-control transition-colors duration-[120ms] ease-[cubic-bezier(0.2,0,0.38,0.9)]",
          "disabled:cursor-not-allowed disabled:text-muted [&_svg]:size-4 [&_svg]:shrink-0",
          SIZES[size],
          variant === "secondary" ? "border border-line bg-surface" : "border border-transparent",
          pressed
            ? "border-brand-200 bg-brand-tint text-brand hover:bg-brand-100"
            : variant === "secondary"
              ? "text-secondary hover:border-line-strong hover:bg-sunken hover:text-body disabled:bg-sunken"
              : "text-secondary hover:bg-surface-hover hover:text-body disabled:bg-transparent",
          className,
        )}
        {...props}
      >
        {icon}
      </button>
    </Tooltip>
  );
}
