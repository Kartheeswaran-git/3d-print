import { describe, expect, it } from "vitest";
import { buildFlatJob, buildSphereJob } from "@/lib/geometry";
import type { MeshBuildResult, ScalarField } from "@/lib/geometry/types";
import type { MeshJob } from "@/lib/worker/protocol";
import { estimateExportTriangles, estimateFileBytes, exportGrid, formatSamples, gridCells, previewGrid } from "./grid";
import { buildMeshJob } from "./model";
import { DEFAULTS, MAX_EXPORT_SAMPLES, PREVIEW_SAMPLES, SPHERE_PREVIEW_COLUMNS, type LithophaneSettings } from "./settings";

const settings = (patch: Partial<LithophaneSettings> = {}): LithophaneSettings => ({ ...DEFAULTS, ...patch });

/** A smooth test image so the relief is non-trivial but deterministic. */
function field(width: number, height: number): ScalarField {
  const values = new Float32Array(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      values[y * width + x] = 0.5 + 0.4 * Math.sin((x / width) * 6) * Math.cos((y / height) * 5);
    }
  }
  return { width, height, values };
}

function build(job: MeshJob): MeshBuildResult {
  if (job.kind === "sphere") return buildSphereJob(job);
  if (job.kind === "flat") return buildFlatJob(job);
  throw new Error("unexpected job");
}

describe("exportGrid", () => {
  it("caps the default sphere at 720 columns with rows = columns / 2 + 1", () => {
    expect(exportGrid(settings())).toEqual({ width: 720, height: 361, capped: true });
  });

  it("uses π·D / resolution columns when under the cap", () => {
    const g = exportGrid(settings({ sphereDiameter: 60, resolution: 0.3 }));
    expect(g).toEqual({ width: 628, height: 315, capped: false });
  });

  it("samples flat pieces at the resolution, grid points = size / res + 1", () => {
    expect(exportGrid(settings({ shape: "crescent" }))).toEqual({ width: 668, height: 668, capped: false });
  });

  it("scales flat grids so the longest side is at most 720", () => {
    const g = exportGrid(settings({ shape: "rectangle", width: 300, height: 100, resolution: 0.1 }));
    expect(g).toEqual({ width: MAX_EXPORT_SAMPLES, height: 240, capped: true });
  });
});

describe("previewGrid", () => {
  it("uses 480 × 241 for the sphere", () => {
    expect(SPHERE_PREVIEW_COLUMNS).toBe(480);
    expect(previewGrid(settings())).toEqual({ width: 480, height: 241 });
  });

  it("puts 320 samples on the longest side with square cells", () => {
    expect(PREVIEW_SAMPLES).toBe(320);
    expect(previewGrid(settings({ shape: "heart", width: 100, height: 100 }))).toEqual({ width: 320, height: 320 });
    expect(previewGrid(settings({ shape: "heart", width: 100, height: 50 }))).toEqual({ width: 320, height: 161 });
    expect(previewGrid(settings({ shape: "heart", width: 60, height: 120 }))).toEqual({ width: 161, height: 320 });
  });

  it("is never finer than the export grid", () => {
    const s = settings({ shape: "square", width: 20, height: 20, resolution: 0.3 });
    expect(previewGrid(s)).toEqual({ width: 68, height: 68 });
    expect(exportGrid(s)).toMatchObject({ width: 68, height: 68 });
  });
});

describe("estimateExportTriangles", () => {
  it("is exact for the sphere (every quad is 4 triangles across both surfaces)", () => {
    const s = settings({ sphereDiameter: 60, resolution: 0.3 });
    const from = previewGrid(s);
    const to = exportGrid(s);
    const preview = build(buildMeshJob(s, field(from.width, from.height), null));
    const full = build(buildMeshJob(s, field(to.width, to.height), null));
    const estimate = estimateExportTriangles(
      { triangles: preview.indices.length / 3, activeCells: preview.activeCells },
      "sphere",
      from,
      to,
    );
    expect(preview.activeCells).toBe(gridCells("sphere", from));
    expect(estimate).toBe(full.indices.length / 3);
  });

  it.each(["crescent", "heart", "circle", "rectangle"] as const)("is within 3%% of the real %s export", (shape) => {
    const s = settings({ shape, width: 100, height: 80, resolution: 0.3 });
    const from = previewGrid(s);
    const to = exportGrid(s);
    const preview = build(buildMeshJob(s, field(from.width, from.height), null));
    const full = build(buildMeshJob(s, field(to.width, to.height), null));
    const estimate = estimateExportTriangles(
      { triangles: preview.indices.length / 3, activeCells: preview.activeCells },
      "flat",
      from,
      to,
    );
    const actual = full.indices.length / 3;
    expect(Math.abs(estimate - actual) / actual).toBeLessThan(0.03);
  });

  it("returns 0 without a printable preview", () => {
    expect(estimateExportTriangles({ triangles: 0, activeCells: 0 }, "flat", { width: 10, height: 10 }, { width: 20, height: 20 })).toBe(0);
  });
});

describe("estimateFileBytes / formatSamples", () => {
  it("uses the binary STL layout and ~5× for ASCII", () => {
    expect(estimateFileBytes(1000, "stl-binary")).toBe(84 + 50_000);
    expect(estimateFileBytes(1000, "stl-ascii")).toBe((84 + 50_000) * 5);
  });

  it("formats sample grids", () => {
    expect(formatSamples({ width: 720, height: 361 })).toBe("720 × 361 samples");
  });
});
