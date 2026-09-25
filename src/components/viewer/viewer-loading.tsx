import { Box } from "lucide-react";

/** Placeholder while the 3D viewer bundle loads: a centred skeleton tile. */
export function ViewerLoading() {
  return (
    <div role="status" className="flex h-full w-full min-h-0 flex-col items-center justify-center gap-3">
      <span
        aria-hidden
        className="flex h-24 w-24 animate-[skeleton-pulse_1.4s_ease-in-out_infinite] items-center justify-center rounded-card border border-line bg-surface text-icon-muted"
      >
        <Box className="h-6 w-6" />
      </span>
      <span className="text-[13px] text-secondary">Loading 3D preview…</span>
    </div>
  );
}
