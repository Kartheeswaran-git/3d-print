import type { Ref } from "react";
import type { PartRole } from "@/lib/worker/protocol";

/** Camera presets offered by the stage toolbar. */
export type CameraView = "perspective" | "front" | "side" | "top";

/** One renderable mesh. Typed arrays are used as-is (never copied) and must not be mutated after they are passed in. */
export interface ViewerPart {
  /** Stable identity across updates (e.g. "body", "base", "text"); keeps the part's material alive when only its data changes. */
  key: string;
  role: PartRole;
  /** xyz triples in mm. */
  positions: Float32Array;
  /** Triangle indices, counter-clockwise seen from outside. */
  indices: Uint32Array;
  uvs?: Float32Array;
  /** Per-vertex wall thickness in mm; drives the backlight glow. */
  thickness?: Float32Array;
  /** CSS colour (#rrggbb) used by the "plastic" appearance. */
  color: string;
}

/** Imperative camera controls exposed through `ref`. */
export interface ModelViewerHandle {
  /** Animate (~300 ms, instant under reduced motion) to a preset view that frames the model. */
  setView(view: CameraView): void;
  /** Return to the default perspective view. */
  resetView(): void;
}

/**
 * Backlight simulation settings. `minThickness`/`maxThickness` describe the range of the parts'
 * `thickness` attribute (the whole wall, so for flat pieces base + relief). If the attribute exceeds
 * `maxThickness` (e.g. the base was left out), the range is shifted up so the thinnest walls still glow.
 */
export interface BacklightSettings {
  enabled: boolean;
  minThickness: number;
  maxThickness: number;
}

/**
 * What a left-drag on the model does. "orbit" rotates the camera. "place" reports surface points
 * through `onPlace`; the camera still rotates from a left-drag beside the model or any right-drag.
 */
export type InteractionMode = "orbit" | "place";

/** One step of a placement drag on the model. */
export interface PlaceEvent {
  /** "start" on the press, "move" whenever the point under the pointer changes, "end" exactly once on release or cancel. */
  phase: "start" | "move" | "end";
  /**
   * Surface point in mm, in the parts' own coordinates (the viewer never transforms meshes). "end" repeats the
   * last point reported, because the pointer may have left the model by then.
   */
  point: [number, number, number];
}

export interface ModelViewerProps {
  /** React 19 ref-as-prop. */
  ref?: Ref<ModelViewerHandle>;
  parts: ViewerPart[];
  /** The camera frames the model only when this string changes (and on the first non-empty parts). */
  fitKey: string;
  /** lithophane = warm translucent white with backlight glow; plastic = part colour, satin. */
  appearance: "lithophane" | "plastic";
  wireframe?: boolean;
  backlight?: BacklightSettings | null;
  /** Defaults to "orbit". */
  interactionMode?: InteractionMode;
  /** Place mode: a left-drag that starts on the model. The camera holds still for the whole drag. */
  onPlace?: (event: PlaceEvent) => void;
  /**
   * Place mode: the wheel over the viewer calls this instead of zooming. `deltaY` is in pixels (line and page
   * deltas are converted); positive means scroll down or pinch in. Trackpad pinches are scaled up ×10, as
   * OrbitControls does, so they feel like scrolling.
   */
  onPlaceWheel?: (deltaY: number) => void;
  className?: string;
  ariaLabel: string;
}
