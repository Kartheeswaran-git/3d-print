"use client";

import { useEffect, useRef } from "react";

export interface CanvasSnapshotProps {
  /** Offscreen canvas to show (never mutated). */
  source: HTMLCanvasElement;
  /** Longest side of the copy in pixels; larger sources are downscaled once. */
  maxSize?: number;
  /** Accessible description; omit for decorative copies. */
  label?: string;
  className?: string;
}

/** Shows a copy of an offscreen canvas. Size it with CSS (`object-contain` / `object-cover` work on canvas). */
export function CanvasSnapshot({ source, maxSize = Infinity, label, className }: CanvasSnapshotProps) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas || source.width < 1 || source.height < 1) return;
    const scale = Math.min(1, maxSize / Math.max(source.width, source.height));
    const width = Math.max(1, Math.round(source.width * scale));
    const height = Math.max(1, Math.round(source.height * scale));
    if (canvas.width !== width) canvas.width = width;
    if (canvas.height !== height) canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, width, height);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(source, 0, 0, width, height);
  }, [source, maxSize]);

  return (
    <canvas
      ref={ref}
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      className={className}
    />
  );
}
