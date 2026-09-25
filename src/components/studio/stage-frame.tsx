"use client";

import { useEffect, useState } from "react";
import { Upload, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { InlineAlert } from "@/components/ui/inline-alert";
import { acceptsFile, describeAccept, useFileDropTarget } from "@/components/ui/file-drop";

export interface StageFrameProps {
  title: string;
  /** Usually a StatusBadge; announced politely when it changes. */
  status?: React.ReactNode;
  /** Right-aligned controls; wraps under the title on narrow widths. */
  toolbar?: React.ReactNode;
  /** Pinned to the bottom of the stage; siblings are spread left/right. Non-interactive by default. */
  overlay?: React.ReactNode;
  /** Content under the stage, inside the card (thumbnails, metrics). */
  footer?: React.ReactNode;
  /** Makes the whole stage a drop target. */
  onFileDrop?: (f: File) => void;
  /** `accept`-style filter for dropped files (MIME types and/or extensions). */
  dropAccept?: string;
  /** Text shown while a file is dragged over the stage. */
  dropLabel?: string;
  /** Stage content. Fills the stage (flex column); give canvases `h-full w-full`. */
  children: React.ReactNode;
}

/** Card holding the 3D stage: header (title, status, toolbar), textured stage body, optional footer. */
export function StageFrame({
  title,
  status,
  toolbar,
  overlay,
  footer,
  onFileDrop,
  dropAccept = "",
  dropLabel = "Drop to open this file",
  children,
}: StageFrameProps) {
  const [rejected, setRejected] = useState<string | null>(null);
  const drop = useFileDropTarget((file) => {
    if (!onFileDrop) return;
    if (acceptsFile(file, dropAccept)) {
      setRejected(null);
      onFileDrop(file);
    } else {
      setRejected(`“${file.name}” can’t be used here. Drop ${describeAccept(dropAccept)}.`);
    }
  }, Boolean(onFileDrop));

  useEffect(() => {
    if (!rejected) return;
    const timer = window.setTimeout(() => setRejected(null), 6000);
    return () => window.clearTimeout(timer);
  }, [rejected]);

  return (
    <section
      aria-label={title}
      className="flex min-w-0 flex-col gap-3 rounded-card border border-line bg-surface p-3 lg:flex-1"
    >
      <header className="flex min-h-8 flex-wrap items-center gap-x-3 gap-y-2 pl-1">
        <div className="flex min-w-0 items-center gap-2.5">
          <h2 className="truncate text-[14px] font-semibold leading-5 text-ink">{title}</h2>
          <div role="status" aria-live="polite" className="flex min-w-0 items-center">
            {status}
          </div>
        </div>
        {toolbar && (
          <div className="ml-auto flex flex-wrap items-center justify-end gap-1 max-sm:ml-0 max-sm:w-full max-sm:justify-start">
            {toolbar}
          </div>
        )}
      </header>

      <div
        {...drop.handlers}
        className="tex-dots relative h-[56vh] min-h-[320px] overflow-hidden rounded-control bg-stage lg:h-auto lg:min-h-[280px] lg:flex-1"
      >
        <div className="absolute inset-0 flex flex-col">{children}</div>

        {overlay && (
          <div className="pointer-events-none absolute inset-x-3 bottom-3 flex items-end justify-between gap-2">{overlay}</div>
        )}

        {drop.dragging && (
          <div className="pointer-events-none absolute inset-2 z-10 flex items-center justify-center rounded-control border-2 border-dashed border-brand bg-brand-tint/95 transition-opacity duration-[120ms] starting:opacity-0">
            <span className="flex items-center gap-2 text-[13px] font-medium text-brand">
              <Upload className="size-4" aria-hidden="true" />
              {dropLabel}
            </span>
          </div>
        )}

        {rejected && (
          <div className="absolute inset-x-3 top-3 z-10">
            <InlineAlert
              tone="danger"
              className="shadow-e2"
              action={
                <button
                  type="button"
                  onClick={() => setRejected(null)}
                  className="inline-flex h-7 items-center gap-1 rounded-control px-2 text-[13px] font-medium text-secondary transition-colors duration-[120ms] hover:bg-surface-hover hover:text-body"
                >
                  <X className="size-3.5" aria-hidden="true" />
                  Dismiss
                </button>
              }
            >
              {rejected}
            </InlineAlert>
          </div>
        )}
      </div>

      {footer && <div className="min-w-0 px-1 pb-1">{footer}</div>}
    </section>
  );
}

export interface MetricItem {
  label: string;
  value: React.ReactNode;
  hint?: string;
}

// Container queries keep metric tiles legible wherever the grid is placed.
// In the two-column fallback an odd last tile spans the row instead of leaving a gap.
const METRIC_COLUMNS = {
  2: "grid-cols-2",
  3: "grid-cols-2 [&>:last-child:nth-child(odd)]:col-span-2 @[21rem]:grid-cols-3 @[21rem]:[&>:last-child:nth-child(odd)]:col-span-1",
  4: "grid-cols-2 @[30rem]:grid-cols-4",
} as const;

/** Compact metric tiles: 12px label, 15/600 tabular value, optional hint. */
export function MetricGrid({ items, columns = 3 }: { items: MetricItem[]; columns?: 2 | 3 | 4 }) {
  return (
    <div className="@container min-w-0">
      <dl className={cn("grid gap-2", METRIC_COLUMNS[columns])}>
        {items.map((item) => (
          <div key={item.label} className="min-w-0 rounded-control border border-line-subtle px-3 py-2">
            <dt className="text-[12px] leading-4 text-secondary">{item.label}</dt>
            <dd className="mt-0.5 truncate text-[15px] font-semibold leading-5 text-ink tabular-nums">{item.value}</dd>
            {item.hint && <dd className="mt-0.5 text-[12px] leading-4 text-secondary">{item.hint}</dd>}
          </div>
        ))}
      </dl>
    </div>
  );
}

/** Label/value rows separated by hairlines; values right-aligned and tabular. */
export function SpecList({ items }: { items: { label: string; value: React.ReactNode }[] }) {
  return (
    <dl className="divide-y divide-line-subtle text-[13px] leading-5">
      {items.map((item) => (
        <div key={item.label} className="flex items-center justify-between gap-4 py-2 first:pt-0 last:pb-0">
          <dt className="shrink-0 text-secondary">{item.label}</dt>
          <dd className="min-w-0 text-right font-medium text-body tabular-nums">{item.value}</dd>
        </div>
      ))}
    </dl>
  );
}
