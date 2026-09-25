import { LoaderCircle } from "lucide-react";
import { cn } from "@/lib/utils";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger" | "danger-ghost";
export type ButtonSize = "xs" | "sm" | "md" | "lg";

const BASE =
  "relative inline-flex shrink-0 select-none items-center justify-center gap-1.5 whitespace-nowrap rounded-control font-medium " +
  "transition-colors duration-[120ms] ease-[cubic-bezier(0.2,0,0.38,0.9)] disabled:cursor-not-allowed " +
  "[&_svg]:size-3.5 [&_svg]:shrink-0";

const VARIANTS: Record<ButtonVariant, string> = {
  primary: "bg-brand text-on-brand hover:bg-brand-hover active:bg-brand-active disabled:bg-line-strong disabled:text-muted",
  secondary:
    "border border-line bg-surface text-body hover:border-line-strong hover:bg-sunken active:bg-surface-hover " +
    "disabled:border-line disabled:bg-sunken disabled:text-muted",
  ghost: "text-secondary hover:bg-surface-hover hover:text-body active:bg-line-subtle disabled:bg-transparent disabled:text-muted",
  danger: "bg-danger text-on-brand hover:bg-danger/90 active:bg-danger/80 disabled:bg-line-strong disabled:text-muted",
  "danger-ghost": "text-danger hover:bg-danger-tint active:bg-danger-tint disabled:bg-transparent disabled:text-muted",
};

const SIZES: Record<ButtonSize, string> = {
  xs: "h-7 px-2.5 text-[13px]",
  sm: "h-8 px-3 text-[13px]",
  md: "h-9 px-4 text-[13px]",
  lg: "h-10 px-4 text-[14px]",
};

/** Class names for a button-styled element (use on links that look like buttons). */
export function buttonClassName({
  variant = "secondary",
  size = "md",
  solidEdge = true,
  className,
}: { variant?: ButtonVariant; size?: ButtonSize; solidEdge?: boolean; className?: string } = {}) {
  const solid = variant === "primary" || variant === "danger";
  return cn(BASE, VARIANTS[variant], SIZES[size], solid && solidEdge && "tex-edge", className);
}

export type ButtonProps = React.ComponentProps<"button"> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Swaps the leading icon for a spinner and disables the button; the label stays. */
  loading?: boolean;
  /** Leading icon (rendered at 14px). */
  icon?: React.ReactNode;
};

/** The house button. Exactly one `primary` per view. */
export function Button({
  variant = "secondary",
  size = "md",
  loading = false,
  icon,
  className,
  children,
  disabled,
  type = "button",
  ...props
}: ButtonProps) {
  const isDisabled = disabled || loading;
  return (
    <button
      type={type}
      disabled={isDisabled}
      aria-busy={loading || undefined}
      className={buttonClassName({ variant, size, solidEdge: !isDisabled, className })}
      {...props}
    >
      {loading ? <LoaderCircle className="animate-spin" aria-hidden="true" /> : icon}
      {children}
    </button>
  );
}
