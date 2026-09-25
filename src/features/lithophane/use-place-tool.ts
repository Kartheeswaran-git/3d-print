"use client";

import { useRef } from "react";
import type { PlaceEvent } from "@/components/viewer";
import { continuePlaceDrag, startPlaceDrag, wheelToScale, type PlaceDrag } from "./place-drag";
import { useLithophaneHistory, useLithophaneStore } from "./store";

/**
 * Handlers for the viewer's place mode ("Move photo", FEATURE.md §3). A drag on the model moves the photo
 * with the grabbed surface point and is one undo step (history.begin/end); the wheel resizes the photo
 * (quick wheel turns merge into one step through the history's coalescing window).
 */
export function usePlaceTool(): { onPlace: (event: PlaceEvent) => void; onPlaceWheel: (deltaY: number) => void } {
  const dragRef = useRef<PlaceDrag | null>(null);
  const wheelRef = useRef(0);

  const onPlace = (event: PlaceEvent) => {
    const { settings, setMany } = useLithophaneStore.getState();
    const history = useLithophaneHistory.getState();
    if (event.phase === "start") {
      // A stray start while a drag is open (it never should be) must not leave the undo group unbalanced.
      if (dragRef.current) history.end();
      dragRef.current = startPlaceDrag(event.point, settings);
      if (dragRef.current) history.begin();
      return;
    }
    const drag = dragRef.current;
    if (!drag) return;
    const next = continuePlaceDrag(drag, event.point, settings);
    dragRef.current = next.drag;
    setMany(next.placement);
    if (event.phase === "end") {
      dragRef.current = null;
      history.end();
    }
  };

  const onPlaceWheel = (deltaY: number) => {
    const { settings, set } = useLithophaneStore.getState();
    const next = wheelToScale(settings.imageScale, wheelRef.current, deltaY);
    wheelRef.current = next.pending;
    if (next.imageScale !== settings.imageScale) set("imageScale", next.imageScale);
  };

  return { onPlace, onPlaceWheel };
}
