import { cn } from "@/lib/utils";

/** 13/500 secondary field label. */
export function FieldLabel({
  htmlFor,
  id,
  className,
  children,
}: {
  htmlFor?: string;
  id?: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <label htmlFor={htmlFor} id={id} className={cn("block text-[13px] font-medium leading-5 text-secondary", className)}>
      {children}
    </label>
  );
}

/** Helper line under a field. Errors replace it, in danger, and state the fix. */
export function FieldHint({
  id,
  tone = "default",
  className,
  children,
}: {
  id?: string;
  tone?: "default" | "danger";
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <p
      id={id}
      role={tone === "danger" ? "alert" : undefined}
      className={cn("text-[12px] leading-4", tone === "danger" ? "text-danger" : "text-secondary", className)}
    >
      {children}
    </p>
  );
}

/** Shared text-input look: 36px, control radius, cobalt border + soft ring on focus. */
export const inputClassName =
  "h-9 w-full min-w-0 rounded-control border border-line bg-surface px-3 text-[16px] text-body sm:text-[13px] " +
  "placeholder:text-muted hover:border-line-strong focus:border-brand focus:shadow-focus focus-visible:outline-none! " +
  "disabled:cursor-not-allowed disabled:bg-sunken disabled:text-muted " +
  "aria-[invalid=true]:border-danger aria-[invalid=true]:focus:border-danger " +
  "transition-[border-color,box-shadow] duration-[120ms]";

/** Count decimals needed to show values on a `step` grid. */
export function decimalsOf(step: number): number {
  if (!Number.isFinite(step) || step <= 0) return 0;
  const text = String(Number(step.toFixed(10)));
  return text.includes("e-") ? Number(text.split("e-")[1]) : (text.split(".")[1] ?? "").length;
}

/** Lenient number parse: accepts "12", "+12", "−3", "0,5", "12 mm", "85%". */
export function parseLooseNumber(input: string): number {
  const cleaned = input.trim().replace(/−/g, "-").replace(",", ".");
  const match = /^[+-]?(\d+\.?\d*|\.\d+)/.exec(cleaned);
  return match ? Number(match[0]) : Number.NaN;
}
