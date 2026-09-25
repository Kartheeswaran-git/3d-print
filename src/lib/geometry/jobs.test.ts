import { describe, expect, it } from "vitest";
import type { FlatJob, KeychainJob, SphereJob } from "@/lib/worker/protocol";
import { buildFlatJob, buildKeychainParts, buildKeychainSolid, buildSphereJob } from "./jobs";
import { checkManifold } from "./manifold";
import { computeBounds } from "./stats";
import { blobMask, field, orientationErrors, randomField, rng, signedVolume } from "./test-helpers";
import type { FlatShape, MeshData, ShapeParams } from "./types";

const MAPPING = { minThickness: 0.8, maxThickness: 3, gamma: 1 };

function flatJob(shape: FlatShape, overrides: Partial<ShapeParams> = {}, w = 49, h = 37): FlatJob {
  return {
    kind: "flat",
    luminance: randomField(w, h, 11),
    mapping: MAPPING,
    widthMm: 120,
    heightMm: 90,
    baseMm: 0.6,
    shape: {
      shape,
      crescent: 0.4,
      outerRadius: 0.95,
      innerRadius: 0.82,
      offsetX: 0.18,
      offsetY: -0.08,
      rotationDeg: 0,
      maskThreshold: 0.5,
      ...overrides,
    },
  };
}

function expectClosedOutward(mesh: MeshData) {
  expect(checkManifold(mesh)).toEqual({ watertight: true, boundaryEdges: 0, nonManifoldEdges: 0, degenerateTriangles: 0 });
  expect(orientationErrors(mesh)).toBe(0);
  expect(signedVolume(mesh)).toBeGreaterThan(0);
}

/** Soft-edged keychain-like plate: rounded bar with a ring and hole on the left, two "letters" as bars. */
function keychainJob(dpmm = 4): KeychainJob {
  const widthMm = 40;
  const heightMm = 14;
  const w = Math.round(widthMm * dpmm) + 1;
  const h = Math.round(heightMm * dpmm) + 1;
  const smooth = (d: number) => Math.min(1, Math.max(0, 0.5 - d * dpmm * 0.5));
  const base = field(w, h, (x, y) => {
    const X = x / dpmm, Y = y / dpmm;
    const ring = Math.hypot(X - 6, Y - 7) - 5.5;
    const hole = 2 - Math.hypot(X - 6, Y - 7);
    const bar = Math.max(Math.abs(X - 23) - 15, Math.abs(Y - 7) - 5);
    return Math.min(smooth(Math.min(ring, bar)), smooth(hole));
  });
  const r = rng(5);
  const text = field(w, h, (x, y) => {
    const X = x / dpmm, Y = y / dpmm;
    const l1 = Math.max(Math.abs(X - 17) - 1.2, Math.abs(Y - 7) - 3.5);
    const l2 = Math.max(Math.abs(X - 25) - 3, Math.abs(Y - 7) - 1);
    // A diagonal stroke produces corner-only contacts after thresholding.
    const l3 = Math.abs((X - 31) - (Y - 7)) / Math.SQRT2 - 0.35;
    const inBox = Math.abs(X - 31) < 3 && Math.abs(Y - 7) < 3;
    return Math.min(1, smooth(Math.min(l1, l2, inBox ? l3 : 99)) + r() * 0.02);
  });
  return {
    kind: "keychain",
    baseAlpha: base,
    textAlpha: text,
    widthMm,
    heightMm,
    baseThicknessMm: 2,
    textThicknessMm: 1.5,
    maskThreshold: 0.5,
  };
}

