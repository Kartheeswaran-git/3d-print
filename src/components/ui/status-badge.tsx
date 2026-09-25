import { cn } from "@/lib/utils";

export type StatusTone = "success" | "warning" | "danger" | "info" | "neutral";

const STATUS_TONES: Record<StatusTone, { chip: string; dot: string }> = {
  success: { chip: "border-success-line bg-success-tint text-success", dot: "bg-success" },
  warning: { chip: "border-warning-line bg-warning-tint text-warning", dot: "bg-warning" },
  danger: { chip: "border-danger-line bg-danger-tint text-danger", dot: "bg-danger" },
  info: { chip: "border-info-line bg-info-tint text-info", dot: "bg-info" },
  neutral: { chip: "border-line bg-sunken text-secondary", dot: "bg-muted" },
};

/** Status chip: tint + hairline + saturated text, always with a dot (colour never carries state alone). */
export function StatusBadge({
  tone,
  children,
  pulse = false,
  className,
}: {
  tone: StatusTone;
  children: React.ReactNode;
  pulse?: boolean;
  className?: string;
}) {
  const t = STATUS_TONES[tone];
  return (
    <span
      className={cn(
        "inline-flex h-5 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-chip border px-2 text-[12px] font-medium leading-none",
        t.chip,
        className,
      )}
    >
      <span className={cn("size-1.5 shrink-0 rounded-full", t.dot, pulse && "animate-pulse")} aria-hidden="true" />
      {children}
    </span>
  );
}

/** Neutral tag / count chip. */
export function Badge({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex h-5 shrink-0 items-center whitespace-nowrap rounded-chip border border-line bg-sunken px-1.5 text-[12px] font-medium leading-none text-secondary tabular-nums",
        className,
      )}
    >
      {children}
    </span>
  );
}
