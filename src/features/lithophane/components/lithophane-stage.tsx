"use client";

import { useMemo, type RefObject } from "react";
import { Box, ImageIcon, Moon, RotateCcw, Spline, Upload } from "lucide-react";
import { useShallow } from "zustand/react/shallow";
import { Button, InlineAlert } from "@/components/ui";
import { StageFrame } from "@/components/studio";
import { ModelViewer, type CameraView, type ModelViewerHandle } from "@/components/viewer";
import { getPhotoPixels, MASK_ACCEPT, PHOTO_ACCEPT, type GrayMap } from "@/lib/image";
import { cn } from "@/lib/utils";
import { domainFor, stageSizeLabel } from "../model";
import { useLithophaneSession } from "../session";
import type { LithophaneSettings } from "../settings";
import { useLithophaneHistory, useLithophaneStore } from "../store";
import type { LithophanePreview } from "../use-lithophane-preview";
import { usePlaceTool } from "../use-place-tool";
import { CanvasSnapshot } from "./canvas-snapshot";
import { LayoutEditor } from "./layout-editor";
import { StageFooter } from "./stage-footer";
import { StageToolbar } from "./stage-toolbar";
import { StudioStatusBadge, type StudioStatus } from "./studio-status";

export interface LithophaneStageProps {
  preview: LithophanePreview;
  status: StudioStatus;
  viewerRef: RefObject<ModelViewerHandle | null>;
  onCamera: (view: CameraView) => void;
  onResetView: () => void;
  onToggle: (key: "wireframe" | "backlight") => void;
  onTogglePlacing: () => void;
  onChoosePhoto: () => void;
  onChooseMask: () => void;
}

/** Centre column: the 3D / layout / height-map stage with its toolbar, overlay chip, thumbnails and estimates. */
export function LithophaneStage({
  preview,
  status,
  viewerRef,
  onCamera,
  onResetView,
  onToggle,
  onTogglePlacing,
  onChoosePhoto,
  onChooseMask,
}: LithophaneStageProps) {
  const view = useLithophaneSession((state) => state.view);
  const hasPhoto = useLithophaneSession((state) => state.photo !== null);
  const placing = useLithophaneSession((state) => state.placing);
  const loadPhoto = useLithophaneSession((state) => state.loadPhoto);
  const loadMask = useLithophaneSession((state) => state.loadMask);
  const wireframe = useLithophaneStore((state) => state.settings.wireframe);
  const backlight = useLithophaneStore((state) => state.settings.backlight);
  const fallbackChip = useLithophaneStore((state) => stageSizeLabel(state.settings));
  const place = usePlaceTool();
  const wantsMask = preview.plan === "needs-mask";

  // While the moon texture loads, keep showing the last preview.
  const live = preview.plan === "ready" || preview.plan === "moon-loading";
  const mesh = preview.mesh;
  const failed = Boolean(preview.error) && !preview.pending;
  const viewerVisible = view === "model" && live && !failed;
  const placeActive = viewerVisible && placing && hasPhoto;
  const chipLabel = mesh?.sizeLabel ?? fallbackChip;

  // The layout editor carries its own hints and fills the stage.
  const overlay =
    live && view !== "layout" ? (
      <>
        <span className="rounded-chip border border-line bg-surface/90 px-2 py-1 font-mono text-[12px] leading-4 text-body tabular-nums">
          {chipLabel}
        </span>
        {view === "model" ? (
          <span className="text-[12px] leading-4 text-muted max-md:hidden [@media(hover:none)]:hidden">
            {placeActive ? "Drag the model to move the photo · Scroll to resize · Right-drag to rotate" : "Drag to rotate · Scroll to zoom"}
          </span>
        ) : (
          <span className="rounded-chip bg-surface/90 px-2 py-1 text-[12px] leading-4 text-secondary">Darker areas print thicker.</span>
        )}
      </>
    ) : undefined;

  return (
    <StageFrame
      title="Preview"
      status={<StudioStatusBadge status={status} />}
      toolbar={<StageToolbar onCamera={onCamera} onResetView={onResetView} onToggle={onToggle} onTogglePlacing={onTogglePlacing} />}
      overlay={overlay}
      footer={<StageFooter preview={preview} />}
      onFileDrop={(file) => void (wantsMask ? loadMask(file) : loadPhoto(file))}
      dropAccept={wantsMask ? MASK_ACCEPT : PHOTO_ACCEPT}
      dropLabel={wantsMask ? "Drop to use this mask" : "Drop to use this photo"}
    >
      {/* Kept mounted (hidden) while other content shows, so the camera keeps its place. */}
      {mesh && (
        <div className={cn("absolute inset-0", !viewerVisible && "invisible")} inert={!viewerVisible} aria-hidden={!viewerVisible || undefined}>
          <ModelViewer
            ref={viewerRef}
            parts={mesh.parts}
            fitKey={mesh.fitKey}
            appearance="lithophane"
            wireframe={wireframe}
            backlight={{ enabled: backlight, minThickness: mesh.wallRange.min, maxThickness: mesh.wallRange.max }}
            interactionMode={placeActive ? "place" : "orbit"}
            onPlace={place.onPlace}
            onPlaceWheel={place.onPlaceWheel}
            ariaLabel={`3D preview: ${mesh.sizeLabel}`}
            className="h-full w-full"
          />
        </div>
      )}
      <StageBody
        preview={preview}
        onChoosePhoto={onChoosePhoto}
        onChooseMask={onChooseMask}
        onUseMoon={() => useLithophaneStore.getState().set("moonBackground", true)}
      />
    </StageFrame>
  );
}

