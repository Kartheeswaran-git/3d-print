import { cn } from "@/lib/utils";

/** Hairline divider; vertical by default for toolbars. */
export function Separator({
  orientation = "vertical",
  className,
}: {
  orientation?: "vertical" | "horizontal";
  className?: string;
}) {
  return (
    <span
      role="separator"
      aria-orientation={orientation}
      className={cn(
        "shrink-0 bg-line",
        orientation === "vertical" ? "mx-1 h-5 w-px self-center" : "my-1 block h-px w-full",
        className,
      )}
    />
  );
}
