import type { MeshData } from "@/lib/geometry/types";
import { formatNumber, TextFileWriter } from "./text";
import { writeZip, type ZipOptions } from "./zip";

/** One part of a multi-material AMF. `color` is rgb 0..1. */
export interface AmfVolume {
  mesh: MeshData;
  name: string;
  color: [number, number, number];
}

/** Escape text for XML element content and attribute values; drops characters XML 1.0 cannot represent. */
export function escapeXml(text: string): string {
  return text
    .replace(/[^\t\n\r\x20-퟿-�\u{10000}-\u{10FFFF}]/gu, "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

const channel = (c: number) => formatNumber(Math.min(1, Math.max(0, Number.isFinite(c) ? c : 0)));

/**
 * One <object> with a shared <vertices> list and one <volume> per part, each with its own <material>.
 * Volumes without triangles are skipped. Material ids start at 1 (0 is reserved for void).
 */
export function writeAmf(volumes: AmfVolume[], objectName: string): ArrayBuffer {
  const parts = volumes.filter((v) => v.mesh.indices.length >= 3);
  const writer = new TextFileWriter();
  const title = escapeXml(objectName);
  writer.write('<?xml version="1.0" encoding="UTF-8"?>\n');
  writer.write('<amf unit="millimeter" version="1.1">\n');
  writer.write(`  <metadata type="name">${title}</metadata>\n`);
  writer.write('  <metadata type="cad">Luna Litho Studio</metadata>\n');
  parts.forEach((part, i) => {
    const [r, g, b] = part.color;
    writer.write(
      `  <material id="${i + 1}">\n    <metadata type="name">${escapeXml(part.name)}</metadata>\n` +
        `    <color><r>${channel(r)}</r><g>${channel(g)}</g><b>${channel(b)}</b></color>\n  </material>\n`,
    );
  });
  writer.write(`  <object id="1">\n    <metadata type="name">${title}</metadata>\n    <mesh>\n      <vertices>\n`);
  for (const part of parts) {
    const p = part.mesh.positions;
    const count = Math.floor(p.length / 3);
    for (let v = 0; v < count; v++) {
      writer.write(
        `        <vertex><coordinates><x>${formatNumber(p[v * 3])}</x><y>${formatNumber(p[v * 3 + 1])}</y>` +
          `<z>${formatNumber(p[v * 3 + 2])}</z></coordinates></vertex>\n`,
      );
    }
  }
  writer.write("      </vertices>\n");
  let vertexOffset = 0;
  parts.forEach((part, i) => {
    const idx = part.mesh.indices;
    writer.write(`      <volume materialid="${i + 1}">\n        <metadata type="name">${escapeXml(part.name)}</metadata>\n`);
    const faces = Math.floor(idx.length / 3);
    for (let f = 0; f < faces; f++) {
      writer.write(
        `        <triangle><v1>${idx[f * 3] + vertexOffset}</v1><v2>${idx[f * 3 + 1] + vertexOffset}</v2>` +
          `<v3>${idx[f * 3 + 2] + vertexOffset}</v3></triangle>\n`,
      );
    }
    writer.write("      </volume>\n");
    vertexOffset += Math.floor(part.mesh.positions.length / 3);
  });
  writer.write("    </mesh>\n  </object>\n</amf>\n");
  return writer.finish();
}

/** Longest entry-name stem kept inside a zipped AMF (in code points). */
const MAX_ENTRY_STEM = 100;

/** Name of the XML entry inside a zipped AMF: the object name as a file name ("Luna keychain" → "Luna keychain.amf"). */
export function amfEntryName(objectName: string): string {
  const cleaned = objectName
    // Path separators and characters that Windows file names reject.
    .replace(/[\u0000-\u001f\u007f\\/:*?"<>|]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^\.+|\.+$/g, "");
  const stem = Array.from(cleaned).slice(0, MAX_ENTRY_STEM).join("").trim();
  return `${stem || "model"}.amf`;
}

/**
 * {@link writeAmf} packaged as a ZIP archive holding one XML entry — the form PrusaSlicer writes, and whose
 * reader (shared by Bambu Studio and OrcaSlicer) recognises a .amf starting with "PK". The entry is
 * DEFLATE-compressed where the runtime supports it (keychain XML shrinks about 15×) and STORED otherwise.
 */
export async function writeZippedAmf(volumes: AmfVolume[], objectName: string, options?: ZipOptions): Promise<ArrayBuffer> {
  const xml = new Uint8Array(writeAmf(volumes, objectName));
  return writeZip([{ name: amfEntryName(objectName), data: xml }], options);
}
