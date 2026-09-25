import { describe, expect, it } from "vitest";
import { checkManifold } from "./manifold";
import { buildSphereMesh } from "./sphere";
import { field, orientationErrors, randomField, signedVolume } from "./test-helpers";

describe("buildSphereMesh", () => {
  it("is watertight with a closed top pole and outward normals (FIXES G1)", () => {
    const heights = field(24, 13, (x, y) => 0.8 + ((x * 5 + y * 3) % 7) * 0.3);
    const mesh = buildSphereMesh({ heights, diameterMm: 80, openingDeg: 22, withUvs: true, withThickness: true });
    expect(checkManifold(mesh)).toEqual({ watertight: true, boundaryEdges: 0, nonManifoldEdges: 0, degenerateTriangles: 0 });
    expect(orientationErrors(mesh)).toBe(0);
    expect(signedVolume(mesh)).toBeGreaterThan(0);
    const vertices = 2 * (1 + 12 * 24);
    expect(mesh.positions.length).toBe(vertices * 3);
    expect(mesh.indices.length / 3).toBe(4 * 24 * 12);
    expect(mesh.uvs?.length).toBe(vertices * 2);
    expect(mesh.thickness?.length).toBe(vertices);
    expect(mesh.activeCells).toBe(24 * 12);
  });

  it("puts one vertex per surface on +Y: inner radius and inner radius + mean row-0 thickness", () => {
    const heights = field(8, 5, (x, y) => (y === 0 ? 1 + x * 0.25 : 2));
    const mesh = buildSphereMesh({ heights, diameterMm: 100, openingDeg: 30 });
    const perSurface = 1 + 4 * 8;
    const meanRow0 = (1 + (1 + 7 * 0.25)) / 2;
    expect(Array.from(mesh.positions.slice(0, 3))).toEqual([0, Math.fround(50 + meanRow0), 0]);
    expect(Array.from(mesh.positions.slice(perSurface * 3, perSurface * 3 + 3))).toEqual([0, 50, 0]);
  });

  it("uses the point mapping [r sinφ sinθ, r cosφ, r sinφ cosθ] with θ = 2π(c/C − ½) and the bottom opening angle", () => {
    const heights = field(4, 3, () => 2);
    const mesh = buildSphereMesh({ heights, diameterMm: 100, openingDeg: 30 });
    const phi = (150 * Math.PI) / 180;
    // Last outer ring (φ = 150°), r = 52. Column 3 → θ = +90° (+X), column 1 → θ = −90° (−X).
    const right = 1 + (2 - 1) * 4 + 3;
    expect(mesh.positions[right * 3]).toBeCloseTo(52 * Math.sin(phi), 4);
    expect(mesh.positions[right * 3 + 1]).toBeCloseTo(52 * Math.cos(phi), 4);
    expect(mesh.positions[right * 3 + 2]).toBeCloseTo(0, 4);
    const left = 1 + (2 - 1) * 4 + 1;
    expect(mesh.positions[left * 3]).toBeCloseTo(-52 * Math.sin(phi), 4);
    expect(mesh.positions[left * 3 + 2]).toBeCloseTo(0, 4);
    // Column 0 → θ = −180°: the seam is at the back.
    const back = 1 + (2 - 1) * 4;
    expect(mesh.positions[back * 3]).toBeCloseTo(0, 4);
    expect(mesh.positions[back * 3 + 2]).toBeCloseTo(-52 * Math.sin(phi), 4);
  });

  it("faces the centre column towards the viewer (+Z) on the equator", () => {
    // openingDeg 30 → polar angle y/5 · 150°; row 3 is the equator.
    const C = 16;
    const heights = field(C, 6, () => 2);
    const mesh = buildSphereMesh({ heights, diameterMm: 100, openingDeg: 30, withUvs: true });
    const k = 1 + (3 - 1) * C + C / 2;
    expect(mesh.positions[k * 3]).toBeCloseTo(0, 4);
    expect(mesh.positions[k * 3 + 1]).toBeCloseTo(0, 4);
    expect(mesh.positions[k * 3 + 2]).toBeCloseTo(52, 4);
    // The column just right of the centre is on the viewer's right (+X); u = 0.5 at the front.
    expect(mesh.positions[(k + 1) * 3]).toBeGreaterThan(0);
    expect(mesh.positions[(k - 1) * 3]).toBeLessThan(0);
    expect(mesh.uvs?.[k * 2]).toBeCloseTo(0.5, 6);
    // The seam (column 0 → C − 1) is behind the globe.
    const seam = 1 + (3 - 1) * C;
    expect(mesh.positions[seam * 3 + 2]).toBeLessThan(0);
    expect(mesh.positions[(seam + C - 1) * 3 + 2]).toBeLessThan(0);
  });

  it("encloses the analytic shell volume for constant thickness", () => {
    const t = 3;
    const heights = field(128, 65, () => t);
    const mesh = buildSphereMesh({ heights, diameterMm: 120, openingDeg: 22 });
    const ri = 60;
    const ro = ri + t;
    const phiMax = Math.PI - (22 * Math.PI) / 180;
    const exact = ((2 * Math.PI) / 3) * (ro ** 3 - ri ** 3) * (1 - Math.cos(phiMax));
    const v = signedVolume(mesh);
    expect(v).toBeGreaterThan(0);
    expect(Math.abs(v - exact) / exact).toBeLessThan(0.01);
  });

  it("stays watertight with noisy relief", () => {
    const mesh = buildSphereMesh({ heights: randomField(31, 17, 3), diameterMm: 60, openingDeg: 8 });
    expect(checkManifold(mesh).watertight).toBe(true);
    expect(orientationErrors(mesh)).toBe(0);
  });

  it("rejects invalid input", () => {
    const heights = field(8, 5, () => 1);
    expect(() => buildSphereMesh({ heights, diameterMm: 0, openingDeg: 20 })).toThrow(/diameter/);
    expect(() => buildSphereMesh({ heights, diameterMm: 100, openingDeg: 0 })).toThrow(/opening/);
    expect(() => buildSphereMesh({ heights: field(2, 5, () => 1), diameterMm: 100, openingDeg: 20 })).toThrow(/at least/);
  });
});