describe("buildFlatJob", () => {
  const cases: [string, FlatJob][] = [
    ["rectangle", flatJob("rectangle")],
    ["square", flatJob("square")],
    ["rounded", flatJob("rounded", { rotationDeg: 17 })],
    ["circle", flatJob("circle", { outerRadius: 1.1 })],
    ["crescent", flatJob("crescent")],
    ["crescent (thin tips, rotated)", flatJob("crescent", { crescent: 0.72, innerRadius: 0.95, rotationDeg: 33 }, 97, 81)],
    ["heart", flatJob("heart", { rotationDeg: -20 })],
    ["custom (blob mask)", flatJob("custom", { mask: blobMask(64, 48, 9) })],
    ["custom (salt noise mask)", flatJob("custom", { mask: randomField(50, 40, 21), maskThreshold: 0.5 })],
  ];
  for (const [label, job] of cases) {
    it(`${label} is watertight with outward normals`, () => {
      const mesh = buildFlatJob(job, { withUvs: true, withThickness: true });
      expectClosedOutward(mesh);
      const bounds = computeBounds(mesh.positions);
      expect(bounds.min[2]).toBe(0);
      expect(bounds.max[2]).toBeLessThanOrEqual(0.6 + 3 + 1e-5);
      expect(bounds.min[0]).toBeGreaterThanOrEqual(-60);
      expect(bounds.max[1]).toBeLessThanOrEqual(45);
      expect(mesh.uvs?.length).toBe((mesh.positions.length / 3) * 2);
      expect(mesh.thickness?.length).toBe(mesh.positions.length / 3);
    });
  }

  it("stays watertight across randomised shapes, sizes and masks", () => {
    const r = rng(2024);
    const shapes: FlatShape[] = ["crescent", "circle", "heart", "rounded", "square", "custom"];
    for (let i = 0; i < 40; i++) {
      const shape = shapes[i % shapes.length];
      const w = 8 + Math.floor(r() * 60);
      const h = 8 + Math.floor(r() * 60);
      const job = flatJob(
        shape,
        {
          crescent: 0.15 + r() * 0.57,
          outerRadius: 0.55 + r() * 0.6,
          innerRadius: 0.4 + r() * 0.75,
          offsetX: -0.6 + r() * 1.4,
          offsetY: -0.6 + r() * 1.2,
          rotationDeg: -180 + r() * 360,
          mask: i % 2 ? blobMask(10 + i, 12 + i, i) : randomField(9 + i, 7 + i, i),
          maskThreshold: 0.05 + r() * 0.9,
        },
        w,
        h,
      );
      job.widthMm = 20 + r() * 280;
      job.heightMm = 20 + r() * 280;
      let mesh: MeshData;
      try {
        mesh = buildFlatJob(job);
      } catch (error) {
        // A random configuration may legitimately leave nothing printable.
        expect(String(error)).toMatch(/no printable area/);
        continue;
      }
      expectClosedOutward(mesh);
    }
  });

  it("rectangle volume matches the height field (base + mean relief over each cell)", () => {
    const job = flatJob("rectangle", {}, 5, 4);
    job.luminance = field(5, 4, () => 0.5);
    const mesh = buildFlatJob(job);
    expect(signedVolume(mesh)).toBeCloseTo(120 * 90 * (0.6 + 0.8 + 0.5 * 2.2), 2);
  });

  it("throws a readable error for a custom shape without a mask, and for zero sizes (FIXES G8)", () => {
    expect(() => buildFlatJob(flatJob("custom", { mask: null }))).toThrow(/no printable area/);
    expect(() => buildFlatJob({ ...flatJob("circle"), widthMm: 0 })).toThrow(/greater than 0/);
    expect(() => buildFlatJob({ ...flatJob("circle"), luminance: field(1, 1, () => 0) })).toThrow(/at least 2 × 2/);
  });
});

describe("outline snapping wiring (REVIEW R3)", () => {
  /** Largest |distance − radius| of the wall vertices, in cells, for a disc of `radiusMm` centred on the piece. */
  function worstRadiusError(mesh: MeshData, radiusMm: number, cellMm: number): number {
    const half = mesh.positions.length / 6;
    let worst = 0;
    for (let t = 0; t < mesh.indices.length; t += 3) {
      const tri = [mesh.indices[t], mesh.indices[t + 1], mesh.indices[t + 2]];
      if (!tri.some((i) => i < half) || !tri.some((i) => i >= half)) continue; // walls only
      for (const i of tri) {
        const r = Math.hypot(mesh.positions[i * 3], mesh.positions[i * 3 + 1]);
        worst = Math.max(worst, Math.abs(r - radiusMm) / cellMm);
      }
    }
    return worst;
  }

  it("flat shapes and custom masks follow the true outline", () => {
    // 120 × 90 mm on a 97 × 73 grid: 1.25 mm cells; circle radius 0.8 · 45 = 36 mm.
    const circle = buildFlatJob(flatJob("circle", { outerRadius: 0.8 }, 97, 73));
    expectClosedOutward(circle);
    expect(worstRadiusError(circle, 36, 1.25)).toBeLessThan(0.1);
    // A 30 mm disc as a soft-edged coverage mask (0.47 mm pixels, like the app's 512 px masks): the outline
    // follows the bilinear iso-line instead of the nearest-pixel staircase the cells are sampled from.
    const mask = field(256, 192, (x, y) => {
      const d = Math.hypot((x / 255) * 120 - 60, (y / 191) * 90 - 45);
      return Math.min(1, Math.max(0, 0.5 + (30 - d) / 0.5));
    });
    const custom = buildFlatJob(flatJob("custom", { mask }, 97, 73));
    expectClosedOutward(custom);
    expect(worstRadiusError(custom, 30, 1.25)).toBeLessThan(0.15);
  });

  it("keychain parts snap to their coverage contour", () => {
    const job = keychainJob();
    const { base, text } = buildKeychainParts(job);
    const solid = buildKeychainSolid(job);
    for (const mesh of [base, text, solid]) {
      if (!mesh) continue;
      expectClosedOutward(mesh);
      // Grid points sit on multiples of 0.25 mm (4 samples / mm); snapped outline points don't.
      const offGrid = Array.from(mesh.positions).filter((v, i) => i % 3 !== 2 && Math.abs(v * 4 - Math.round(v * 4)) > 1e-3);
      expect(offGrid.length).toBeGreaterThan(20);
    }
  });
});

