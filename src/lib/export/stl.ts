import type { MeshData } from "@/lib/geometry/types";
import { faceNormal, formatNumber, TextFileWriter } from "./text";

/** ASCII-only binary header; must not start with "solid" or loaders mistake the file for ASCII STL (FIXES G12). */
export const BINARY_STL_HEADER = "Luna Litho binary STL";

/** Binary STL: 80-byte header, uint32 facet count, then 50 bytes per facet (normal, 3 vertices, attribute). */
export function writeBinaryStl(mesh: MeshData): ArrayBuffer {
  const { positions, indices } = mesh;
  const faces = Math.floor(indices.length / 3);
  const out = new ArrayBuffer(84 + faces * 50);
  const bytes = new Uint8Array(out);
  for (let i = 0; i < BINARY_STL_HEADER.length; i++) bytes[i] = BINARY_STL_HEADER.charCodeAt(i) & 0x7f;
  const view = new DataView(out);
  view.setUint32(80, faces, true);
  const n = new Float64Array(3);
  const putVertex = (offset: number, v: number) => {
    const p = v * 3;
    view.setFloat32(offset, positions[p], true);
    view.setFloat32(offset + 4, positions[p + 1], true);
    view.setFloat32(offset + 8, positions[p + 2], true);
  };
  for (let f = 0, offset = 84; f < faces; f++, offset += 50) {
    const a = indices[f * 3];
    const b = indices[f * 3 + 1];
    const c = indices[f * 3 + 2];
    faceNormal(positions, a, b, c, n);
    view.setFloat32(offset, n[0], true);
    view.setFloat32(offset + 4, n[1], true);
    view.setFloat32(offset + 8, n[2], true);
    putVertex(offset + 12, a);
    putVertex(offset + 24, b);
    putVertex(offset + 36, c);
    // The 2-byte attribute count at offset + 48 stays 0.
  }
  return out;
}

/** STL solid names are a single whitespace-free ASCII token. */
function solidName(name: string): string {
  const cleaned = name.replace(/[^\x21-\x7e]+/g, "_").replace(/^_+|_+$/g, "");
  return cleaned || "luna_litho";
}

/**
 * ASCII STL with 6-significant-digit coordinates (FIXES G11). Degenerate faces keep a `0 0 0` normal;
 * they are reported by checkManifold.
 */
export function writeAsciiStl(mesh: MeshData, name: string): ArrayBuffer {
  const { positions, indices } = mesh;
  const faces = Math.floor(indices.length / 3);
  const solid = solidName(name);
  const writer = new TextFileWriter();
  const n = new Float64Array(3);
  const vertex = (v: number) =>
    `      vertex ${formatNumber(positions[v * 3])} ${formatNumber(positions[v * 3 + 1])} ${formatNumber(positions[v * 3 + 2])}\n`;
  writer.write(`solid ${solid}\n`);
  for (let f = 0; f < faces; f++) {
    const a = indices[f * 3];
    const b = indices[f * 3 + 1];
    const c = indices[f * 3 + 2];
    faceNormal(positions, a, b, c, n);
    writer.write(
      `  facet normal ${formatNumber(n[0])} ${formatNumber(n[1])} ${formatNumber(n[2])}\n    outer loop\n` +
        vertex(a) +
        vertex(b) +
        vertex(c) +
        "    endloop\n  endfacet\n",
    );
  }
  writer.write(`endsolid ${solid}\n`);
  return writer.finish();
}
