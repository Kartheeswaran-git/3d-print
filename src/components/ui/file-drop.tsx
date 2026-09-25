"use client";

import { useCallback, useId, useRef, useState } from "react";
import { CircleAlert, LoaderCircle, Upload } from "lucide-react";
import { cn } from "@/lib/utils";

/** Known extensions for MIME types, so files with an empty or odd `type` are still recognised (FIXES L16). */
const MIME_EXTENSIONS: Record<string, string[]> = {
  "image/jpeg": [".jpg", ".jpeg", ".jfif", ".pjpeg", ".pjp"],
  "image/png": [".png"],
  "image/webp": [".webp"],
  "image/svg+xml": [".svg"],
  "image/gif": [".gif"],
  "image/avif": [".avif"],
  "application/json": [".json"],
  "model/stl": [".stl"],
};

const MIME_LABELS: Record<string, string> = {
  "image/jpeg": "JPG",
  "image/png": "PNG",
  "image/webp": "WebP",
  "image/svg+xml": "SVG",
  "image/gif": "GIF",
  "image/avif": "AVIF",
  "application/json": "JSON",
  "model/stl": "STL",
};

function acceptTokens(accept: string): string[] {
  return accept
    .split(",")
    .map((t) => t.trim().toLowerCase())
    .filter(Boolean);
}

/** True when `file` matches an `accept` string by MIME type OR by extension. Empty `accept` accepts all. */
export function acceptsFile(file: File, accept: string): boolean {
  const tokens = acceptTokens(accept);
  if (tokens.length === 0) return true;
  const type = file.type.toLowerCase();
  const name = file.name.toLowerCase();
  return tokens.some((token) => {
    if (token.startsWith(".")) return name.endsWith(token);
    if (token.endsWith("/*")) return type.startsWith(token.slice(0, -1));
    if (type === token) return true;
    return (MIME_EXTENSIONS[token] ?? []).some((ext) => name.endsWith(ext));
  });
}

/** Human list of accepted formats, e.g. "a JPG, PNG or WebP file". */
export function describeAccept(accept: string): string {
  const labels = [
    ...new Set(
      acceptTokens(accept).map((t) => MIME_LABELS[t] ?? (t.startsWith(".") ? t.slice(1).toUpperCase() : t.replace(/\/\*$/, ""))),
    ),
  ];
  if (labels.length === 0) return "a file";
  const list = labels.length === 1 ? labels[0] : `${labels.slice(0, -1).join(", ")} or ${labels[labels.length - 1]}`;
  return `a ${list} file`;
}

/** `accept` attribute with extension equivalents added (helps pickers that filter by extension). */
function acceptAttribute(accept: string): string {
  const tokens = acceptTokens(accept);
  const extras = tokens.flatMap((t) => MIME_EXTENSIONS[t] ?? []);
  return [...new Set([...tokens, ...extras])].join(",");
}

function hasFiles(e: React.DragEvent): boolean {
  return Array.from(e.dataTransfer.types).includes("Files");
}

/**
 * Hidden file input + `open()` to show the picker. Picked files that don't match `accept` go to
 * `onReject` when given; otherwise they are passed to `onFile` so the loader can explain the problem.
 */
export function useFilePicker(
  accept: string,
  onFile: (f: File) => void,
  onReject?: (f: File) => void,
): { open: () => void; input: React.ReactElement } {
  const inputRef = useRef<HTMLInputElement>(null);
  const open = useCallback(() => inputRef.current?.click(), []);
  const input = (
    <input
      ref={inputRef}
      type="file"
      accept={acceptAttribute(accept)}
      tabIndex={-1}
      aria-hidden="true"
      className="sr-only"
      onChange={(e) => {
        const file = e.target.files?.[0];
        // Reset so choosing the same file again still fires `change`.
        e.target.value = "";
        if (!file) return;
        if (!onReject || acceptsFile(file, accept)) onFile(file);
        else onReject(file);
      }}
    />
  );
  return { open, input };
}

