"use client";

import { useState } from "react";
import { Collapsible } from "radix-ui";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

export type SectionTint = "order" | "product" | "plan" | "date" | "status";

const TINTS: Record<SectionTint, string> = {
  order: "bg-cat-order-tint text-cat-order",
  product: "bg-cat-product-tint text-cat-product",
  plan: "bg-cat-plan-tint text-cat-plan",
  date: "bg-cat-date-tint text-cat-date",
  status: "bg-cat-status-tint text-cat-status",
};

export interface InspectorSectionProps {
  /** DOM id of the section (also prefixes the heading and panel ids). */
  id: string;
  title: string;
  icon: React.ComponentType<{ className?: string }>;
  tint: SectionTint;
  /** One-line recap shown under the title while collapsed. */
  summary?: React.ReactNode;
  defaultOpen?: boolean;
  /** Small chip next to the title, e.g. <Badge>Advanced</Badge>. */
  badge?: React.ReactNode;
  children: React.ReactNode;
}

/** Collapsible inspector card with a tinted category tile. */
export function InspectorSection({
  id,
  title,
  icon: Icon,
  tint,
  summary,
  defaultOpen = false,
  badge,
  children,
}: InspectorSectionProps) {
  const [open, setOpen] = useState(defaultOpen);
  const titleId = `${id}-title`;
  const hasSummary = summary !== undefined && summary !== null && summary !== false && summary !== "";

  return (
    <Collapsible.Root asChild open={open} onOpenChange={setOpen}>
      <section id={id} aria-labelledby={titleId} className="scroll-mt-4 rounded-card border border-line bg-surface">
        <h2>
          <Collapsible.Trigger className="group flex w-full items-center gap-3 rounded-card p-4 text-left data-[state=open]:pb-0">
            <span className={cn("flex size-7 shrink-0 items-center justify-center rounded-control [&_svg]:size-4", TINTS[tint])}>
              <Icon className="size-4" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="flex min-w-0 items-center gap-2">
                <span id={titleId} className="truncate text-[14px] font-semibold leading-5 text-ink">
                  {title}
                </span>
                {badge}
              </span>
              {!open && hasSummary && (
                <span className="mt-0.5 block truncate text-[13px] leading-5 text-secondary">{summary}</span>
              )}
            </span>
            <ChevronDown
              className="size-4 shrink-0 text-muted transition-[rotate,color] duration-[160ms] group-hover:text-body group-data-[state=open]:rotate-180"
              aria-hidden="true"
            />
          </Collapsible.Trigger>
        </h2>
        <Collapsible.Content className="px-4 pb-4 data-[state=open]:animate-[fade-in_160ms_cubic-bezier(0.2,0,0.38,0.9)]">
          <div className="space-y-4 pt-3">{children}</div>
        </Collapsible.Content>
      </section>
    </Collapsible.Root>
  );
}
