"use client";

import { Tooltip as TooltipPrimitive } from "radix-ui";

export interface TooltipProps {
  content: React.ReactNode;
  side?: "top" | "bottom" | "left" | "right";
  /** A single element that accepts a ref and DOM props (a button, link, …). */
  children: React.ReactElement;
}

/** Small floating label. Needs the `Tooltip.Provider` from `app/providers.tsx`. */
export function Tooltip({ content, side = "top", children }: TooltipProps) {
  if (content === null || content === undefined || content === false || content === "") return children;
  return (
    <TooltipPrimitive.Root>
      <TooltipPrimitive.Trigger asChild>{children}</TooltipPrimitive.Trigger>
      <TooltipPrimitive.Portal>
        <TooltipPrimitive.Content
          side={side}
          sideOffset={6}
          collisionPadding={8}
          className="z-[70] max-w-64 select-none rounded-control border border-line bg-surface px-2 py-1 text-[12px] font-medium leading-5 text-body shadow-e2 transition-opacity duration-[120ms] starting:opacity-0"
        >
          {content}
        </TooltipPrimitive.Content>
      </TooltipPrimitive.Portal>
    </TooltipPrimitive.Root>
  );
}
