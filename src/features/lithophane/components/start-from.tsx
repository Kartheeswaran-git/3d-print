"use client";

import { useState } from "react";
import { Popover } from "radix-ui";
import { LayoutTemplate } from "lucide-react";
import { Button } from "@/components/ui";
import { STARTER_DESIGNS, starterDesignPatch, type StarterDesign } from "../presets";
import { useLithophaneSession } from "../session";
import { useLithophaneStore } from "../store";

/** Apply a starter design (with its placement worked out for the loaded photo) as one undo step. */
function applyStarterDesign(design: StarterDesign): void {
  const { settings, applyStep } = useLithophaneStore.getState();
  applyStep(starterDesignPatch(design, settings, useLithophaneSession.getState().photo));
}

/** "Start from…": a popover of starter designs. The photo stays; applying is a single undo step. */
export function StartFromButton() {
  const [open, setOpen] = useState(false);

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <Button variant="ghost" size="sm" icon={<LayoutTemplate aria-hidden="true" />}>
          Start from…
        </Button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          align="end"
          sideOffset={6}
          collisionPadding={8}
          aria-label="Starter designs"
          className="z-[60] w-72 rounded-card border border-line bg-surface p-1 shadow-e2 focus-visible:outline-none! transition-[opacity,translate] duration-[160ms] starting:translate-y-0.5 starting:opacity-0"
        >
          <p className="px-2.5 pb-1 pt-2 text-[12px] leading-4 text-muted">Start from a design</p>
          <ul className="space-y-0.5">
            {STARTER_DESIGNS.map((design) => (
              <li key={design.id}>
                <button
                  type="button"
                  onClick={() => {
                    applyStarterDesign(design);
                    setOpen(false);
                  }}
                  className="block w-full rounded-control px-2.5 py-2 text-left transition-colors duration-[120ms] hover:bg-surface-hover"
                >
                  <span className="block text-[13px] font-medium leading-5 text-ink">{design.label}</span>
                  <span className="block text-[12px] leading-4 text-secondary">{design.description}</span>
                </button>
              </li>
            ))}
          </ul>
          <p className="border-t border-line-subtle px-2.5 pb-1.5 pt-2 text-[12px] leading-4 text-secondary">
            Your photo stays. Undo brings your settings back.
          </p>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
