"use client";

import { createContext, useCallback, useContext, useMemo, useRef, useState } from "react";
import { Toast as ToastPrimitive } from "radix-ui";
import { CircleAlert, CircleCheck, Info, X } from "lucide-react";
import { cn } from "@/lib/utils";

export type ToastTone = "success" | "info" | "danger";

export interface ToastApi {
  /** Show a short, transient confirmation ("Settings saved"). Failures belong in inline alerts. */
  toast: (message: string, opts?: { tone?: ToastTone }) => void;
}

interface ToastItem {
  id: number;
  message: string;
  tone: ToastTone;
}

const ToastContext = createContext<ToastApi | null>(null);

const TONE_ICON = {
  success: { Icon: CircleCheck, className: "text-success" },
  info: { Icon: Info, className: "text-info" },
  danger: { Icon: CircleAlert, className: "text-danger" },
} as const;

/** Keep at most this many toasts on screen; older ones make way. */
const MAX_VISIBLE = 3;

/** Bottom-centre toasts (3.2 s, polite live region, swipe down or Esc to dismiss). */
export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const nextId = useRef(0);

  const toast = useCallback<ToastApi["toast"]>((message, opts) => {
    nextId.current += 1;
    const item: ToastItem = { id: nextId.current, message, tone: opts?.tone ?? "success" };
    setItems((prev) => [...prev.slice(-(MAX_VISIBLE - 1)), item]);
  }, []);

  const dismiss = useCallback((id: number) => setItems((prev) => prev.filter((t) => t.id !== id)), []);
  const api = useMemo(() => ({ toast }), [toast]);

  return (
    <ToastPrimitive.Provider duration={3200} swipeDirection="down" label="Notification">
      <ToastContext.Provider value={api}>{children}</ToastContext.Provider>
      {items.map((t) => {
        const { Icon, className } = TONE_ICON[t.tone];
        return (
          <ToastPrimitive.Root
            key={t.id}
            type="background"
            onOpenChange={(open) => {
              if (!open) dismiss(t.id);
            }}
            className={cn(
              "flex items-center gap-2.5 rounded-card border border-line bg-surface py-2 pl-3 pr-1.5 shadow-e2",
              "transition-[opacity,translate] duration-[160ms] ease-[cubic-bezier(0.2,0,0.38,0.9)] starting:translate-y-0.5 starting:opacity-0",
              "data-[swipe=move]:translate-y-[var(--radix-toast-swipe-move-y)] data-[swipe=move]:transition-none",
              "data-[swipe=cancel]:translate-y-0 data-[swipe=end]:translate-y-[var(--radix-toast-swipe-end-y)] data-[swipe=end]:opacity-0",
            )}
          >
            <Icon className={cn("size-4 shrink-0", className)} aria-hidden="true" />
            <ToastPrimitive.Description className="min-w-0 flex-1 text-[13px] leading-5 text-body">{t.message}</ToastPrimitive.Description>
            <ToastPrimitive.Close
              aria-label="Dismiss notification"
              className="inline-flex size-7 shrink-0 items-center justify-center rounded-control text-muted transition-colors duration-[120ms] hover:bg-surface-hover hover:text-body"
            >
              <X className="size-3.5" aria-hidden="true" />
            </ToastPrimitive.Close>
          </ToastPrimitive.Root>
        );
      })}
      <ToastPrimitive.Viewport className="fixed bottom-[calc(5.5rem+env(safe-area-inset-bottom))] left-1/2 z-[80] m-0 flex w-[min(calc(100vw-2rem),380px)] -translate-x-1/2 list-none flex-col gap-2 p-0 lg:bottom-6" />
    </ToastPrimitive.Provider>
  );
}

/** Access the toast API. Must be used inside <ToastProvider> (see `app/providers.tsx`). */
export function useToast(): ToastApi {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used inside <ToastProvider>.");
  return ctx;
}
