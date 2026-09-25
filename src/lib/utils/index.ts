import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/** Merge Tailwind class names, letting later utilities win. */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function clamp(n: number, min = 0, max = 1): number {
  return Math.min(max, Math.max(min, n));
}

/** Snap a value to the nearest multiple of `step` (anchored at `min`) and clamp it. */
export function snap(n: number, min: number, max: number, step: number): number {
  if (!Number.isFinite(n)) return min;
  const snapped = Math.round((n - min) / step) * step + min;
  // Remove float noise such as 0.30000000000000004.
  const decimals = Math.max(0, (String(step).split(".")[1] ?? "").length);
  return clamp(Number(snapped.toFixed(decimals)), min, max);
}

/** Make a string safe for use as a download filename (no extension). */
export function safeFileName(input: string, fallback = "model"): string {
  const cleaned = input
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/\.[^.]+$/, "")
    .replace(/[^a-z0-9_-]+/gi, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  return cleaned || fallback;
}

/** Trigger a browser download for in-memory data and release the object URL afterwards. */
export function downloadBlob(data: Blob | ArrayBuffer, fileName: string, mime = "application/octet-stream") {
  const blob = data instanceof Blob ? data : new Blob([data], { type: mime });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  link.rel = "noopener";
  link.style.display = "none";
  document.body.appendChild(link);
  link.click();
  link.remove();
  // Revoking synchronously can cancel the download in some browsers.
  window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

const compact = new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 });
const grouped = new Intl.NumberFormat("en");

export function formatCount(n: number, mode: "compact" | "full" = "compact"): string {
  if (!Number.isFinite(n)) return "—";
  return mode === "compact" ? compact.format(n) : grouped.format(Math.round(n));
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export function formatMm(n: number, digits = 1): string {
  return `${n.toFixed(digits)} mm`;
}
