/**
 * ZIP reader for the export and worker tests (not used by the app). Parses the archive from its end record,
 * checks every signature and that each local header agrees with its central directory record.
 */
import { ZIP_CENTRAL_HEADER_SIGNATURE, ZIP_DEFLATE, ZIP_END_SIGNATURE, ZIP_LOCAL_HEADER_SIGNATURE, ZIP_STORED } from "./zip";

export interface ZipRecord {
  name: string;
  flags: number;
  method: number;
  dosTime: number;
  dosDate: number;
  crc: number;
  compressedSize: number;
  size: number;
  localHeaderOffset: number;
  /** The entry's bytes as stored (still compressed for DEFLATE). */
  raw: Uint8Array<ArrayBuffer>;
}

export function readZip(buffer: ArrayBuffer): ZipRecord[] {
  const view = new DataView(buffer);
  const bytes = new Uint8Array(buffer);
  const decoder = new TextDecoder("utf-8", { fatal: true });
  const end = buffer.byteLength - 22;
  if (end < 0 || view.getUint32(end, true) !== ZIP_END_SIGNATURE) throw new Error("no end-of-central-directory record");
  const count = view.getUint16(end + 10, true);
  if (view.getUint16(end + 8, true) !== count) throw new Error("entry counts disagree");
  const centralSize = view.getUint32(end + 12, true);
  const centralStart = view.getUint32(end + 16, true);
  if (centralStart + centralSize !== end) throw new Error("central directory does not end at the end record");

  const records: ZipRecord[] = [];
  let p = centralStart;
  for (let i = 0; i < count; i++) {
    if (view.getUint32(p, true) !== ZIP_CENTRAL_HEADER_SIGNATURE) throw new Error(`bad central header ${i}`);
    const nameLength = view.getUint16(p + 28, true);
    const extraLength = view.getUint16(p + 30, true);
    const commentLength = view.getUint16(p + 32, true);
    const record = {
      name: decoder.decode(bytes.subarray(p + 46, p + 46 + nameLength)),
      flags: view.getUint16(p + 8, true),
      method: view.getUint16(p + 10, true),
      dosTime: view.getUint16(p + 12, true),
      dosDate: view.getUint16(p + 14, true),
      crc: view.getUint32(p + 16, true),
      compressedSize: view.getUint32(p + 20, true),
      size: view.getUint32(p + 24, true),
      localHeaderOffset: view.getUint32(p + 42, true),
    };
    const l = record.localHeaderOffset;
    if (view.getUint32(l, true) !== ZIP_LOCAL_HEADER_SIGNATURE) throw new Error(`bad local header ${i}`);
    const local = [6, 8, 10, 12, 14, 18, 22].map((o) => (o >= 14 ? view.getUint32(l + o, true) : view.getUint16(l + o, true)));
    const central = [record.flags, record.method, record.dosTime, record.dosDate, record.crc, record.compressedSize, record.size];
    if (local.join() !== central.join()) throw new Error(`local header ${i} disagrees with the central directory`);
    const localNameLength = view.getUint16(l + 26, true);
    const dataStart = l + 30 + localNameLength + view.getUint16(l + 28, true);
    if (decoder.decode(bytes.subarray(l + 30, l + 30 + localNameLength)) !== record.name) throw new Error(`name mismatch ${i}`);
    records.push({ ...record, raw: bytes.slice(dataStart, dataStart + record.compressedSize) });
    p += 46 + nameLength + extraLength + commentLength;
  }
  if (p !== end) throw new Error("central directory size mismatch");
  return records;
}

async function inflateRaw(data: Uint8Array<ArrayBuffer>): Promise<Uint8Array<ArrayBuffer>> {
  const stream = new Blob([data]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** An entry's uncompressed bytes (STORED or DEFLATE). */
export async function entryData(record: ZipRecord): Promise<Uint8Array<ArrayBuffer>> {
  if (record.method === ZIP_STORED) return record.raw;
  if (record.method === ZIP_DEFLATE) return inflateRaw(record.raw);
  throw new Error(`unsupported method ${record.method}`);
}
