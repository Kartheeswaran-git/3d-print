"use client";

import { Tooltip } from "radix-ui";
import { ToastProvider } from "@/components/ui/toast";

/** App-wide client providers: tooltip timing and toasts. */
export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <Tooltip.Provider delayDuration={300} skipDelayDuration={200}>
      <ToastProvider>{children}</ToastProvider>
    </Tooltip.Provider>
  );
}
