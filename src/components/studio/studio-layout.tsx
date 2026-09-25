import { cn } from "@/lib/utils";

export interface StudioLayoutProps {
  inspector: React.ReactNode;
  stage: React.ReactNode;
  /** Pass the panels as siblings (a fragment) so they can flow into the responsive grid. */
  aside: React.ReactNode;
  /** Sticky bottom bar shown below 1024px (e.g. the export button + status). */
  mobileAction?: React.ReactNode;
}

/**
 * Full-height studio workspace below the 56px top bar. Renders the page's <main> landmark.
 *
 * - ≥1280: [inspector 320 | stage | aside 304], each column scrolls on its own.
 * - 1024–1279: [inspector 300 | stage above a two-column aside], main column scrolls.
 * - <1024: stage → aside → inspector in one column, plus the sticky `mobileAction` bar.
 */
export function StudioLayout({ inspector, stage, aside, mobileAction }: StudioLayoutProps) {
  return (
    <main
      id="main"
      className={cn(
        "flex min-w-0 flex-1 flex-col",
        "lg:grid lg:h-[calc(100dvh-56px)] lg:flex-none lg:grid-cols-[300px_minmax(0,1fr)] lg:grid-rows-[minmax(0,1fr)] lg:overflow-hidden",
        "xl:grid-cols-[320px_minmax(0,1fr)_304px]",
      )}
    >
      <section
        aria-label="Settings"
        className="order-3 min-w-0 border-t border-line bg-sunken p-4 lg:order-none lg:min-h-0 lg:overflow-y-auto lg:overscroll-contain lg:border-r lg:border-t-0"
      >
        <div className="space-y-3">{inspector}</div>
      </section>

      {/* One scrolling column at 1024–1279; dissolves into two grid columns at ≥1280 and into the flow below 1024. */}
      <div className="contents lg:flex lg:min-h-0 lg:min-w-0 lg:flex-col lg:overflow-y-auto lg:overscroll-contain xl:contents">
        <section
          aria-label="Preview"
          className="order-1 flex min-w-0 flex-col p-4 pb-0 lg:order-none lg:min-h-[max(440px,calc(100dvh-56px-176px))] lg:shrink-0 xl:min-h-0 xl:overflow-y-auto xl:pb-4"
        >
          {stage}
        </section>
        <aside
          aria-label="Export and project"
          className="order-2 grid min-w-0 content-start gap-3 p-4 md:grid-cols-2 lg:order-none xl:min-h-0 xl:grid-cols-1 xl:overflow-y-auto xl:overscroll-contain xl:border-l xl:border-line xl:bg-sunken"
        >
          {aside}
        </aside>
      </div>

      {mobileAction && (
        <div className="sticky bottom-0 z-20 order-4 border-t border-line bg-surface px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] lg:hidden">
          {mobileAction}
        </div>
      )}
    </main>
  );
}

export interface PanelProps {
  title?: string;
  description?: string;
  actions?: React.ReactNode;
  className?: string;
  children: React.ReactNode;
}

/** Bordered card for aside content (dense padding; pass `className="p-5"` for roomy layouts). */
export function Panel({ title, description, actions, className, children }: PanelProps) {
  return (
    <section aria-label={title} className={cn("min-w-0 rounded-card border border-line bg-surface p-4", className)}>
      {(title || actions) && (
        <header className="mb-3 flex items-start justify-between gap-3">
          <div className="min-w-0">
            {title && <h2 className="text-[14px] font-semibold leading-5 text-ink">{title}</h2>}
            {description && <p className="mt-0.5 text-[13px] leading-5 text-secondary">{description}</p>}
          </div>
          {actions && <div className="flex shrink-0 items-center gap-1">{actions}</div>}
        </header>
      )}
      {children}
    </section>
  );
}
