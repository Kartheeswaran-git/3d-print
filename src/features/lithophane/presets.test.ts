import { describe, expect, it } from "vitest";
import {
  BADGE_IMAGE_SCALE,
  PLACEMENT_PRESETS,
  SPHERE_FIT_RADIUS,
  STARTER_DESIGNS,
  placedPhotoAspect,
  placementModelAspect,
  placementPreset,
  starterDesignPatch,
  type PlacementPreset,
} from "./presets";
import { DEFAULTS, NUMERIC, sanitizeSettings, type LithophaneSettings } from "./settings";

/** Explicit placement values so the tests don't depend on DEFAULTS. */
const settings = (patch: Partial<LithophaneSettings> = {}): LithophaneSettings => ({
  ...DEFAULTS,
  imageScale: 77,
  imageX: 12,
  imageY: -30,
  rotation: 0,
  edgeBlend: 15,
  cropRatio: "original",
  cropScale: 1,
  cropX: 0,
  cropY: 0,
  ...patch,
});

const flat = (patch: Partial<LithophaneSettings> = {}) => settings({ shape: "rectangle", width: 100, height: 100, ...patch });
const sphere = (patch: Partial<LithophaneSettings> = {}) => settings({ shape: "sphere", ...patch });

/** Flat photo rectangle size (mm) for a placement, following the flat semantics. */
function flatPhotoSize(s: LithophaneSettings, scale: number, aspect: number) {
  const w = (scale / 100) * s.width;
  return { w, h: w / aspect };
}

/** Axis-aligned bounding box of a w × h rectangle rotated by `deg`. */
function rotatedBox(w: number, h: number, deg: number) {
  const t = (deg * Math.PI) / 180;
  const c = Math.abs(Math.cos(t));
  const sn = Math.abs(Math.sin(t));
  return { w: w * c + h * sn, h: w * sn + h * c };
}

/** Whether every corner of the centred W × H piece lies inside the centred photo rect rotated by `deg`. */
function photoCoversPiece(W: number, H: number, w: number, h: number, deg: number) {
  const t = (deg * Math.PI) / 180;
  return [
    [W / 2, H / 2],
    [-W / 2, H / 2],
    [W / 2, -H / 2],
    [-W / 2, -H / 2],
  ].every(([x, y]) => {
    // Into the photo's frame (inverse rotation).
    const px = x * Math.cos(t) + y * Math.sin(t);
    const py = -x * Math.sin(t) + y * Math.cos(t);
    return Math.abs(px) <= w / 2 + 1e-9 && Math.abs(py) <= h / 2 + 1e-9;
  });
}

/** A patch is valid when sanitising it changes nothing. */
function expectSanitizeKeeps(patch: Partial<LithophaneSettings>) {
  const sanitized = sanitizeSettings({ ...DEFAULTS, ...patch });
  for (const [key, value] of Object.entries(patch)) expect(sanitized[key as keyof LithophaneSettings], key).toEqual(value);
}

describe("placedPhotoAspect", () => {
  it("is the crop rectangle's aspect, from an aspect number or a pixel size", () => {
    expect(placedPhotoAspect(flat(), 4 / 3)).toBeCloseTo(4 / 3, 9);
    expect(placedPhotoAspect(flat(), { width: 4032, height: 3024 })).toBeCloseTo(4 / 3, 9);
    expect(placedPhotoAspect(flat({ cropRatio: "16:9" }), { width: 1000, height: 1000 })).toBeCloseTo(16 / 9, 9);
    expect(placedPhotoAspect(flat({ cropRatio: "3:4", cropScale: 0.5, cropX: 1 }), 2)).toBeCloseTo(3 / 4, 9);
  });

  it("uses the piece for 'model' on flat shapes and 1:1 on the sphere", () => {
    expect(placementModelAspect(flat({ width: 150, height: 100 }))).toBe(1.5);
    expect(placementModelAspect(sphere())).toBe(1);
    expect(placedPhotoAspect(flat({ width: 150, height: 100, cropRatio: "model" }), 0.5)).toBeCloseTo(1.5, 9);
    expect(placedPhotoAspect(sphere({ cropRatio: "model" }), { width: 4000, height: 1000 })).toBeCloseTo(1, 9);
  });

  it("is known without a photo except for the 'original' crop", () => {
    expect(placedPhotoAspect(flat(), null)).toBeNull();
    expect(placedPhotoAspect(flat({ cropRatio: "4:3" }), null)).toBeCloseTo(4 / 3, 9);
    expect(placedPhotoAspect(flat({ width: 200, height: 100, cropRatio: "model" }), null)).toBeCloseTo(2, 9);
  });

  it("is null for an unusable photo size", () => {
    expect(placedPhotoAspect(flat(), 0)).toBeNull();
    expect(placedPhotoAspect(flat(), Number.NaN)).toBeNull();
    expect(placedPhotoAspect(flat(), { width: 0, height: 100 })).toBeNull();
  });
});

