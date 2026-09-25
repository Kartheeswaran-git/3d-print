import { describe, expect, it } from "vitest";
import type { CoverageMask, ScalarField } from "@/lib/geometry/types";
import { sphereColumnTheta } from "@/lib/image";
import {
  buildMeshJob,
  domainFor,
  exportFileName,
  exportSizeLabel,
  fitKeyFor,
  formSummary,
  stageSizeLabel,
  wallRange,
} from "./model";
import { DEFAULTS, type LithophaneSettings } from "./settings";

const settings = (patch: Partial<LithophaneSettings> = {}): LithophaneSettings => ({ ...DEFAULTS, ...patch });

function ramp(width: number, height: number): ScalarField {
  const values = new Float32Array(width * height);
  for (let i = 0; i < values.length; i++) values[i] = i;
  return { width, height, values };
}

describe("fitKeyFor (FIXES L2)", () => {
  it("changes with the shape kind and physical size only", () => {
    const base = fitKeyFor(settings());
    expect(fitKeyFor(settings({ minThickness: 1.2, brightness: 40, imageX: 20 }))).toBe(base);
    expect(fitKeyFor(settings({ sphereDiameter: 140 }))).not.toBe(base);
    expect(fitKeyFor(settings({ shape: "crescent" }))).toBe("flat:100×100");
    expect(fitKeyFor(settings({ shape: "heart" }))).toBe("flat:100×100");
    expect(fitKeyFor(settings({ shape: "heart", width: 120 }))).toBe("flat:120×100");
  });
});

describe("buildMeshJob", () => {
  it("builds a sphere job with the effective thickness range and the field as sampled", () => {
    const field = ramp(4, 3);
    const job = buildMeshJob(settings({ minThickness: 2, maxThickness: 1.5, thicknessGamma: 1.4 }), field, null);
    expect(job.kind).toBe("sphere");
    if (job.kind !== "sphere") return;
    expect(job.mapping).toEqual({ minThickness: 2, maxThickness: 2.1, gamma: 1.4 });
    expect(job.diameterMm).toBe(DEFAULTS.sphereDiameter);
    expect(job.openingDeg).toBe(DEFAULTS.sphereOpening);
    // renderGrid and buildSphereMesh agree on the columns (C/2 faces the front), so nothing is rolled.
    expect(job.luminance).toBe(field);
    expect(sphereColumnTheta(2, 4)).toBe(0);
  });

  it("maps the crescent controls onto the builder's shape parameters", () => {
    const job = buildMeshJob(
      settings({ shape: "crescent", width: 90, height: 70, base: 1.2, moonOffsetX: 0.2, moonOffsetY: -0.1, moonRotation: 30 }),
      ramp(3, 3),
      null,
    );
    expect(job.kind).toBe("flat");
    if (job.kind !== "flat") return;
    expect(job).toMatchObject({ widthMm: 90, heightMm: 70, baseMm: 1.2 });
    expect(job.shape).toMatchObject({ shape: "crescent", offsetX: 0.2, offsetY: -0.1, rotationDeg: 30, mask: null });
  });

  it("passes the mask and threshold only for the custom shape (FIXES G3)", () => {
    const mask: CoverageMask = { width: 2, height: 2, values: new Float32Array([1, 0, 0, 1]) };
    const custom = buildMeshJob(settings({ shape: "custom", maskThreshold: 0.35 }), ramp(3, 3), mask);
    const heart = buildMeshJob(settings({ shape: "heart" }), ramp(3, 3), mask);
    expect(custom.kind === "flat" && custom.shape.mask).toBe(mask);
    expect(custom.kind === "flat" && custom.shape.maskThreshold).toBe(0.35);
    expect(heart.kind === "flat" && heart.shape.mask).toBeNull();
  });
});

describe("domainFor", () => {
  it("describes the sphere by its opening and flat pieces by size and shape", () => {
    expect(domainFor(settings({ sphereOpening: 30 }), null)).toEqual({ kind: "sphere", openingDeg: 30 });
    const mask: CoverageMask = { width: 1, height: 1, values: new Float32Array([1]) };
    const flat = domainFor(settings({ shape: "custom", width: 120, height: 80 }), mask);
    expect(flat.kind === "flat" && flat.widthMm).toBe(120);
    expect(flat.kind === "flat" && flat.shape.mask).toBe(mask);
    const crescent = domainFor(settings({ shape: "crescent", moonRotation: 20 }), mask);
    expect(crescent.kind === "flat" && crescent.shape).toMatchObject({ shape: "crescent", rotationDeg: 20, mask: null });
  });
});

describe("labels and sizes", () => {
  it("describes the wall range the viewer's backlight expects", () => {
    expect(wallRange(settings())).toEqual({ min: 0.8, max: 3 });
    const flat = wallRange(settings({ shape: "circle" }));
    expect(flat.min).toBeCloseTo(1.6);
    expect(flat.max).toBeCloseTo(3.8);
  });

  it("formats summaries and chips", () => {
    expect(formSummary(settings())).toBe("Sphere · Ø 120 mm");
    expect(formSummary(settings({ shape: "crescent" }))).toBe("Crescent · 100 × 100 mm");
    expect(stageSizeLabel(settings())).toBe("Sphere · Ø 120 mm");
    expect(stageSizeLabel(settings({ shape: "crescent" }))).toBe("Crescent · 100 × 100 × 3.8 mm");
    expect(exportSizeLabel(settings())).toBe("Ø 126 mm");
    expect(exportSizeLabel(settings({ shape: "square", width: 80, height: 60 }))).toBe("80 × 60 × 3.8 mm");
  });

  it("names downloads after the photo and the shape (FIXES L19)", () => {
    expect(exportFileName("My Holiday Photo.JPG", "crescent")).toBe("My-Holiday-Photo_crescent_lithophane.stl");
    expect(exportFileName(null, "sphere")).toBe("moon_sphere_lithophane.stl");
    expect(exportFileName("???.png", "heart")).toBe("photo_heart_lithophane.stl");
  });
});
