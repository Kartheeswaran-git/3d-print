"use client";

import {
  Component,
  useEffect,
  useEffectEvent,
  useId,
  useImperativeHandle,
  useRef,
  useSyncExternalStore,
  type KeyboardEvent,
  type PointerEvent,
  type ReactNode,
} from "react";
import { Canvas } from "@react-three/fiber";
import { MonitorX } from "lucide-react";
import { cn } from "@/lib/utils";
import { CAMERA_FOV } from "./framing";
import { normalizeWheelDelta, samePoint, startsPlacement } from "./placement";
import { ViewerScene, type SceneRigHandle } from "./scene";
import type { CameraView, ModelViewerProps } from "./types";

export type {
  BacklightSettings,
  CameraView,
  InteractionMode,
  ModelViewerHandle,
  ModelViewerProps,
  PlaceEvent,
  ViewerPart,
} from "./types";

// Module constants: R3F compares these shallowly, so the renderer and camera are configured once.
const DPR: [number, number] = [1, 2];
const GL_OPTIONS = { antialias: true, alpha: true, preserveDrawingBuffer: false } as const;
const CAMERA_OPTIONS = { fov: CAMERA_FOV, near: 0.5, far: 5000, position: [120, 90, 220] as [number, number, number] };

const ORBIT_STEP = Math.PI / 12;
const TILT_STEP = Math.PI / 18;
const ZOOM_STEP = 1.15;

/** Marks the viewer while the pointer is over the model in place mode (or dragging on it); shows the crosshair. */
const PLACE_TARGET_ATTRIBUTE = "data-place-target";

interface PlaceGesture {
  pointerId: number;
  /** Last point reported; "end" repeats it. */
  point: [number, number, number];
}

/** Latest pointer position waiting for the next animation frame (picks run at most once per frame). */
interface PendingPointer {
  x: number;
  y: number;
  frame: number;
}

/**
 * Interactive 3D preview (react-three-fiber). The canvas is created once; parts, colours, wireframe
 * and backlight update the existing scene. The camera keeps the user's view until `fitKey` changes.
 */
