import { StatusBadge } from "@/components/ui";
import type { KeychainPreviewStatus } from "../use-keychain-preview";

/** Studio-wide status: the preview pipeline, overridden while a file is being exported. */
export type KeychainStudioStatus = KeychainPreviewStatus | "exporting";

/** Status chip shown in the stage header and the mobile action bar. */
export function KeychainStatusBadge({ status }: { status: KeychainStudioStatus }) {
  switch (status) {
    case "exporting":
      return <StatusBadge tone="info">Exporting…</StatusBadge>;
    case "empty":
      return <StatusBadge tone="warning">Needs attention</StatusBadge>;
    case "error":
      return <StatusBadge tone="danger">Preview failed</StatusBadge>;
    case "ready":
      return <StatusBadge tone="success">Ready</StatusBadge>;
    case "waiting":
    case "updating":
      return (
        <StatusBadge tone="info" pulse>
          Updating…
        </StatusBadge>
      );
  }
}
