import { cn } from "@/lib/utils";

/** Loading placeholder at the real shape of the content (pulses opacity .6 → 1 over 1.4 s). */
export function Skeleton({ className }: { className?: string }) {
  return (
    <div
      aria-hidden="true"
      className={cn("rounded-chip bg-surface-hover animate-[skeleton-pulse_1.4s_ease-in-out_infinite]", className)}
    />
  );
}
