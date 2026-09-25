"use client";

import {
  useEffect,
  useEffectEvent,
  useId,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
} from "react";
import { Skeleton } from "@/components/ui";
import { useSettledValue } from "@/components/ui/use-settled-value";
import type { GrayMap } from "@/lib/image/moon";
import { photoOutline, type Domain, type PhotoPixels, type ProjectionSettings } from "@/lib/image/project";
import { cn } from "@/lib/utils";
import { shapeOutline } from "../editor/contour";
import {
  CORNERS,
  cursorFor,
  describeLayout,
  diffPatch,
  dragPatch,
  editorView,
  HANDLE_SIZE,
  HIT_RADIUS,
  hitTest,
  keyPatch,
  layoutHint,
  layoutKeyboardHelp,
  loopsPath,
  moonDisc,
  outlinePaths,
  photoAspectFor,
  photoGeometry,
  pinchPatch,
  ROTATE_HANDLE_RADIUS,
  sameDomain,
  samePatch,
  snapSetting,
  wheelScale,
  wheelZoomFactor,
  type DragStart,
  type EditorTarget,
  type EditorView,
  type HitScene,
  type LayoutPatch,
  type PinchStart,
  type Point,
  type Size,
} from "../editor/geometry";
import { rasterSize, renderEditorRaster } from "../editor/raster";
import type { LithophaneSettings } from "../settings";

export interface LayoutEditorProps {
  /** From @/lib/image/project. */
  domain: Domain;
  settings: LithophaneSettings;
  /** Null → only moon turning is possible. */
  photo: PhotoPixels | null;
  /** Null while loading → a skeleton is shown. */
  moon: GrayMap | null;
  /** imageX, imageY, imageScale, rotation, moonLongitude. */
  onChange: (patch: Partial<LithophaneSettings>) => void;
  /** history.begin() */
  onGestureStart: () => void;
  /** history.end() */
  onGestureEnd: () => void;
  className?: string;
}

/** Points per photo edge on the sphere (the decal's outline curves); flat photos are plain rectangles. */
const SPHERE_OUTLINE_SAMPLES = 24;
/** Wheel and key presses closer together than this form one gesture (one undo step). */
const BURST_IDLE_MS = 400;
/** Changes closer together than this are "streaming" (a drag): draw drafts, then a full image. */
const STREAM_MS = 120;
/** A full image follows this long after the last draft. */
const SETTLE_MS = 140;
/** Draft only when a full image takes longer than this (ms). */
const DRAFT_BUDGET_MS = 14;
/** Draft images have this fraction of the full resolution per side. */
const DRAFT_QUALITY = 0.5;
/** The live description waits for the layout to settle before it's announced. */
const LIVE_SETTLE_MS = 500;

interface PointerGesture {
  /** The pointer that started the gesture. */
  primary: number;
  /** What the primary pointer drags; null once a pinch ends (waits for every finger to lift). */
  target: EditorTarget | null;
  start: DragStart;
  /** Every pointer taking part, with its latest position. */
  pointers: Map<number, Point>;
  pinch: (PinchStart & { ids: [number, number] }) | null;
  /** Last values sent, so repeated positions don't resend them. */
  last: LayoutPatch | null;
}

/** Wheel or keyboard edits in quick succession: one undo step. */
interface Burst {
  timer: number;
  /** Unrounded wheel size, so small trackpad steps add up. */
  scale: number | null;
  /** Last size sent by the wheel. */
  sent: number | null;
}

/**
 * Layout view (FEATURE.md §3): the composite in colour — the flat piece with everything outside the shape
 * dimmed, or the sphere's front view with the bottom opening hatched — plus the photo's outline and
 * move / scale / rotate handles. Dragging beside the photo (or anywhere without one) turns the moon.
 * Every gesture is one onGestureStart / onGestureEnd pair; all changes go through onChange.
 */