export default function ModelViewer({
  ref,
  parts,
  fitKey,
  appearance,
  wireframe = false,
  backlight = null,
  interactionMode = "orbit",
  onPlace,
  onPlaceWheel,
  className,
  ariaLabel,
}: ModelViewerProps) {
  const supported = useSyncExternalStore(subscribeNever, detectWebGL, assumeSupported);
  const rigRef = useRef<SceneRigHandle>(null);
  const viewRef = useRef<CameraView>("perspective");
  const wrapperRef = useRef<HTMLDivElement>(null);
  const gestureRef = useRef<PlaceGesture | null>(null);
  const pendingRef = useRef<PendingPointer>({ x: 0, y: 0, frame: 0 });
  const helpId = useId();
  const placeMode = interactionMode === "place";

  useImperativeHandle(
    ref,
    () => ({
      setView(view: CameraView) {
        viewRef.current = view;
        rigRef.current?.frame(view, true);
      },
      resetView() {
        viewRef.current = "perspective";
        rigRef.current?.frame("perspective", true);
      },
    }),
    [],
  );

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.target !== event.currentTarget || event.altKey || event.ctrlKey || event.metaKey) return;
    const rig = rigRef.current;
    if (!rig) return;
    // Same sense as dragging: the model follows the arrow.
    switch (event.key) {
      case "ArrowLeft":
        rig.orbitBy(ORBIT_STEP, 0);
        break;
      case "ArrowRight":
        rig.orbitBy(-ORBIT_STEP, 0);
        break;
      case "ArrowUp":
        rig.orbitBy(0, TILT_STEP);
        break;
      case "ArrowDown":
        rig.orbitBy(0, -TILT_STEP);
        break;
      case "+":
      case "=":
        rig.zoomBy(1 / ZOOM_STEP);
        break;
      case "-":
      case "_":
        rig.zoomBy(ZOOM_STEP);
        break;
      default:
        return;
    }
    event.preventDefault();
  };

  // ── Place mode ────────────────────────────────────────────────────────────────────────────────
  // Pointer handlers sit on the wrapper, an ancestor of the element OrbitControls listens on: the capture
  // handler below runs first and pauses the controls, so a press on the model never starts a rotation.

  const setPlaceCursor = (on: boolean) => {
    wrapperRef.current?.toggleAttribute(PLACE_TARGET_ATTRIBUTE, on);
  };

  const takePending = (): { x: number; y: number } | null => {
    const pending = pendingRef.current;
    if (pending.frame === 0) return null;
    cancelAnimationFrame(pending.frame);
    pending.frame = 0;
    return { x: pending.x, y: pending.y };
  };

  /** Drag: report the point under the pointer when it moved on the model. Hover: show whether a press would place. */
  const trackPointer = (x: number, y: number) => {
    const rig = rigRef.current;
    if (!rig) return;
    const point = rig.pick(x, y);
    const gesture = gestureRef.current;
    if (!gesture) {
      setPlaceCursor(point !== null);
      return;
    }
    if (!point || samePoint(point, gesture.point)) return;
    gesture.point = point;
    onPlace?.({ phase: "move", point });
  };

  const scheduleTrack = (x: number, y: number) => {
    const pending = pendingRef.current;
    pending.x = x;
    pending.y = y;
    if (pending.frame !== 0) return;
    pending.frame = requestAnimationFrame(() => {
      pending.frame = 0;
      trackPointer(pending.x, pending.y);
    });
  };

  /** Close the drag: report the final position (release point, else a pending move), then "end" exactly once. */
  const finishGesture = (release: { x: number; y: number } | null) => {
    const gesture = gestureRef.current;
    if (!gesture) return;
    const pending = takePending();
    const last = release ?? pending;
    if (last) trackPointer(last.x, last.y);
    gestureRef.current = null;
    rigRef.current?.setPlacing(false);
    const wrapper = wrapperRef.current;
    if (wrapper?.hasPointerCapture(gesture.pointerId)) wrapper.releasePointerCapture(gesture.pointerId);
    onPlace?.({ phase: "end", point: gesture.point });
  };

  const onPlacePointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (gestureRef.current) return;
    const rig = rigRef.current;
    const point = rig && startsPlacement(event) ? rig.pick(event.clientX, event.clientY) : null;
    if (!rig || !point) {
      // Empty space, another button or a modifier: the camera controls take this press.
      takePending();
      setPlaceCursor(false);
      return;
    }
    rig.setPlacing(true);
    event.currentTarget.setPointerCapture(event.pointerId);
    gestureRef.current = { pointerId: event.pointerId, point };
    takePending();
    setPlaceCursor(true);
    onPlace?.({ phase: "start", point });
  };

  const onPlacePointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const gesture = gestureRef.current;
    if (gesture) {
      if (event.pointerId === gesture.pointerId) scheduleTrack(event.clientX, event.clientY);
      return;
    }
    // Hover feedback only for a mouse or pen with no button down (a camera drag keeps its own cursor).
    if (event.pointerType !== "touch" && event.buttons === 0) scheduleTrack(event.clientX, event.clientY);
  };

  const onPlacePointerUp = (event: PointerEvent<HTMLDivElement>) => {
    if (event.pointerId !== gestureRef.current?.pointerId) return;
    finishGesture({ x: event.clientX, y: event.clientY });
    // Refresh the cursor for wherever the drag ended.
    if (event.pointerType !== "touch") scheduleTrack(event.clientX, event.clientY);
  };

  const onPlacePointerCancel = (event: PointerEvent<HTMLDivElement>) => {
    if (event.pointerId !== gestureRef.current?.pointerId) return;
    finishGesture(null);
    setPlaceCursor(false);
  };

  const onPlacePointerLeave = () => {
    if (gestureRef.current) return;
    takePending();
    setPlaceCursor(false);
  };

  const leavePlaceMode = useEffectEvent(() => {
    finishGesture(null);
    takePending();
    setPlaceCursor(false);
  });

  const emitPlaceWheel = useEffectEvent((deltaY: number) => {
    onPlaceWheel?.(deltaY);
  });

  useEffect(() => {
    const wrapper = wrapperRef.current;
    if (!placeMode || !wrapper) return;
    // Trackpad pinches arrive as ctrl + wheel; a held Control key means a real ctrl + wheel instead.
    let controlHeld = false;
    const onWheel = (event: WheelEvent) => {
      // Capture phase on an ancestor: OrbitControls never receives it, so it cannot zoom; the page must not scroll.
      event.preventDefault();
      event.stopPropagation();
      emitPlaceWheel(normalizeWheelDelta(event.deltaY, event.deltaMode, event.ctrlKey && !controlHeld));
    };
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Control") controlHeld = event.type === "keydown";
    };
    const onBlur = () => {
      controlHeld = false;
    };
    wrapper.addEventListener("wheel", onWheel, { capture: true, passive: false });
    window.addEventListener("keydown", onKey, true);
    window.addEventListener("keyup", onKey, true);
    window.addEventListener("blur", onBlur);
    return () => {
      wrapper.removeEventListener("wheel", onWheel, { capture: true });
      window.removeEventListener("keydown", onKey, true);
      window.removeEventListener("keyup", onKey, true);
      window.removeEventListener("blur", onBlur);
      // Switching back to orbit (or unmounting) mid-drag still ends the drag, so callers can close an undo step.
      leavePlaceMode();
    };
  }, [placeMode, supported]);

  if (!supported) return <ViewerUnavailable className={className} />;

  return (
    <ViewerErrorBoundary fallback={<ViewerUnavailable className={className} />}>
      <div
        ref={wrapperRef}
        role="application"
        aria-roledescription="3D viewer"
        aria-label={ariaLabel}
        aria-describedby={helpId}
        tabIndex={0}
        onKeyDown={onKeyDown}
        onPointerDownCapture={placeMode ? onPlacePointerDown : undefined}
        onPointerMove={placeMode ? onPlacePointerMove : undefined}
        onPointerUp={placeMode ? onPlacePointerUp : undefined}
        onPointerCancel={placeMode ? onPlacePointerCancel : undefined}
        onLostPointerCapture={placeMode ? onPlacePointerCancel : undefined}
        onPointerLeave={placeMode ? onPlacePointerLeave : undefined}
        // The stage clips overflow, so the focus ring is drawn inside the edge.
        className={cn(
          "relative h-full w-full min-h-0 cursor-grab active:cursor-grabbing data-place-target:cursor-crosshair! focus-visible:-outline-offset-2!",
          className,
        )}
      >
        <Canvas dpr={DPR} gl={GL_OPTIONS} camera={CAMERA_OPTIONS} frameloop="demand">
          <ViewerScene
            parts={parts}
            fitKey={fitKey}
            appearance={appearance}
            wireframe={wireframe}
            backlight={backlight}
            interactionMode={interactionMode}
            rigRef={rigRef}
            viewRef={viewRef}
          />
        </Canvas>
        <p id={helpId} className="sr-only">
          {placeMode
            ? "Drag on the model to place. Drag beside it or right-drag to rotate. Arrow keys rotate, plus and minus zoom."
            : "Drag to rotate, scroll to zoom. Arrow keys rotate, plus and minus zoom."}
        </p>
      </div>
    </ViewerErrorBoundary>
  );
}

