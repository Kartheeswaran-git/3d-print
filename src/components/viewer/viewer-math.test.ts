import { describe, expect, it } from "vitest";
import { PerspectiveCamera, Vector3 } from "three";
import { buildPartGeometry, computeSceneBounds, glowRange, THICKNESS_ATTRIBUTE, UNKNOWN_THICKNESS } from "./geometry";
import { distanceLimits, easeInOutCubic, fitDecision, fitDistance, interpolatePose, viewDirection } from "./framing";
import { makeDemoPlate } from "./demo-mesh";
import type { CameraView, ViewerPart } from "./types";

function box(min: [number, number, number], max: [number, number, number], thickness?: number): ViewerPart {
  const positions = new Float32Array(8 * 3);
  for (let i = 0; i < 8; i++) {
    positions.set([i & 1 ? max[0] : min[0], i & 2 ? max[1] : min[1], i & 4 ? max[2] : min[2]], i * 3);
  }
  return {
    key: "box",
    role: "body",
    positions,
    indices: new Uint32Array([0, 1, 2]),
    thickness: thickness === undefined ? undefined : new Float32Array(8).fill(thickness),
    color: "#ffffff",
  };
}

describe("buildPartGeometry", () => {
  it("wraps the typed arrays without copying them", () => {
    const part = makeDemoPlate();
    const geometry = buildPartGeometry(part.positions, part.indices, part.uvs, part.thickness);
    expect(geometry.getAttribute("position").array).toBe(part.positions);
    expect(geometry.getIndex()?.array).toBe(part.indices);
    expect(geometry.getAttribute(THICKNESS_ATTRIBUTE).array).toBe(part.thickness);
    expect(geometry.getAttribute("normal").count).toBe(part.positions.length / 3);
    geometry.dispose();
  });

  it("marks missing thickness as unknown", () => {
    const part = box([0, 0, 0], [1, 1, 1]);
    const geometry = buildPartGeometry(part.positions, part.indices);
    const attr = geometry.getAttribute(THICKNESS_ATTRIBUTE);
    expect(attr.count).toBe(8);
    expect(attr.getX(3)).toBe(UNKNOWN_THICKNESS);
  });
});

describe("computeSceneBounds", () => {
  it("returns null without vertices", () => {
    expect(computeSceneBounds([])).toBeNull();
  });

  it("merges parts and classifies plates and shells", () => {
    const plate = computeSceneBounds([box([-50, -30, 0], [0, 30, 2], 1.5), box([0, -30, 0], [50, 30, 4], 3.5)]);
    expect(plate?.min.toArray()).toEqual([-50, -30, 0]);
    expect(plate?.max.toArray()).toEqual([50, 30, 4]);
    expect(plate?.center.toArray()).toEqual([0, 0, 2]);
    expect(plate?.radius).toBeCloseTo(Math.hypot(50, 30, 2), 5);
    expect(plate?.isPlate).toBe(true);
    expect(plate?.thickness).toEqual({ min: 1.5, max: 3.5 });

    const shell = computeSceneBounds([box([-60, -60, -60], [60, 60, 60])]);
    expect(shell?.isPlate).toBe(false);
    expect(shell?.thickness).toBeNull();
  });
});

describe("glowRange", () => {
  it("uses the requested range when the geometry fits it", () => {
    expect(glowRange({ minThickness: 0.8, maxThickness: 3 }, { min: 0.9, max: 2.9 })).toEqual({ min: 0.8, max: 3 });
  });

  it("shifts up when the geometry includes an unreported base", () => {
    const range = glowRange({ minThickness: 0.8, maxThickness: 3 }, { min: 1.6, max: 3.8 });
    expect(range.min).toBeCloseTo(1.6, 5);
    expect(range.max).toBeCloseTo(3.8, 5);
  });

  it("keeps a non-empty range", () => {
    const range = glowRange({ minThickness: 2, maxThickness: 1 }, null);
    expect(range.max).toBeGreaterThan(range.min);
  });
});

