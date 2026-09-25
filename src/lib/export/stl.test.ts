import { describe, expect, it } from "vitest";
import { buildFlatJob } from "@/lib/geometry/jobs";
import { randomField } from "@/lib/geometry/test-helpers";
import type { MeshData } from "@/lib/geometry/types";
import { BINARY_STL_HEADER, writeAsciiStl, writeBinaryStl } from "./stl";
import { formatNumber } from "./text";

function sampleMesh(): MeshData {
  return buildFlatJob({
    kind: "flat",
    luminance: randomField(21, 15, 2),
    mapping: { minThickness: 0.8, maxThickness: 3, gamma: 1 },
    widthMm: 80,
    heightMm: 60,
    baseMm: 0.6,
    shape: {
      shape: "heart",
      crescent: 0.4,
      outerRadius: 0.95,
      innerRadius: 0.82,
      offsetX: 0,
      offsetY: 0,
      rotationDeg: 0,
    },
  });
}

describe("writeBinaryStl", () => {
  it("writes 84 + 50·triangles bytes with an ASCII header that does not start with 'solid' (FIXES G12)", () => {
    const mesh = sampleMesh();
    const tris = mesh.indices.length / 3;
    const buffer = writeBinaryStl(mesh);
    expect(buffer.byteLength).toBe(84 + 50 * tris);
    const header = new Uint8Array(buffer, 0, 80);
    const text = String.fromCharCode(...header);
    expect(text.startsWith("solid")).toBe(false);
    expect(text.startsWith(BINARY_STL_HEADER)).toBe(true);
    expect(header.every((b) => b < 128)).toBe(true);
    expect(header.slice(BINARY_STL_HEADER.length).every((b) => b === 0)).toBe(true);
    const view = new DataView(buffer);
    expect(view.getUint32(80, true)).toBe(tris);
  });

  it("stores unit normals and the exact vertex coordinates", () => {
    const mesh = sampleMesh();
    const view = new DataView(writeBinaryStl(mesh));
    for (const f of [0, 7, mesh.indices.length / 3 - 1]) {
      const o = 84 + f * 50;
      const n = [view.getFloat32(o, true), view.getFloat32(o + 4, true), view.getFloat32(o + 8, true)];
      expect(Math.hypot(...n)).toBeCloseTo(1, 5);
      for (let j = 0; j < 3; j++) {
        const v = mesh.indices[f * 3 + j];
        for (let k = 0; k < 3; k++) {
          expect(view.getFloat32(o + 12 + j * 12 + k * 4, true)).toBe(mesh.positions[v * 3 + k]);
        }
      }
      expect(view.getUint16(o + 48, true)).toBe(0);
    }
  });

  it("writes a zero normal for degenerate faces", () => {
    const mesh = { positions: new Float32Array([0, 0, 0, 1, 0, 0, 2, 0, 0]), indices: new Uint32Array([0, 1, 2]) };
    const view = new DataView(writeBinaryStl(mesh));
    expect([view.getFloat32(84, true), view.getFloat32(88, true), view.getFloat32(92, true)]).toEqual([0, 0, 0]);
  });
});

describe("writeAsciiStl", () => {
  it("parses back to the same triangles", () => {
    const mesh = sampleMesh();
    const text = new TextDecoder().decode(writeAsciiStl(mesh, "My lamp: v2"));
    const lines = text.trim().split("\n").map((l) => l.trim());
    expect(lines[0]).toBe("solid My_lamp:_v2");
    expect(lines[lines.length - 1]).toBe("endsolid My_lamp:_v2");
    const facets = lines.filter((l) => l.startsWith("facet normal"));
    const vertices = lines.filter((l) => l.startsWith("vertex "));
    expect(facets.length).toBe(mesh.indices.length / 3);
    expect(vertices.length).toBe(mesh.indices.length);
    expect(lines.filter((l) => l === "outer loop").length).toBe(facets.length);
    expect(lines.filter((l) => l === "endfacet").length).toBe(facets.length);
    // Coordinates round-trip to 6 significant digits.
    const first = vertices[0].split(/\s+/).slice(1).map(Number);
    const v0 = mesh.indices[0];
    for (let k = 0; k < 3; k++) {
      const expected = mesh.positions[v0 * 3 + k];
      expect(Math.abs(first[k] - expected)).toBeLessThanOrEqual(Math.max(1e-9, Math.abs(expected) * 1e-5));
    }
    for (const l of [...facets, ...vertices]) {
      for (const token of l.split(/\s+/).slice(l.startsWith("facet") ? 2 : 1)) expect(Number.isFinite(Number(token))).toBe(true);
    }
  });

  it("falls back to a default solid name", () => {
    const mesh = { positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]), indices: new Uint32Array([0, 1, 2]) };
    const text = new TextDecoder().decode(writeAsciiStl(mesh, "   "));
    expect(text.startsWith("solid luna_litho\n")).toBe(true);
    expect(text).toContain("facet normal 0 0 1\n");
  });
});

describe("formatNumber", () => {
  it("keeps 6 significant digits without trailing zeros", () => {
    expect(formatNumber(12.5)).toBe("12.5");
    expect(formatNumber(-0)).toBe("0");
    expect(formatNumber(1 / 3)).toBe("0.333333");
    expect(formatNumber(123.456789)).toBe("123.457");
    expect(formatNumber(100)).toBe("100");
    expect(formatNumber(1e-7)).toBe("1e-7");
    expect(Number(formatNumber(-2.5e-9))).toBe(-2.5e-9);
  });
});