/** Shown when WebGL 2 is missing or the renderer fails to start. */
function ViewerUnavailable({ className }: { className?: string }) {
  return (
    <div className={cn("flex h-full w-full min-h-0 items-center justify-center p-6", className)}>
      <div
        role="status"
        className="flex max-w-sm items-start gap-3 rounded-card border border-warning-line bg-warning-tint px-4 py-3"
      >
        <MonitorX className="mt-0.5 h-4 w-4 shrink-0 text-warning" aria-hidden />
        <div className="min-w-0 text-[13px]">
          <p className="font-medium text-ink">3D preview isn&apos;t available in this browser.</p>
          <p className="mt-0.5 text-body">You can still export.</p>
        </div>
      </div>
    </div>
  );
}

class ViewerErrorBoundary extends Component<{ fallback: ReactNode; children: ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true };
  }

  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

let webglSupport: boolean | null = null;

/** three.js r163+ renders with WebGL 2 only. Probed once, then the context is released. */
function detectWebGL(): boolean {
  if (webglSupport !== null) return webglSupport;
  try {
    const context = document.createElement("canvas").getContext("webgl2");
    webglSupport = context !== null;
    context?.getExtension("WEBGL_lose_context")?.loseContext();
  } catch {
    webglSupport = false;
  }
  return webglSupport;
}

function subscribeNever(): () => void {
  return () => {};
}

function assumeSupported(): boolean {
  return true;
}