describe("placementPreset", () => {
  it("center: centred and straightened, size untouched", () => {
    for (const s of [flat({ rotation: 33 }), sphere({ rotation: -90 })]) {
      expect(placementPreset("center", s, 1.5)).toEqual({ imageX: 0, imageY: 0, rotation: 0 });
      expect(placementPreset("center", s, null)).toEqual({ imageX: 0, imageY: 0, rotation: 0 });
    }
  });

  it("badge: a small centred photo", () => {
    expect(placementPreset("badge", flat(), 1.5)).toEqual({ imageX: 0, imageY: 0, imageScale: BADGE_IMAGE_SCALE });
    expect(placementPreset("badge", sphere(), null)).toEqual({ imageX: 0, imageY: 0, imageScale: 35 });
  });

  describe("flat", () => {
    it("fit: the whole photo inside the piece", () => {
      // Landscape photo on a square piece: full width, letterboxed height.
      expect(placementPreset("fit", flat(), 4 / 3)).toEqual({ imageX: 0, imageY: 0, imageScale: 100 });
      // Square photo on a 150 × 100 piece: limited by the height (100 / 150).
      expect(placementPreset("fit", flat({ width: 150, height: 100 }), 1)).toEqual({ imageX: 0, imageY: 0, imageScale: 66 });
      // Portrait photo on a square piece: height-limited → 3/4 of the width.
      expect(placementPreset("fit", flat(), { width: 3000, height: 4000 })).toMatchObject({ imageScale: 75 });
    });

    it("fit: the rotated bounding box stays inside W × H, and one percent more would not", () => {
      for (const [W, H] of [
        [100, 100],
        [150, 100],
        [60, 180],
      ]) {
        for (const rotation of [0, 17, 45, -60, 90, 135, 180]) {
          for (const aspect of [0.5, 1, 4 / 3, 16 / 9]) {
            const s = flat({ width: W, height: H, rotation });
            const scale = placementPreset("fit", s, aspect).imageScale ?? Number.NaN;
            const box = (k: number) => {
              const { w, h } = flatPhotoSize(s, k, aspect);
              return rotatedBox(w, h, rotation);
            };
            const fits = (k: number) => box(k).w <= W + 1e-9 && box(k).h <= H + 1e-9;
            expect(fits(scale), `${W}×${H} rot ${rotation} aspect ${aspect}`).toBe(true);
            if (scale < NUMERIC.imageScale.max) expect(fits(scale + 1)).toBe(false);
          }
        }
      }
    });

    it("fill: the photo covers the piece, and one percent less would not", () => {
      for (const [W, H] of [
        [100, 100],
        [150, 100],
        [100, 150],
      ]) {
        for (const rotation of [0, 10, 30, -45, 90]) {
          for (const aspect of [0.75, 1, 1.5, 16 / 9]) {
            const s = flat({ width: W, height: H, rotation });
            const scale = placementPreset("fill", s, aspect).imageScale ?? Number.NaN;
            const covers = (k: number) => {
              const { w, h } = flatPhotoSize(s, k, aspect);
              return photoCoversPiece(W, H, w, h, rotation);
            };
            if (scale < NUMERIC.imageScale.max) {
              expect(covers(scale), `${W}×${H} rot ${rotation} aspect ${aspect}`).toBe(true);
              expect(covers(scale - 1)).toBe(false);
            }
          }
        }
      }
    });

    it("fill: exact values for simple cases", () => {
      expect(placementPreset("fill", flat({ width: 150, height: 100 }), 1)).toEqual({ imageX: 0, imageY: 0, imageScale: 100 });
      // A 1:1 photo on a 100 × 150 piece must be 150 mm wide.
      expect(placementPreset("fill", flat({ width: 100, height: 150 }), 1)).toMatchObject({ imageScale: 150 });
      // The 'model' crop always matches the piece.
      expect(placementPreset("fill", flat({ width: 150, height: 100, cropRatio: "model" }), 0.4)).toMatchObject({ imageScale: 100 });
      // Rotated 45° square on a square piece: √2 wide.
      expect(placementPreset("fill", flat({ rotation: 45 }), 1)).toMatchObject({ imageScale: 142 });
    });

    it("keeps the rotation and uses the crop, not the raw photo", () => {
      const s = flat({ rotation: 30, cropRatio: "1:1" });
      const patch = placementPreset("fit", s, { width: 4000, height: 1000 });
      expect(patch).not.toHaveProperty("rotation");
      expect(patch.imageScale).toBe(placementPreset("fit", s, 1).imageScale);
    });

    it("clamps to the imageScale range", () => {
      // A very wide photo filling a tall piece needs more than 150 %.
      expect(placementPreset("fill", flat({ width: 60, height: 180 }), 4)).toMatchObject({ imageScale: NUMERIC.imageScale.max });
      // A very tall photo fitted in a wide piece needs less than 10 %.
      expect(placementPreset("fit", flat({ width: 300, height: 20 }), 0.1)).toMatchObject({ imageScale: NUMERIC.imageScale.min });
    });

    it("only centres when the photo aspect is unknown", () => {
      expect(placementPreset("fit", flat(), null)).toEqual({ imageX: 0, imageY: 0 });
      expect(placementPreset("fill", flat(), null)).toEqual({ imageX: 0, imageY: 0 });
    });
  });

  describe("sphere", () => {
    it("fit: the decal's corners stay within 0.92 of the front disc", () => {
      expect(placementPreset("fit", sphere(), 1)).toEqual({ imageX: 0, imageY: 0, imageScale: 65 });
      for (const aspect of [0.5, 9 / 16, 3 / 4, 1, 4 / 3, 16 / 9, 3]) {
        const scale = placementPreset("fit", sphere({ rotation: 40 }), aspect).imageScale ?? Number.NaN;
        const corner = (k: number) => Math.hypot(k / 100, k / 100 / aspect);
        expect(corner(scale), `aspect ${aspect}`).toBeLessThanOrEqual(SPHERE_FIT_RADIUS + 1e-9);
        expect(corner(scale + 1)).toBeGreaterThan(SPHERE_FIT_RADIUS);
      }
    });

    it("fit: 'model' crops to 1:1 whatever the photo", () => {
      expect(placementPreset("fit", sphere({ cropRatio: "model" }), { width: 4000, height: 1000 })).toMatchObject({ imageScale: 65 });
    });

    it("fill: 92 % with at least a 20 % edge blend", () => {
      expect(placementPreset("fill", sphere({ edgeBlend: 5 }), 1.5)).toEqual({ imageX: 0, imageY: 0, imageScale: 92, edgeBlend: 20 });
      expect(placementPreset("fill", sphere({ edgeBlend: 35 }), null)).toEqual({ imageX: 0, imageY: 0, imageScale: 92, edgeBlend: 35 });
    });
  });

  it("returns values that sanitizeSettings keeps unchanged", () => {
    const presets: PlacementPreset[] = ["center", "fit", "fill", "badge"];
    for (const base of [flat({ rotation: 23 }), flat({ width: 220, height: 40 }), sphere(), sphere({ cropRatio: "9:16" })]) {
      for (const p of presets) {
        for (const photo of [null, 0.3, 1, 2.5, { width: 4032, height: 3024 }]) expectSanitizeKeeps(placementPreset(p, base, photo));
      }
    }
  });
});

