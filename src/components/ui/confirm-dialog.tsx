"use client";

import { useRef } from "react";
import { AlertDialog } from "radix-ui";
import { Button } from "./button";

export interface ConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: React.ReactNode;
  confirmLabel: string;
  /** "danger" = solid red confirm (destructive); "primary" = cobalt. */
  tone?: "danger" | "primary";
  onConfirm: () => void;
}

/** Confirmation dialog (Radix AlertDialog). Focus starts on Cancel; Esc cancels. */
export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel,
  tone = "danger",
  onConfirm,
}: ConfirmDialogProps) {
  // The dialog is controlled without a Radix trigger, so remember what had focus and return it on close.
  const returnFocus = useRef<HTMLElement | null>(null);
  return (
    <AlertDialog.Root open={open} onOpenChange={onOpenChange}>
      <AlertDialog.Portal>
        <AlertDialog.Overlay className="fixed inset-0 z-[90] bg-ink/25 transition-opacity duration-[200ms] starting:opacity-0 dark:bg-canvas/75" />
        <AlertDialog.Content
          onOpenAutoFocus={() => {
            returnFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
          }}
          onCloseAutoFocus={(e) => {
            const el = returnFocus.current;
            returnFocus.current = null;
            if (el && el.isConnected && el !== document.body) {
              e.preventDefault();
              el.focus();
            }
          }}
          className="fixed left-1/2 top-1/2 z-[90] w-[calc(100vw-2rem)] max-w-[420px] -translate-x-1/2 -translate-y-1/2 rounded-modal border border-line bg-surface shadow-e3 transition-[opacity,scale] duration-[200ms] ease-[cubic-bezier(0.16,1,0.3,1)] starting:scale-[0.98] starting:opacity-0">
          <div className="flex min-h-14 items-center border-b border-line px-5 py-3">
            <AlertDialog.Title className="text-[17px] font-semibold leading-6 text-ink">{title}</AlertDialog.Title>
          </div>
          <AlertDialog.Description asChild>
            <div className="px-5 py-5 text-[14px] leading-[1.5] text-body">{description}</div>
          </AlertDialog.Description>
          <div className="flex min-h-14 flex-wrap items-center justify-end gap-2 border-t border-line px-5 py-3">
            <AlertDialog.Cancel asChild>
              <Button variant="secondary" size="sm">
                Cancel
              </Button>
            </AlertDialog.Cancel>
            <AlertDialog.Action asChild>
              <Button variant={tone === "danger" ? "danger" : "primary"} size="sm" onClick={onConfirm}>
                {confirmLabel}
              </Button>
            </AlertDialog.Action>
          </div>
        </AlertDialog.Content>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  );
}
