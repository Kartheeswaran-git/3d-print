import { describe, expect, it } from "vitest";
import { DEMO_PLATE_THICKNESS, makeDemoPlate } from "./demo-mesh";

describe("makeDemoPlate", () => {
  const part = makeDemoPlate();
  const vertexCount = part.positions.length / 3;

  it("returns consistent typed arrays", () => {
    expect(part.indices.length % 3).toBe(0);
    expect(part.uvs?.length).toBe(vertexCount * 2);
    expect(part.thickness?.length).toBe(vertexCount);
    let maxIndex = 0;
    for (const i of part.indices) maxIndex = Math.max(maxIndex, i);
    expect(maxIndex).toBeLessThan(vertexCount);
  });

  it("is a closed, consistently wound solid", () => {
    // Each directed edge appears once and its reverse once: watertight and oriented.
    const directed = new Map<number, number>();
    const idx = part.indices;
    for (let t = 0; t < idx.length; t += 3) {
      for (let e = 0; e < 3; e++) {
        const a = idx[t + e];
        const b = idx[t + ((e + 1) % 3)];
        const key = a * vertexCount + b;
        directed.set(key, (directed.get(key) ?? 0) + 1);
      }
    }
    for (const [key, count] of directed) {
      expect(count).toBe(1);
      const a = Math.floor(key / vertexCount);
      const b = key % vertexCount;
      expect(directed.get(b * vertexCount + a)).toBe(1);
    }
  });

  it("has outward normals (positive signed volume)", () => {
    const p = part.positions;
    const idx = part.indices;
    let volume = 0;
    for (let t = 0; t < idx.length; t += 3) {
      const a = idx[t] * 3;
      const b = idx[t + 1] * 3;
      const c = idx[t + 2] * 3;
      volume +=
        (p[a] * (p[b + 1] * p[c + 2] - p[b + 2] * p[c + 1]) -
          p[a + 1] * (p[b] * p[c + 2] - p[b + 2] * p[c]) +
          p[a + 2] * (p[b] * p[c + 1] - p[b + 1] * p[c])) /
        6;
    }
    expect(volume).toBeGreaterThan(0);
  });

  it("keeps wall thickness inside the advertised range", () => {
    for (const t of part.thickness ?? []) {
      expect(t).toBeGreaterThanOrEqual(DEMO_PLATE_THICKNESS.min - 1e-5);
      expect(t).toBeLessThanOrEqual(DEMO_PLATE_THICKNESS.max + 1e-5);
    }
  });
});