export function LayoutEditor({
  domain,
  settings,
  photo,
  moon,
  onChange,
  onGestureStart,
  onGestureEnd,
  className,
}: LayoutEditorProps): React.JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const gestureRef = useRef<PointerGesture | null>(null);
  const burstRef = useRef<Burst | null>(null);
  const helpId = useId();
  const size = useElementSize(containerRef);
  const dpr = useSyncExternalStore(subscribeToResize, readDevicePixelRatio, serverDevicePixelRatio);
  const piece = useStableDomain(domain);
  const view = useMemo(() => (size ? editorView(piece, size) : null), [piece, size]);

  const {
    imageScale,
    imageX,
    imageY,
    rotation,
    edgeBlend,
    moonBackground,
    cropRatio,
    cropScale,
    cropX,
    cropY,
    moonLongitude,
    moonRotation,
  } = settings;
  const projection = useMemo<ProjectionSettings>(
    () => ({
      imageScale,
      imageX,
      imageY,
      rotation,
      edgeBlend,
      moonBackground,
      cropRatio,
      cropScale,
      cropX,
      cropY,
      moonLongitude,
      moonRotation,
    }),
    [imageScale, imageX, imageY, rotation, edgeBlend, moonBackground, cropRatio, cropScale, cropX, cropY, moonLongitude, moonRotation],
  );

  const loading = moonBackground && moon === null;
  const moonOn = moonBackground && moon !== null;
  const aspect = photoAspectFor(piece, projection, photo);
  const hasPhoto = aspect !== null;
  const geometry = view && aspect !== null ? photoGeometry(view, projection, aspect) : null;
  const photoOnBack = geometry !== null && !geometry.centre.visible;
  const scene: HitScene | null = view && !loading ? { view, settings: projection, aspect, geometry, moonOn } : null;

  const loops = useMemo(
    () => (piece.kind === "flat" ? shapeOutline(piece.widthMm, piece.heightMm, piece.shape) : null),
    [piece],
  );
  const shapePath = useMemo(() => (view?.kind === "flat" && loops ? loopsPath(view, loops) : ""), [view, loops]);
  const outline =
    view && aspect !== null
      ? outlinePaths(view, photoOutline(piece, projection, aspect, view.kind === "sphere" ? SPHERE_OUTLINE_SAMPLES : 1))
      : null;

  const paintInput = useMemo(
    () => (view && !loading ? { view, domain: piece, settings: projection, photo, moon, dpr } : null),
    [view, loading, piece, projection, photo, moon, dpr],
  );
  useCanvasPainter(canvasRef, paintInput);

  const [hover, setHover] = useState<EditorTarget | null>(null);
  const [active, setActive] = useState<EditorTarget | null>(null);

  const status = { hasPhoto, moonOn, photoOnBack };
  const hint = loading ? "Loading the moon texture…" : layoutHint(status);
  const help = `Photo layout editor. ${layoutKeyboardHelp(status)}`;
  const liveText = useSettledValue(loading ? "Loading the moon texture." : describeLayout(piece, settings, status), LIVE_SETTLE_MS);

  // ── Gestures ─────────────────────────────────────────────────────────────────────────────────

  const hitRadius = (pointerType: string) => (pointerType === "mouse" ? HIT_RADIUS.fine : HIT_RADIUS.coarse);

  const localPoint = (event: { clientX: number; clientY: number }): Point => {
    const rect = containerRef.current?.getBoundingClientRect();
    return rect ? { x: event.clientX - rect.left, y: event.clientY - rect.top } : { x: event.clientX, y: event.clientY };
  };

  const endBurst = () => {
    const burst = burstRef.current;
    if (!burst) return;
    window.clearTimeout(burst.timer);
    burstRef.current = null;
    onGestureEnd();
  };

  /** Open (or extend) the wheel/keyboard gesture; it closes after a short pause. */
  const continueBurst = (): Burst => {
    let burst = burstRef.current;
    if (!burst) {
      onGestureStart();
      burst = { timer: 0, scale: null, sent: null };
      burstRef.current = burst;
    }
    window.clearTimeout(burst.timer);
    burst.timer = window.setTimeout(endBurst, BURST_IDLE_MS);
    return burst;
  };

  const send = (gesture: PointerGesture, patch: LayoutPatch) => {
    if (gesture.last ? samePatch(gesture.last, patch) : diffPatch(gesture.start.settings, patch) === null) return;
    gesture.last = patch;
    onChange(patch);
  };

  const finishGesture = () => {
    const gesture = gestureRef.current;
    if (!gesture) return;
    gestureRef.current = null;
    const container = containerRef.current;
    for (const id of gesture.pointers.keys()) {
      if (container?.hasPointerCapture(id)) container.releasePointerCapture(id);
    }
    setActive(null);
    onGestureEnd();
  };

  const dragTo = (gesture: PointerGesture, p: Point, shift: boolean) => {
    if (!view || !gesture.target) return;
    send(gesture, dragPatch(view, moonDisc(view, piece, moonRotation), gesture.start, p, shift));
  };

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!scene) return;
    const container = event.currentTarget;
    const p = localPoint(event);
    const gesture = gestureRef.current;
    if (gesture) {
      // A second finger turns a touch drag into a pinch: resize and rotate the photo.
      if (event.pointerType === "touch" && hasPhoto && gesture.pointers.size === 1 && !gesture.pointers.has(event.pointerId)) {
        container.setPointerCapture(event.pointerId);
        const [firstId, first] = [...gesture.pointers.entries()][0];
        gesture.pointers.set(event.pointerId, p);
        const current = { ...gesture.start.settings, ...gesture.last };
        gesture.pinch = { ids: [firstId, event.pointerId], a: first, b: p, imageScale: current.imageScale, rotation: current.rotation };
        gesture.target = null;
      }
      return;
    }
    if (event.button !== 0) return;
    const target = hitTest(scene, p, hitRadius(event.pointerType));
    if (!target) return;
    // The press lands on the editor itself (its layers ignore the pointer), so the browser focuses it for
    // the keyboard without a focus ring; `touch-none` and `select-none` stop scrolling and selection.
    endBurst();
    container.setPointerCapture(event.pointerId);
    onGestureStart();
    gestureRef.current = {
      primary: event.pointerId,
      target,
      start: {
        target,
        pointer: p,
        centre: geometry?.centre.at ?? p,
        settings: { imageScale, imageX, imageY, rotation, moonLongitude },
      },
      pointers: new Map([[event.pointerId, p]]),
      pinch: null,
      last: null,
    };
    setActive(target);
    setHover(target);
  };

  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const gesture = gestureRef.current;
    const p = localPoint(event);
    if (!gesture) {
      if (event.pointerType === "touch" || !scene) return;
      const target = hitTest(scene, p, hitRadius(event.pointerType));
      if (target !== hover) setHover(target);
      return;
    }
    if (!gesture.pointers.has(event.pointerId)) return;
    gesture.pointers.set(event.pointerId, p);
    const pinch = gesture.pinch;
    if (pinch) {
      const a = gesture.pointers.get(pinch.ids[0]);
      const b = gesture.pointers.get(pinch.ids[1]);
      if (a && b) send(gesture, pinchPatch(pinch, a, b));
      return;
    }
    if (event.pointerId === gesture.primary) dragTo(gesture, p, event.shiftKey);
  };

  const onPointerEnd = (event: ReactPointerEvent<HTMLDivElement>) => {
    const gesture = gestureRef.current;
    if (!gesture || !gesture.pointers.has(event.pointerId)) return;
    if (event.type === "pointerup" && event.pointerId === gesture.primary && !gesture.pinch) {
      dragTo(gesture, localPoint(event), event.shiftKey);
    }
    gesture.pointers.delete(event.pointerId);
    const container = event.currentTarget;
    if (container.hasPointerCapture(event.pointerId)) container.releasePointerCapture(event.pointerId);
    if (gesture.pinch?.ids.includes(event.pointerId)) gesture.pinch = null;
    if (event.pointerId === gesture.primary) gesture.target = null;
    if (gesture.pointers.size > 0) return;
    finishGesture();
    if (event.pointerType !== "touch" && event.type === "pointerup" && scene) {
      setHover(hitTest(scene, localPoint(event), hitRadius(event.pointerType)));
    }
  };

  const onPointerLeave = () => {
    if (!gestureRef.current) setHover(null);
  };

  const onKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.target !== event.currentTarget || event.metaKey || event.ctrlKey || event.altKey || event.nativeEvent.isComposing) return;
    const gesture = gestureRef.current;
    if (gesture) {
      if (event.key === "Escape") {
        // Cancel the drag: put the values back, so its undo step ends where it began and is dropped.
        event.preventDefault();
        const restore = diffPatch({ ...gesture.start.settings, ...gesture.last }, gesture.start.settings);
        if (restore) onChange(restore);
        finishGesture();
      }
      return;
    }
    if (!scene) return;
    const patch = keyPatch(event.key, event.shiftKey, settings, { hasPhoto, moonOn });
    if (!patch) return;
    event.preventDefault();
    const changes = diffPatch(settings, patch);
    if (!changes) return;
    continueBurst();
    onChange(changes);
  };

  const onWheel = useEffectEvent((event: WheelEvent) => {
    if (!hasPhoto || loading) return;
    // Resize the photo instead of scrolling the page.
    event.preventDefault();
    if (gestureRef.current) return;
    const burst = continueBurst();
    const next = wheelScale(burst.scale ?? imageScale, wheelZoomFactor(event.deltaY, event.deltaMode, event.ctrlKey));
    burst.scale = next;
    const rounded = snapSetting("imageScale", next);
    if (rounded !== (burst.sent ?? imageScale)) {
      burst.sent = rounded;
      onChange({ imageScale: rounded });
    }
  });

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    // Non-passive, so a wheel over the photo can't scroll the page.
    const listener = (event: WheelEvent) => onWheel(event);
    container.addEventListener("wheel", listener, { passive: false });
    return () => container.removeEventListener("wheel", listener);
  }, []);

  // Never leave an undo group open when the editor goes away mid-gesture.
  const closeGestures = useEffectEvent(() => {
    if (gestureRef.current) {
      gestureRef.current = null;
      onGestureEnd();
    }
    const burst = burstRef.current;
    if (burst) {
      window.clearTimeout(burst.timer);
      burstRef.current = null;
      onGestureEnd();
    }
  });
  useEffect(() => () => closeGestures(), []);

  // ── Render ───────────────────────────────────────────────────────────────────────────────────

  const shown = active ?? hover;
  const cursor = scene ? cursorFor(shown, geometry, active !== null) : "default";
  const frameStyle = view
    ? { left: view.frame.left, top: view.frame.top, width: view.frame.width, height: view.frame.height }
    : undefined;
  const handleClass = (target: EditorTarget) =>
    cn(
      "stroke-brand transition-colors duration-[120ms] ease-[cubic-bezier(0.2,0,0.38,0.9)]",
      active === target ? "fill-brand" : shown === target ? "fill-brand-tint" : "fill-surface",
    );

  return (
    <div
      ref={containerRef}
      role="application"
      aria-roledescription="layout editor"
      aria-label="Photo layout"
      aria-describedby={helpId}
      tabIndex={0}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerEnd}
      onPointerCancel={onPointerEnd}
      onLostPointerCapture={onPointerEnd}
      onPointerLeave={onPointerLeave}
      onKeyDown={onKeyDown}
      style={{ cursor }}
      // The stage clips overflow, so the focus ring is drawn inside the edge.
      className={cn("relative h-full min-h-0 w-full touch-none select-none overflow-hidden focus-visible:-outline-offset-2!", className)}
    >
      {view?.kind === "sphere" && !loading && <OpeningHatch view={view} />}

      {view && (
        <canvas
          ref={canvasRef}
          aria-hidden="true"
          className={cn("pointer-events-none absolute", loading && "invisible")}
          style={frameStyle}
        />
      )}

      {view && loading && (
        <div className="pointer-events-none absolute" style={frameStyle}>
          <Skeleton className={cn("size-full", view.kind === "sphere" ? "rounded-full" : "rounded-control")} />
        </div>
      )}

      {view && !loading && (
        <svg aria-hidden="true" className="pointer-events-none absolute inset-0 size-full overflow-visible">
          {view.kind === "flat" && shapePath && (
            <>
              <path d={shapePath} fill="none" strokeWidth={1} className="stroke-surface opacity-70" />
              <path d={shapePath} fill="none" strokeWidth={1} strokeDasharray="4 3" className="stroke-secondary" />
            </>
          )}
          {view.kind === "sphere" && (
            <circle cx={view.cx} cy={view.cy} r={view.radius - 0.5} fill="none" strokeWidth={1} className="stroke-line-strong" />
          )}

          {outline && (
            <>
              {outline.hidden && (
                <path d={outline.hidden} fill="none" strokeWidth={1} strokeDasharray="3 3" className="stroke-brand opacity-60" />
              )}
              {outline.solid && (
                <>
                  <path d={outline.solid} fill="none" strokeWidth={3} strokeLinejoin="round" className="stroke-surface opacity-70" />
                  <path
                    d={outline.solid}
                    fill="none"
                    strokeWidth={shown === "move" ? 2 : 1}
                    strokeLinejoin="round"
                    className="stroke-brand"
                  />
                </>
              )}
            </>
          )}

          {geometry?.rotate.visible && (
            <>
              <line
                x1={geometry.rotate.anchor.x}
                y1={geometry.rotate.anchor.y}
                x2={geometry.rotate.at.x}
                y2={geometry.rotate.at.y}
                strokeWidth={1}
                className="stroke-brand"
              />
              <circle
                cx={geometry.rotate.at.x}
                cy={geometry.rotate.at.y}
                r={ROTATE_HANDLE_RADIUS}
                strokeWidth={1}
                className={handleClass("rotate")}
              />
            </>
          )}
          {geometry &&
            CORNERS.map((corner) => {
              const handle = geometry.corners[corner];
              if (!handle.visible) return null;
              return (
                <rect
                  key={corner}
                  x={-HANDLE_SIZE / 2}
                  y={-HANDLE_SIZE / 2}
                  width={HANDLE_SIZE}
                  height={HANDLE_SIZE}
                  rx={1}
                  transform={`translate(${handle.at.x.toFixed(2)} ${handle.at.y.toFixed(2)}) rotate(${geometry.angleDeg})`}
                  strokeWidth={1}
                  className={handleClass(`scale-${corner}`)}
                />
              );
            })}
        </svg>
      )}

      <p
        aria-hidden="true"
        className="pointer-events-none absolute bottom-3 left-3 line-clamp-2 max-w-[calc(100%-24px)] rounded-chip bg-stage/80 px-1.5 py-0.5 text-[12px] leading-4 text-muted"
      >
        {hint}
      </p>
      <p id={helpId} className="sr-only">
        {help}
      </p>
      <p aria-live="polite" className="sr-only">
        {liveText}
      </p>
    </div>
  );
}

