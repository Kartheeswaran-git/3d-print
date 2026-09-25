"use client";

import { createElement } from "react";
import dynamic from "next/dynamic";
import type { ModelViewerProps } from "./types";
import { ViewerLoading } from "./viewer-loading";

/** Client-only 3D viewer (WebGL cannot render on the server); shows a skeleton while its bundle loads. */
export const ModelViewer = dynamic<ModelViewerProps>(() => import("./model-viewer"), {
  ssr: false,
  loading: () => createElement(ViewerLoading),
});

export { ViewerLoading };
export type {
  BacklightSettings,
  CameraView,
  InteractionMode,
  ModelViewerHandle,
  ModelViewerProps,
  PlaceEvent,
  ViewerPart,
} from "./types";
