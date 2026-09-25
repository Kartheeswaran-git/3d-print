import { create } from "zustand";
import type { CoverageMask } from "@/lib/geometry/types";
import { loadMaskFile, loadMoonMap, loadPhoto, type GrayMap, type MoonSurface, type SourceImage } from "@/lib/image";

/** A decoded custom-shape mask. */
export interface LoadedMask {
  mask: CoverageMask;
  /** Grayscale coverage preview (white = solid). */
  preview: HTMLCanvasElement;
  name: string;
}

export type LoadStatus = "idle" | "loading" | "error";

/** What the stage shows: the 3D model, the 2D layout editor or the height map. */
export type StageView = "model" | "layout" | "heightmap";

export interface LithophaneSession {
  photo: SourceImage | null;
  photoStatus: LoadStatus;
  photoError: string | null;
  mask: LoadedMask | null;
  maskStatus: LoadStatus;
  maskError: string | null;
  /** Preview-quality lunar map for `moonSurface` (exports load the 4K map themselves). */
  moon: GrayMap | null;
  /** Which surface `moon` holds. */
  moonSurface: MoonSurface | null;
  moonError: string | null;
  /** App mode (moon lamp or photo panel). */
  mode: "moon-lamp" | "photo-panel";
  setMode: (mode: "moon-lamp" | "photo-panel") => void;
  /** Stage view mode. A newly added photo keeps the current view. */
  view: StageView;
  /** "Move photo" tool: dragging on the 3D model places the photo (only with a photo, in the 3D view). */
  placing: boolean;
  setView: (view: StageView) => void;
  setPlacing: (on: boolean) => void;
  loadPhoto: (file: File) => Promise<void>;
  removePhoto: () => void;
  loadMask: (file: File) => Promise<void>;
  removeMask: () => void;
  /** Load the preview map for `surface` unless it is already loaded or loading. */
  ensureMoon: (surface: MoonSurface) => void;
  retryMoon: () => void;
  /** Forget the photo and mask and leave the Move photo tool (Reset everything). */
  clear: () => void;
}

const message = (error: unknown, fallback: string) => (error instanceof Error && error.message ? error.message : fallback);

// Latest-request tokens: a slow decode that finishes after a newer choice (or a removal) is dropped.
let photoRequest = 0;
let maskRequest = 0;
/** Surface currently being fetched (null when idle) and the last one asked for (for retry). */
let moonLoading: MoonSurface | null = null;
let moonWanted: MoonSurface = "lro";

/**
 * Session data for the moon lamp studio: the photo, mask and moon texture, plus the stage view and tool.
 * Kept in memory only — never persisted, never uploaded. (Preview meshes and export progress belong to
 * the hooks that produce them: useLithophanePreview / useLithophaneExport.)
 */
export const useLithophaneSession = create<LithophaneSession>()((set, get) => ({
  photo: null,
  photoStatus: "idle",
  photoError: null,
  mask: null,
  maskStatus: "idle",
  maskError: null,
  moon: null,
  moonSurface: null,
  moonError: null,
  mode: "moon-lamp",
  setMode: (mode) => set({ mode }),
  view: "model",
  placing: false,

  setView: (view) => set({ view }),
  setPlacing: (placing) => set({ placing }),

  loadPhoto: async (file) => {
    const request = ++photoRequest;
    set({ photoStatus: "loading", photoError: null });
    try {
      const photo = await loadPhoto(file);
      if (request !== photoRequest) return;
      set({ photo, photoStatus: "idle", photoError: null });
      
      // Auto-fit photo-panel to the image aspect ratio
      const mode = get().mode;
      if (mode === "photo-panel" && photo) {
        const { useLithophaneStore } = await import("./store");
        const store = useLithophaneStore.getState();
        const maxDim = Math.max(store.settings.width, store.settings.height);
        const aspect = photo.width / photo.height;
        if (aspect >= 1) {
          store.set("width", maxDim);
          store.set("height", Math.max(20, Math.round(maxDim / aspect)));
        } else {
          store.set("height", maxDim);
          store.set("width", Math.max(20, Math.round(maxDim * aspect)));
        }
      }
    } catch (error) {
      if (request !== photoRequest) return;
      set({ photoStatus: "error", photoError: message(error, "This photo couldn't be opened. Choose another file.") });
    }
  },

  removePhoto: () => {
    photoRequest++;
    set({ photo: null, photoStatus: "idle", photoError: null, placing: false });
  },

  loadMask: async (file) => {
    const request = ++maskRequest;
    set({ maskStatus: "loading", maskError: null });
    try {
      const mask = await loadMaskFile(file);
      if (request !== maskRequest) return;
      set({ mask, maskStatus: "idle", maskError: null });
    } catch (error) {
      if (request !== maskRequest) return;
      set({ maskStatus: "error", maskError: message(error, "This mask couldn't be opened. Choose another SVG or PNG.") });
    }
  },

  removeMask: () => {
    maskRequest++;
    set({ mask: null, maskStatus: "idle", maskError: null });
  },

  ensureMoon: (surface) => {
    moonWanted = surface;
    if (get().moon && get().moonSurface === surface) {
      // Back on a surface that is already loaded: an error from another surface no longer applies.
      if (get().moonError) set({ moonError: null });
      return;
    }
    if (moonLoading === surface) return;
    moonLoading = surface;
    // A new load starts: show "loading", not an older failure.
    if (get().moonError) set({ moonError: null });
    loadMoonMap(surface, "preview").then(
      (moon) => {
        if (moonLoading === surface) moonLoading = null;
        // A newer surface choice wins; keep showing the old map until its own load lands.
        if (surface === moonWanted) set({ moon, moonSurface: surface, moonError: null });
      },
      (error: unknown) => {
        if (moonLoading === surface) moonLoading = null;
        // Drop the other surface's map too, so the stage reports the failure instead of quietly
        // previewing the wrong surface (loadMoonMap caches decoded maps, so switching back is instant).
        if (surface === moonWanted) {
          set({ moon: null, moonSurface: null, moonError: message(error, "The moon map couldn't be loaded. Try again.") });
        }
      },
    );
  },

  retryMoon: () => {
    set({ moonError: null });
    get().ensureMoon(moonWanted);
  },

  clear: () => {
    photoRequest++;
    maskRequest++;
    set({
      photo: null,
      photoStatus: "idle",
      photoError: null,
      mask: null,
      maskStatus: "idle",
      maskError: null,
      placing: false,
    });
  },
}));
