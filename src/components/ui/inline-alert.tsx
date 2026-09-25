import { CircleAlert, CircleCheck, Info, TriangleAlert, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

export type AlertTone = "danger" | "warning" | "info" | "success";

const TONES: Record<AlertTone, { box: string; icon: string; Icon: LucideIcon }> = {
  danger: { box: "border-danger-line bg-danger-tint", icon: "text-danger", Icon: CircleAlert },
  warning: { box: "border-warning-line bg-warning-tint", icon: "text-warning", Icon: TriangleAlert },
  info: { box: "border-info-line bg-info-tint", icon: "text-info", Icon: Info },
  success: { box: "border-success-line bg-success-tint", icon: "text-success", Icon: CircleCheck },
};

/** Inline message next to the thing it is about. Failures say what happened and what to do next. */
export function InlineAlert({
  tone,
  title,
  children,
  action,
  className,
}: {
  tone: AlertTone;
  title?: string;
  children?: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
}) {
  const t = TONES[tone];
  return (
    <div
      role={tone === "danger" ? "alert" : "status"}
      className={cn("flex gap-2.5 rounded-control border px-3 py-2.5 text-[13px] leading-5", t.box, className)}
    >
      <t.Icon className={cn("mt-0.5 size-4 shrink-0", t.icon)} aria-hidden="true" />
      <div className="min-w-0 flex-1">
        {title && <p className="font-semibold text-ink [overflow-wrap:anywhere]">{title}</p>}
        {children && <div className={cn("text-body [overflow-wrap:anywhere]", title && "mt-0.5")}>{children}</div>}
        {action && <div className="mt-2 flex flex-wrap items-center gap-2">{action}</div>}
      </div>
    </div>
  );
}
