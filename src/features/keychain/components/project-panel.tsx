"use client";

import { useState } from "react";
import { Download, FolderOpen, RotateCcw, X } from "lucide-react";
import { Button, ConfirmDialog, InlineAlert, KeyCombo } from "@/components/ui";
import { Panel } from "@/components/studio";
import { toAriaKeyShortcuts } from "@/components/ui/keys";
import type { KeychainProject } from "../use-keychain-project";

/** Aside panel: save and open settings files, reset everything (with confirmation). */
export function ProjectPanel({ project }: { project: KeychainProject }) {
  const [confirmOpen, setConfirmOpen] = useState(false);

  return (
    <Panel title="Project" description="Settings save automatically on this device. Save a file to keep a copy.">
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" icon={<Download />} onClick={project.save} aria-keyshortcuts={toAriaKeyShortcuts("mod+s")}>
          Save settings
          <span aria-hidden="true" className="ml-0.5 inline-flex">
            <KeyCombo keys="mod+s" />
          </span>
        </Button>
        <Button size="sm" icon={<FolderOpen />} onClick={project.open}>
          Open settings…
        </Button>
        <Button size="sm" variant="danger-ghost" icon={<RotateCcw />} onClick={() => setConfirmOpen(true)}>
          Reset everything
        </Button>
      </div>
      {project.input}

      {project.loadError && (
        <InlineAlert
          tone="danger"
          title="Couldn’t open that file"
          className="mt-3"
          action={
            <>
              <Button size="xs" icon={<FolderOpen />} onClick={project.open}>
                Choose another file
              </Button>
              <Button variant="ghost" size="xs" icon={<X />} onClick={project.dismissError}>
                Dismiss
              </Button>
            </>
          }
        >
          {project.loadError}
        </InlineAlert>
      )}

      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title="Reset everything?"
        description="The name, font, size, thickness and colours all return to their defaults. You can undo this afterwards."
        confirmLabel="Reset"
        tone="danger"
        onConfirm={project.resetAll}
      />
    </Panel>
  );
}
