"use client";

import { cn } from "@/lib/utils";
import { formatShortcutKeys, useIsMac } from "./keys";

/** A single key cap. */
export function Kbd({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <kbd
      className={cn(
        "inline-flex h-5 min-w-5 items-center justify-center rounded-chip border border-line bg-sunken px-1 font-mono text-[12px] font-medium leading-none text-secondary",
        className,
      )}
    >
      {children}
    </kbd>
  );
}

/** Renders a shortcut string ("mod+s", "?", "1") as platform-appropriate key caps. */
export function KeyCombo({ keys, className }: { keys: string; className?: string }) {
  const isMac = useIsMac();
  const caps = formatShortcutKeys(keys, isMac);
  return (
    <span className={cn("inline-flex items-center gap-0.5", className)}>
      {caps.map((cap, i) => (
        <Kbd key={`${cap}-${i}`}>{cap}</Kbd>
      ))}
    </span>
  );
}