describe("fitDistance", () => {
  const views: CameraView[] = ["perspective", "front", "side", "top"];
  const aspects = [0.6, 1, 16 / 9];
  const cases = [
    computeSceneBounds([box([-50, -35, 0], [50, 35, 3.8])])!,
    computeSceneBounds([box([-62, -62, -62], [62, 62, 62])])!,
  ];

  it("keeps every bounding-box corner inside the frustum", () => {
    for (const bounds of cases) {
      for (const view of views) {
        for (const aspect of aspects) {
          const dir = viewDirection(view);
          const d = fitDistance(bounds, dir, 34, aspect);
          const camera = new PerspectiveCamera(34, aspect, 0.1, 10000);
          camera.position.copy(bounds.center).addScaledVector(dir, d);
          camera.lookAt(bounds.center);
          camera.updateMatrixWorld();
          for (let i = 0; i < 8; i++) {
            const corner = new Vector3(
              i & 1 ? bounds.max.x : bounds.min.x,
              i & 2 ? bounds.max.y : bounds.min.y,
              i & 4 ? bounds.max.z : bounds.min.z,
            );
            // Spheres only need the sphere inside the frustum, so test the sphere's extreme points there.
            if (!bounds.isPlate) corner.sub(bounds.center).setLength(bounds.radius).add(bounds.center);
            const ndc = corner.project(camera);
            expect(Math.abs(ndc.x)).toBeLessThanOrEqual(1);
            expect(Math.abs(ndc.y)).toBeLessThanOrEqual(1);
          }
        }
      }
    }
  });

  it("stays inside the orbit limits", () => {
    for (const bounds of cases) {
      const limits = distanceLimits(bounds);
      for (const view of views) {
        const d = fitDistance(bounds, viewDirection(view), 34, 1.5);
        expect(d).toBeGreaterThan(limits.min);
        expect(d).toBeLessThan(limits.max);
      }
    }
  });
});

describe("interpolatePose", () => {
  const from = { position: new Vector3(0, 0, 100), target: new Vector3(0, 0, 0) };
  const to = { position: new Vector3(210, 0, 10), target: new Vector3(10, 0, 10) };
  const out = { position: new Vector3(), target: new Vector3() };

  it("hits both endpoints", () => {
    interpolatePose(from, to, 0, out);
    expect(out.position.distanceTo(from.position)).toBeLessThan(1e-6);
    interpolatePose(from, to, 1, out);
    expect(out.position.distanceTo(to.position)).toBeLessThan(1e-6);
    expect(out.target.distanceTo(to.target)).toBeLessThan(1e-6);
  });

  it("orbits around the target instead of cutting through it", () => {
    for (let t = 0; t <= 1; t += 0.1) {
      interpolatePose(from, to, t, out);
      expect(out.position.distanceTo(out.target)).toBeGreaterThanOrEqual(99.99);
    }
  });

  it("eases symmetrically", () => {
    expect(easeInOutCubic(0)).toBe(0);
    expect(easeInOutCubic(1)).toBe(1);
    expect(easeInOutCubic(0.5)).toBeCloseTo(0.5, 10);
  });
});

describe("fitDecision", () => {
  it("frames the first mesh immediately", () => {
    expect(fitDecision(null, "sphere:120", true, true)).toBe("frame");
    expect(fitDecision(null, "sphere:120", false, false)).toBe("keep");
  });

  it("keeps the camera for relief, tone and colour updates", () => {
    expect(fitDecision("sphere:120", "sphere:120", true, true)).toBe("keep");
    expect(fitDecision("sphere:120", "sphere:120", true, false)).toBe("keep");
  });

  it("waits for the new mesh before framing a new fitKey", () => {
    expect(fitDecision("sphere:120", "sphere:160", true, false)).toBe("keep");
    expect(fitDecision("sphere:120", "sphere:160", true, true)).toBe("animate");
  });
});
