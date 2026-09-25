"use client";

import { useEffect, useRef } from "react";
import { RotateCcw } from "lucide-react";
import { Button, InlineAlert, Skeleton } from "@/components/ui";
import type { KeychainOutline } from "../use-keychain-outline";

/** The stage's 2D view: the rasteriser's outline canvas, scaled to fit. */
export function OutlineView({ outline, label }: { outline: KeychainOutline; label: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const { canvas, error, retry } = outline;

  // Copy the off-screen raster into the mounted canvas (the raster itself is never mutated).
  useEffect(() => {
    const target = canvasRef.current;
    if (!target || !canvas) return;
    target.width = canvas.width;
    target.height = canvas.height;
    const ctx = target.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, target.width, target.height);
    ctx.drawImage(canvas, 0, 0);
  }, [canvas]);

  if (error && !canvas) {
    return (
      <div className="flex flex-1 items-center justify-center p-6">
        <InlineAlert
          tone="danger"
          title="Outline failed"
          className="max-w-sm"
          action={
            <Button size="sm" icon={<RotateCcw />} onClick={retry}>
              Try again
            </Button>
          }
        >
          {error}
        </InlineAlert>
      </div>
    );
  }

  if (!canvas) {
    return (
      <div role="status" className="flex flex-1 flex-col items-center justify-center gap-3 p-6">
        <Skeleton className="h-16 w-64 max-w-full rounded-card" />
        <span className="text-[13px] leading-5 text-secondary">Drawing the outline…</span>
      </div>
    );
  }

  return (
    <div className="relative flex min-h-0 flex-1 items-center justify-center px-6 pb-14 pt-6 sm:px-10 sm:pt-10">
      <canvas ref={canvasRef} role="img" aria-label={label} className="h-full w-full object-contain" />
      {error && (
        <div className="absolute inset-x-3 top-3">
          <InlineAlert
            tone="danger"
            title="Outline failed"
            action={
              <Button size="xs" icon={<RotateCcw />} onClick={retry}>
                Try again
              </Button>
            }
          >
            {error}
          </InlineAlert>
        </div>
      )}
    </div>
  );
}