describe("PLACEMENT_PRESETS", () => {
  it("lists the four presets in order; only Center works without a photo", () => {
    expect(PLACEMENT_PRESETS.map((p) => p.id)).toEqual(["center", "fit", "fill", "badge"]);
    expect(PLACEMENT_PRESETS.map((p) => p.label)).toEqual(["Center", "Fit", "Fill", "Badge"]);
    expect(PLACEMENT_PRESETS.filter((p) => p.worksWithoutPhoto).map((p) => p.id)).toEqual(["center"]);
  });
});

describe("STARTER_DESIGNS", () => {
  const byId = (id: string) => {
    const design = STARTER_DESIGNS.find((d) => d.id === id);
    if (!design) throw new Error(`Missing starter design ${id}`);
    return design;
  };

  it("has the five designs, with unique ids and copy", () => {
    expect(STARTER_DESIGNS.map((d) => d.id)).toEqual(["classic-moon", "photo-moon", "crescent-keepsake", "heart-frame", "photo-panel"]);
    for (const d of STARTER_DESIGNS) {
      expect(d.label.length).toBeGreaterThan(0);
      expect(d.description.length).toBeGreaterThan(0);
      // Sentence case.
      expect(d.label.slice(1)).toBe(d.label.slice(1).toLowerCase());
    }
  });

  it("matches the specified settings", () => {
    expect(byId("classic-moon").settings).toMatchObject({
      shape: "sphere",
      sphereDiameter: 120,
      moonBackground: true,
      moonSurface: "lro",
      moonLongitude: 0,
    });
    expect(byId("classic-moon").placement).toBeUndefined();
    expect(byId("photo-moon").settings).toMatchObject({ shape: "sphere", sphereDiameter: 140, imageScale: 60, edgeBlend: 30 });
    expect(byId("crescent-keepsake").settings).toMatchObject({ shape: "crescent", width: 100, height: 100 });
    expect(byId("crescent-keepsake").placement).toBe("fit");
    expect(byId("heart-frame").settings).toMatchObject({ shape: "heart", width: 110, height: 100 });
    expect(byId("photo-panel").settings).toMatchObject({
      shape: "rectangle",
      width: 150,
      height: 100,
      moonBackground: false,
      cropRatio: "model",
    });
    expect(byId("photo-panel").placement).toBe("fill");
  });

  it("every entry passes sanitizeSettings unchanged", () => {
    for (const d of STARTER_DESIGNS) expectSanitizeKeeps(d.settings);
  });

  it("starterDesignPatch adds the placement worked out for the new shape and the photo", () => {
    const current = sphere({ rotation: 0, cropRatio: "original" });
    // Crescent 100 × 100, 4:3 photo fitted: full width.
    expect(starterDesignPatch(byId("crescent-keepsake"), current, { width: 4000, height: 3000 })).toEqual({
      shape: "crescent",
      width: 100,
      height: 100,
      imageX: 0,
      imageY: 0,
      imageScale: 100,
    });
    // Without a photo the fit can only centre.
    expect(starterDesignPatch(byId("crescent-keepsake"), current, null)).toEqual({
      shape: "crescent",
      width: 100,
      height: 100,
      imageX: 0,
      imageY: 0,
    });
    // The panel crops to the piece, so filling it is 100 % with or without a photo.
    expect(starterDesignPatch(byId("photo-panel"), current, 0.5)).toMatchObject({ imageScale: 100, cropRatio: "model" });
    expect(starterDesignPatch(byId("photo-panel"), current, null)).toMatchObject({ imageScale: 100 });
    // Designs without a placement are their settings.
    expect(starterDesignPatch(byId("heart-frame"), current, 1)).toEqual(byId("heart-frame").settings);
  });

  it("starter patches are valid settings", () => {
    for (const d of STARTER_DESIGNS) {
      for (const photo of [null, 1, { width: 3000, height: 4000 }]) expectSanitizeKeeps(starterDesignPatch(d, settings(), photo));
    }
  });
});