describe("buildSphereJob", () => {
  it("builds a watertight shell from luminance", () => {
    const job: SphereJob = { kind: "sphere", luminance: randomField(36, 19, 4), mapping: MAPPING, diameterMm: 120, openingDeg: 22 };
    const mesh = buildSphereJob(job, { withUvs: true, withThickness: true });
    expectClosedOutward(mesh);
    for (const t of mesh.thickness ?? []) {
      expect(t).toBeGreaterThanOrEqual(0.8 - 1e-6);
      expect(t).toBeLessThanOrEqual(3 + 1e-6);
    }
  });
});

describe("keychain builders", () => {
  it("base and text parts are each watertight; text sits on the base (FIXES G4, G6)", () => {
    const job = keychainJob();
    const { base, text } = buildKeychainParts(job, { withThickness: true });
    expectClosedOutward(base);
    expect(text).not.toBeNull();
    if (!text) return;
    expectClosedOutward(text);
    const b = computeBounds(base.positions);
    const t = computeBounds(text.positions);
    expect(b.min[2]).toBe(0);
    expect(b.max[2]).toBeLessThanOrEqual(2 + 1e-5);
    expect(t.min[2]).toBe(2);
    expect(t.max[2]).toBeLessThanOrEqual(3.5 + 1e-5);
    // Every text vertex is at least minHeight above its bottom (no zero-height walls).
    const half = text.positions.length / 6;
    for (let k = 0; k < half; k++) expect(text.positions[k * 3 + 2] - 2).toBeGreaterThanOrEqual(0.05 - 1e-6);
    expect(text.thickness?.length).toBe(text.positions.length / 3);
  });

  it("text is null when there are no glyph cells", () => {
    const job = keychainJob();
    job.textAlpha = field(job.textAlpha.width, job.textAlpha.height, () => 0);
    expect(buildKeychainParts(job).text).toBeNull();
  });

  it("the single-colour solid is watertight and as tall as base + text", () => {
    const job = keychainJob();
    const solid = buildKeychainSolid(job);
    expectClosedOutward(solid);
    const bounds = computeBounds(solid.positions);
    expect(bounds.max[2]).toBeGreaterThan(3);
    expect(bounds.max[2]).toBeLessThanOrEqual(3.5 + 1e-5);
    expect(bounds.max[0] - bounds.min[0]).toBeLessThanOrEqual(40 + 1e-4);
  });

  it("throws when the plate is empty", () => {
    const job = keychainJob();
    job.baseAlpha = field(job.baseAlpha.width, job.baseAlpha.height, () => 0);
    expect(() => buildKeychainParts(job)).toThrow(/no printable area/);
    expect(() => buildKeychainSolid(job)).toThrow(/no printable area/);
  });
});

describe("performance", () => {
  it("builds a 720 × 720 flat grid and a 720 × 361 sphere quickly", () => {
    const flat = flatJob("crescent", {}, 720, 720);
    let start = performance.now();
    const flatMesh = buildFlatJob(flat);
    const flatMs = performance.now() - start;
    expect(flatMesh.indices.length).toBeGreaterThan(0);

    const sphere: SphereJob = {
      kind: "sphere",
      luminance: randomField(720, 361, 8),
      mapping: MAPPING,
      diameterMm: 120,
      openingDeg: 22,
    };
    start = performance.now();
    const sphereMesh = buildSphereJob(sphere, { withUvs: true, withThickness: true });
    const sphereMs = performance.now() - start;
    expect(sphereMesh.indices.length / 3).toBe(4 * 720 * 360);

    start = performance.now();
    const report = checkManifold(flatMesh);
    const checkMs = performance.now() - start;
    expect(report.watertight).toBe(true);

    // Budget is ~2 s in the browser worker; keep generous headroom for slow CI machines.
    expect(flatMs).toBeLessThan(2000);
    expect(sphereMs).toBeLessThan(2000);
    expect(checkMs).toBeLessThan(2000);
  }, 30_000);
});
