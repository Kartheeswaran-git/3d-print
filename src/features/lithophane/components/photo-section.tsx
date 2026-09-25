"use client";

import { ImageIcon, ImagePlus, Replace, Trash2 } from "lucide-react";
import { Button, FileDrop, InlineAlert, InspectorSection, Skeleton } from "@/components/ui";
import { PHOTO_ACCEPT } from "@/lib/image";
import { useLithophaneSession } from "../session";
import { useLithophaneStore } from "../store";
import { CanvasSnapshot } from "./canvas-snapshot";

/** Photo: drop zone, or the loaded file with Replace / Remove. */
export function PhotoSection({ onChoosePhoto }: { onChoosePhoto: () => void }) {
  const photo = useLithophaneSession((state) => state.photo);
  const status = useLithophaneSession((state) => state.photoStatus);
  const error = useLithophaneSession((state) => state.photoError);
  const loadPhoto = useLithophaneSession((state) => state.loadPhoto);
  const removePhoto = useLithophaneSession((state) => state.removePhoto);
  const moonBackground = useLithophaneStore((state) => state.settings.moonBackground);

  const summary = photo?.name ?? (moonBackground ? "Moon texture only" : "No photo");

  return (
    <InspectorSection id="lamp-photo" title="Photo" icon={ImageIcon} tint="product" defaultOpen summary={summary}>
      {status === "loading" ? (
        <div role="status" className="flex items-center gap-3">
          <Skeleton className="size-12 shrink-0 rounded-control" />
          <div className="min-w-0 flex-1 space-y-2">
            <Skeleton className="h-2 w-3/4" />
            <Skeleton className="h-2 w-1/2" />
          </div>
          <span className="sr-only">Opening photo…</span>
        </div>
      ) : photo ? (
        <div className="flex items-start gap-3">
          <CanvasSnapshot
            source={photo.canvas}
            maxSize={96}
            className="size-12 shrink-0 rounded-control border border-line bg-sunken object-cover"
          />
          <div className="min-w-0 flex-1">
            <p className="truncate text-[13px] font-medium leading-5 text-ink" title={photo.name}>
              {photo.name}
            </p>
            <p className="font-mono text-[12px] leading-4 text-secondary tabular-nums">
              {photo.originalWidth} × {photo.originalHeight} px · on device
            </p>
            <div className="-ml-2.5 mt-1.5 flex flex-wrap gap-1">
              <Button variant="ghost" size="xs" icon={<Replace aria-hidden="true" />} onClick={onChoosePhoto}>
                Replace
              </Button>
              <Button variant="danger-ghost" size="xs" icon={<Trash2 aria-hidden="true" />} onClick={removePhoto}>
                Remove
              </Button>
            </div>
          </div>
        </div>
      ) : (
        <FileDrop
          accept={PHOTO_ACCEPT}
          onFile={(file) => void loadPhoto(file)}
          title="Add a photo"
          description="Drop a JPG, PNG or WebP, or click to browse. Up to 25 MB."
          icon={<ImagePlus />}
        />
      )}

      {status === "error" && error && (
        <InlineAlert
          tone="danger"
          action={
            <Button variant="ghost" size="xs" className="-ml-2.5" onClick={onChoosePhoto}>
              Choose another file
            </Button>
          }
        >
          {error}
        </InlineAlert>
      )}

      {!photo && status !== "loading" && (
        <p className="text-[13px] leading-5 text-secondary">No photo? The moon texture alone makes a lovely lamp.</p>
      )}
    </InspectorSection>
  );
}
