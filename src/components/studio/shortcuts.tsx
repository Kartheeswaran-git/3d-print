"use client";

import { useEffect, useEffectEvent, useState } from "react";
import { Popover } from "radix-ui";
import { Keyboard } from "lucide-react";
import { IconButton } from "@/components/ui/icon-button";
import { KeyCombo } from "@/components/ui/kbd";
import { detectMac, isInsideDialog, isTypingTarget, matchShortcut, parseShortcut } from "@/components/ui/keys";

/**
 * Global keyboard shortcuts. Keys look like "1", "f", "?", "mod+s" (mod = ⌘ on Apple, Ctrl elsewhere).
 * Plain keys are ignored while typing in inputs, selects and editable content; `mod+` combos still fire.
 * Nothing fires while focus is inside a dialog. Matching shortcuts call `preventDefault()`.
 */
export function useShortcuts(map: Record<string, (e: KeyboardEvent) => void>, enabled = true): void {
  const onKeyDown = useEffectEvent((e: KeyboardEvent) => {
    if (e.defaultPrevented || e.isComposing || e.repeat) return;
    if (isInsideDialog(e.target)) return;
    const typing = isTypingTarget(e.target);
    const isMac = detectMac();
    for (const [combo, handler] of Object.entries(map)) {
      const shortcut = parseShortcut(combo);
      const usesModifier = shortcut.mod || shortcut.ctrl || shortcut.meta;
      if (typing && !usesModifier) continue;
      if (matchShortcut(e, shortcut, isMac)) {
        e.preventDefault();
        handler(e);
        return;
      }
    }
  });

  useEffect(() => {
    if (!enabled) return;
    const listener = (e: KeyboardEvent) => onKeyDown(e);
    window.addEventListener("keydown", listener);
    return () => window.removeEventListener("keydown", listener);
  }, [enabled]);
}

export interface ShortcutsButtonProps {
  items: { keys: string; label: string }[];
  size?: "sm" | "md";
}

/** Keyboard icon button (also opened with "?") showing a popover of shortcuts. */
export function ShortcutsButton({ items, size = "md" }: ShortcutsButtonProps) {
  const [open, setOpen] = useState(false);
  useShortcuts({ "?": () => setOpen((o) => !o) });

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <IconButton label="Keyboard shortcuts" shortcut="?" size={size} icon={<Keyboard />} />
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          align="end"
          sideOffset={6}
          collisionPadding={8}
          aria-label="Keyboard shortcuts"
          className="z-[60] w-64 rounded-card border border-line bg-surface p-3 shadow-e2 focus-visible:outline-none! transition-[opacity,translate] duration-[160ms] starting:translate-y-0.5 starting:opacity-0"
        >
          <p className="mb-2 text-[13px] font-semibold leading-5 text-ink">Keyboard shortcuts</p>
          <ul className="space-y-1.5">
            {items.map((item) => (
              <li key={item.keys} className="flex items-center justify-between gap-3 text-[13px] leading-5 text-body">
                <span className="min-w-0 truncate">{item.label}</span>
                <KeyCombo keys={item.keys} />
              </li>
            ))}
          </ul>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
