import { StatusBadge, type StatusTone } from "@/components/ui";
import type { LithophanePreview } from "../use-lithophane-preview";

export type StudioStatus = "empty" | "ready" | "updating" | "exporting" | "attention" | "failed";

const STATUS: Record<StudioStatus, { tone: StatusTone; label: string; pulse?: boolean }> = {
  empty: { tone: "neutral", label: "No image" },
  ready: { tone: "success", label: "Ready" },
  updating: { tone: "info", label: "Updating…", pulse: true },
  exporting: { tone: "info", label: "Exporting…" },
  attention: { tone: "warning", label: "Needs attention" },
  failed: { tone: "danger", label: "Preview failed" },
};

/** One status for the whole studio, shown in the stage header and the mobile action bar. */
export function studioStatus(preview: LithophanePreview, exporting: boolean): StudioStatus {
  if (exporting) return "exporting";
  switch (preview.plan) {
    case "empty":
      return "empty";
    case "needs-mask":
      return "attention";
    case "moon-error":
      return "failed";
    case "moon-loading":
      return "updating";
    case "ready":
      break;
  }
  if (preview.pending) return "updating";
  if (preview.error) return preview.unprintable ? "attention" : "failed";
  return preview.mesh ? "ready" : "updating";
}

/** Why the export button is disabled, or null when exporting is possible. */
export function exportBlockedReason(preview: LithophanePreview): string | null {
  switch (preview.plan) {
    case "empty":
      return "Add a photo or turn on the moon texture to export.";
    case "needs-mask":
      return "Add a mask to export your custom shape.";
    case "moon-error":
      return "The moon texture didn't load. Try again, or turn off the moon texture.";
    default:
      break;
  }
  return preview.unprintable ? "Nothing to print yet — adjust the shape, mask or size so part of the piece is solid." : null;
}

export function StudioStatusBadge({ status }: { status: StudioStatus }) {
  const s = STATUS[status];
  return (
    <StatusBadge tone={s.tone} pulse={s.pulse}>
      {s.label}
    </StatusBadge>
  );
}