function Centered({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cn("relative flex flex-1 flex-col items-center justify-center p-6", className)}>{children}</div>;
}

function LoadingTile({ label, icon }: { label: string; icon: React.ReactNode }) {
  return (
    <Centered>
      <div role="status" className="flex flex-col items-center gap-3">
        <span
          aria-hidden="true"
          className="flex size-24 animate-[skeleton-pulse_1.4s_ease-in-out_infinite] items-center justify-center rounded-card border border-line bg-surface text-icon-muted [&_svg]:size-6"
        >
          {icon}
        </span>
        <span className="text-[13px] text-secondary">{label}</span>
      </div>
    </Centered>
  );
}

function StageBody({
  preview,
  onChoosePhoto,
  onChooseMask,
  onUseMoon,
}: {
  preview: LithophanePreview;
  onChoosePhoto: () => void;
  onChooseMask: () => void;
  onUseMoon: () => void;
}) {
  const view = useLithophaneSession((state) => state.view);
  const photoStatus = useLithophaneSession((state) => state.photoStatus);
  const photoError = useLithophaneSession((state) => state.photoError);
  const maskStatus = useLithophaneSession((state) => state.maskStatus);
  const maskError = useLithophaneSession((state) => state.maskError);
  const moonError = useLithophaneSession((state) => state.moonError);
  const retryMoon = useLithophaneSession((state) => state.retryMoon);

  switch (preview.plan) {
    case "empty":
      if (photoStatus === "loading") return <LoadingTile label="Opening photo…" icon={<ImageIcon />} />;
      return (
        <Centered className="text-center">
          <span className="mb-4 flex size-11 items-center justify-center rounded-card border border-line bg-sunken text-icon-muted">
            <ImageIcon className="size-5" aria-hidden="true" />
          </span>
          <h3 className="text-[14px] font-semibold leading-5 text-ink">Add a photo to start</h3>
          <p className="mt-1 max-w-sm text-[13px] leading-5 text-secondary">
            Drop a JPG, PNG or WebP anywhere here, or choose a file.
          </p>
          {photoStatus === "error" && photoError && (
            <InlineAlert tone="danger" className="mt-4 max-w-sm text-left">
              {photoError}
            </InlineAlert>
          )}
          <div className="mt-4 flex flex-wrap justify-center gap-2">
            <Button variant="secondary" size="sm" icon={<Upload aria-hidden="true" />} onClick={onChoosePhoto}>
              Choose photo
            </Button>
            <Button variant="ghost" size="sm" icon={<Moon aria-hidden="true" />} onClick={onUseMoon}>
              Use the moon texture
            </Button>
          </div>
        </Centered>
      );

    case "needs-mask":
      if (maskStatus === "loading") return <LoadingTile label="Opening mask…" icon={<Spline />} />;
      return (
        <Centered>
          <div className="w-full max-w-sm">
            {maskStatus === "error" && maskError ? (
              <InlineAlert
                tone="danger"
                title="This mask couldn't be used."
                action={
                  <Button variant="secondary" size="xs" icon={<Upload aria-hidden="true" />} onClick={onChooseMask}>
                    Choose another file
                  </Button>
                }
              >
                {maskError}
              </InlineAlert>
            ) : (
              <InlineAlert
                tone="warning"
                title="Add a mask to see your custom shape."
                action={
                  <Button variant="secondary" size="xs" icon={<Upload aria-hidden="true" />} onClick={onChooseMask}>
                    Add a mask
                  </Button>
                }
              >
                Use an SVG or PNG — white areas become the lamp. You can also drop it here.
              </InlineAlert>
            )}
          </div>
        </Centered>
      );

    case "moon-error":
      return (
        <Centered>
          <div className="w-full max-w-sm">
            <InlineAlert
              tone="danger"
              title="The moon texture didn't load."
              action={
                <>
                  <Button variant="secondary" size="xs" icon={<RotateCcw aria-hidden="true" />} onClick={retryMoon}>
                    Try again
                  </Button>
                  <Button variant="ghost" size="xs" onClick={() => useLithophaneStore.getState().set("moonBackground", false)}>
                    Turn off the moon texture
                  </Button>
                </>
              }
            >
              {moonError}
            </InlineAlert>
          </div>
        </Centered>
      );

    case "moon-loading":
    case "ready":
      break;
  }

  // The layout editor composes the image itself; it doesn't need the mesh (and shows its own skeleton
  // while the moon map loads).
  if (view === "layout") return <LayoutView />;

  if (preview.plan === "moon-loading" && !preview.mesh && !preview.images) {
    return <LoadingTile label="Loading the moon texture…" icon={<Moon />} />;
  }

  if (preview.error && !preview.pending) {
    return (
      <Centered>
        <div className="w-full max-w-sm">
          {preview.unprintable ? (
            <InlineAlert tone="warning" title="Nothing to print">
              {preview.error}
            </InlineAlert>
          ) : (
            <InlineAlert
              tone="danger"
              title="The preview couldn't be built."
              action={
                <Button variant="secondary" size="xs" icon={<RotateCcw aria-hidden="true" />} onClick={preview.retry}>
                  Try again
                </Button>
              }
            >
              {preview.error}
            </InlineAlert>
          )}
        </div>
      </Centered>
    );
  }

  if (view === "heightmap") {
    if (!preview.images) return <LoadingTile label="Building preview…" icon={<ImageIcon />} />;
    return (
      <div className="relative flex-1">
        <div className="absolute inset-x-4 bottom-12 top-4 flex items-center justify-center">
          <CanvasSnapshot
            source={preview.images.heightMap}
            label="Height map. Darker areas print thicker."
            className="h-full w-full object-contain"
          />
        </div>
      </div>
    );
  }

  return preview.mesh ? null : <LoadingTile label="Building preview…" icon={<Box />} />;
}