/**
 * Tracks file drags over an element with a depth counter so child elements don't cause flicker (FIXES L10).
 * Returns the dragging flag and handlers to spread on the drop target.
 */
export function useFileDropTarget(onDropFile: (f: File) => void, enabled = true) {
  const [dragging, setDragging] = useState(false);
  const depth = useRef(0);

  const handlers = {
    onDragEnter: (e: React.DragEvent) => {
      if (!enabled || !hasFiles(e)) return;
      e.preventDefault();
      depth.current += 1;
      setDragging(true);
    },
    onDragOver: (e: React.DragEvent) => {
      if (!enabled || !hasFiles(e)) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = "copy";
    },
    onDragLeave: (e: React.DragEvent) => {
      if (!enabled || !hasFiles(e)) return;
      depth.current = Math.max(0, depth.current - 1);
      if (depth.current === 0) setDragging(false);
    },
    onDrop: (e: React.DragEvent) => {
      if (!enabled || !hasFiles(e)) return;
      e.preventDefault();
      depth.current = 0;
      setDragging(false);
      const file = e.dataTransfer.files[0];
      if (file) onDropFile(file);
    },
  };
  return { dragging: enabled && dragging, handlers };
}

export interface FileDropProps {
  accept: string;
  onFile: (f: File) => void;
  title: string;
  description: string;
  icon?: React.ReactNode;
  busy?: boolean;
  className?: string;
  /** Single-row layout for tight spaces. */
  compact?: boolean;
}

/** Dashed drop zone that also opens the file picker (click, Enter or Space). */
export function FileDrop({ accept, onFile, title, description, icon, busy = false, className, compact = false }: FileDropProps) {
  const errorId = useId();
  const [error, setError] = useState<string | null>(null);

  const accepted = (file: File) => {
    setError(null);
    onFile(file);
  };
  const rejected = (file: File) => setError(`“${file.name}” can’t be used here. Choose ${describeAccept(accept)}.`);
  const handle = (file: File) => (acceptsFile(file, accept) ? accepted(file) : rejected(file));

  const picker = useFilePicker(accept, accepted, rejected);
  const drop = useFileDropTarget(handle, !busy);

  return (
    <div className={cn("space-y-2", className)}>
      <button
        type="button"
        onClick={picker.open}
        disabled={busy}
        aria-busy={busy || undefined}
        aria-describedby={error ? errorId : undefined}
        {...drop.handlers}
        className={cn(
          "tex-dots group flex w-full rounded-card border border-dashed transition-colors duration-[120ms]",
          compact ? "items-center gap-3 px-3 py-3 text-left" : "flex-col items-center px-4 py-7 text-center",
          drop.dragging
            ? "border-brand bg-brand-tint"
            : "border-line-strong bg-surface hover:border-icon-muted hover:bg-sunken",
          "disabled:cursor-progress disabled:opacity-80",
        )}
      >
        <span
          className={cn(
            "flex shrink-0 items-center justify-center rounded-card border bg-surface [&_svg]:size-5",
            compact ? "size-9" : "mb-3 size-10",
            drop.dragging ? "border-brand-200 text-brand" : "border-line text-secondary",
          )}
          aria-hidden="true"
        >
          {busy ? <LoaderCircle className="animate-spin" /> : (icon ?? <Upload />)}
        </span>
        <span className="min-w-0">
          <span className="block text-[13px] font-semibold leading-5 text-ink">{title}</span>
          <span className="mt-0.5 block text-[12px] leading-4 text-secondary">{description}</span>
        </span>
      </button>
      {picker.input}
      {error && (
        <p id={errorId} role="alert" className="flex items-start gap-1.5 text-[12px] leading-4 text-danger">
          <CircleAlert className="mt-px size-3.5 shrink-0" aria-hidden="true" />
          <span className="min-w-0 [overflow-wrap:anywhere]">{error}</span>
        </p>
      )}
    </div>
  );
}