/** The sphere's bottom opening (below latitude −(90° − opening)) as a hatched segment of the front-view disc. */
function OpeningHatch({ view }: { view: Extract<EditorView, { kind: "sphere" }> }) {
  const height = view.radius * (1 - Math.cos((view.openingDeg * Math.PI) / 180));
  return (
    <div
      aria-hidden="true"
      className="pointer-events-none absolute overflow-hidden rounded-full"
      style={{ left: view.frame.left, top: view.frame.top, width: view.frame.width, height: view.frame.height }}
    >
      <div
        className="tex-hatch absolute inset-x-0 bottom-0 border-t border-dashed border-line-strong bg-stage"
        style={{ height }}
      />
    </div>
  );
}

// ── Hooks ────────────────────────────────────────────────────────────────────────────────────────

/** Content size of an element (rounded CSS px), tracked with a ResizeObserver; null until measured. */
function useElementSize(ref: RefObject<HTMLElement | null>): Size | null {
  const [size, setSize] = useState<Size | null>(null);
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const observer = new ResizeObserver((entries) => {
      const box = entries[entries.length - 1]?.contentRect;
      if (!box) return;
      const width = Math.round(box.width);
      const height = Math.round(box.height);
      setSize((previous) => (previous && previous.width === width && previous.height === height ? previous : { width, height }));
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [ref]);
  return size;
}

function subscribeToResize(onChange: () => void): () => void {
  // Browser zoom and moving to another screen change the pixel ratio and fire "resize".
  window.addEventListener("resize", onChange);
  return () => window.removeEventListener("resize", onChange);
}

function readDevicePixelRatio(): number {
  return window.devicePixelRatio || 1;
}

function serverDevicePixelRatio(): number {
  return 1;
}

/** Keeps the previous domain object while a new one describes the same piece, so shape work isn't redone. */
function useStableDomain(domain: Domain): Domain {
  const [stable, setStable] = useState(domain);
  const same = sameDomain(stable, domain);
  if (!same) setStable(domain);
  return same ? stable : domain;
}

interface PaintInput {
  view: EditorView;
  domain: Domain;
  settings: ProjectionSettings;
  photo: PhotoPixels | null;
  moon: GrayMap | null;
  dpr: number;
}

interface PainterState {
  /** When the input last changed (performance.now). */
  changedAt: number;
  /** How long the last full image took (ms). */
  fullMs: number;
  image: ImageData | null;
}

/**
 * Draws the editor image into the canvas at most once per animation frame. While the input streams
 * (a drag), slow images are drawn at half resolution and a full one follows when it settles.
 */
function useCanvasPainter(canvasRef: RefObject<HTMLCanvasElement | null>, input: PaintInput | null): void {
  const stateRef = useRef<PainterState>({ changedAt: Number.NEGATIVE_INFINITY, fullMs: 0, image: null });
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !input) return;
    const state = stateRef.current;
    const now = performance.now();
    const streaming = now - state.changedAt < STREAM_MS;
    state.changedAt = now;
    const draft = streaming && state.fullMs > DRAFT_BUDGET_MS;
    let settle = 0;
    const frame = requestAnimationFrame(() => {
      paint(canvas, input, draft ? DRAFT_QUALITY : 1, state);
      if (draft) settle = window.setTimeout(() => paint(canvas, input, 1, state), SETTLE_MS);
    });
    return () => {
      cancelAnimationFrame(frame);
      window.clearTimeout(settle);
    };
  }, [canvasRef, input]);
}

function paint(canvas: HTMLCanvasElement, input: PaintInput, quality: number, state: PainterState): void {
  const { width, height } = rasterSize(input.view.frame.width, input.view.frame.height, input.dpr, quality);
  if (canvas.width !== width) canvas.width = width;
  if (canvas.height !== height) canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) return;
  let image = state.image;
  if (!image || image.width !== width || image.height !== height) {
    image = context.createImageData(width, height);
    state.image = image;
  }
  const started = performance.now();
  renderEditorRaster(
    { domain: input.domain, settings: input.settings, photo: input.photo, moon: input.moon, width, height },
    image.data,
  );
  context.putImageData(image, 0, 0);
  if (quality === 1) state.fullMs = performance.now() - started;
}