/** Stands in for the lunar map while the moon is switched off: the composition ignores it then. */
const UNUSED_MOON: GrayMap = { width: 1, height: 1, data: new Uint8Array([255]) };

type DomainSettings = Pick<
  LithophaneSettings,
  | "shape"
  | "width"
  | "height"
  | "sphereOpening"
  | "crescent"
  | "outerRadius"
  | "innerRadius"
  | "moonOffsetX"
  | "moonOffsetY"
  | "moonRotation"
  | "maskThreshold"
>;

function pickDomainSettings(s: LithophaneSettings): DomainSettings {
  const { shape, width, height, sphereOpening, crescent, outerRadius, innerRadius, moonOffsetX, moonOffsetY, moonRotation, maskThreshold } = s;
  return { shape, width, height, sphereOpening, crescent, outerRadius, innerRadius, moonOffsetX, moonOffsetY, moonRotation, maskThreshold };
}

/**
 * Layout view: the 2D editor for direct placement (FEATURE.md §3). Every change goes through the settings
 * store, and each gesture is one undo step.
 */
function LayoutView() {
  const settings = useLithophaneStore((state) => state.settings);
  const domainSettings = useLithophaneStore(useShallow((state) => pickDomainSettings(state.settings)));
  const setMany = useLithophaneStore((state) => state.setMany);
  const begin = useLithophaneHistory((state) => state.begin);
  const end = useLithophaneHistory((state) => state.end);
  const photo = useLithophaneSession((state) => state.photo);
  const mask = useLithophaneSession((state) => state.mask);
  const moon = useLithophaneSession((state) => state.moon);

  const maskField = domainSettings.shape === "custom" ? (mask?.mask ?? null) : null;
  // Stable while only the placement changes, so the editor doesn't redo shape work during a drag.
  const domain = useMemo(() => domainFor(domainSettings, maskField), [domainSettings, maskField]);
  const photoPixels = useMemo(() => (photo ? getPhotoPixels(photo) : null), [photo]);

  return (
    <LayoutEditor
      domain={domain}
      settings={settings}
      photo={photoPixels}
      moon={settings.moonBackground ? moon : (moon ?? UNUSED_MOON)}
      onChange={setMany}
      onGestureStart={begin}
      onGestureEnd={end}
      className="h-full w-full"
    />
  );
}
