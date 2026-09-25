/**
 * Minimal ZIP writer (PKWARE APPNOTE): a local file header and the data for each entry, then the central
 * directory and the end record. No ZIP64, encryption or data descriptors — sizes and CRCs are known up front.
 * Names are UTF-8 (general-purpose flag bit 11) and every entry carries the same fixed DOS timestamp,
 * so identical input always produces identical bytes.
 */

export interface ZipEntry {
  /** Path inside the archive ("/"-separated). */
  name: string;
  data: Uint8Array<ArrayBuffer>;
}

export interface ZipOptions {
  /**
   * DEFLATE each entry with CompressionStream("deflate-raw") when the runtime has it (default true).
   * Entries are STORED when compression is off, unavailable, or would not make them smaller.
   */
  compress?: boolean;
}

export const ZIP_STORED = 0;
export const ZIP_DEFLATE = 8;

export const ZIP_LOCAL_HEADER_SIGNATURE = 0x04034b50;
export const ZIP_CENTRAL_HEADER_SIGNATURE = 0x02014b50;
export const ZIP_END_SIGNATURE = 0x06054b50;

const LOCAL_HEADER_SIZE = 30;
const CENTRAL_HEADER_SIZE = 46;
const END_RECORD_SIZE = 22;
/** "Version made by": spec 2.0 on MS-DOS, so the external attributes are plain DOS flags (0 = regular file). */
const VERSION_MADE_BY = 20;
const VERSION_STORED = 10;
const VERSION_DEFLATE = 20;
const FLAG_UTF8_NAMES = 0x0800;
/** 1980-01-01 00:00:00, the start of the DOS calendar: date = ((1980 − 1980) << 9) | (1 << 5) | 1, time = 0. */
const DOS_DATE = 0x0021;
const DOS_TIME = 0;
const MAX_UINT16 = 0xffff;
const MAX_UINT32 = 0xffffffff;

const TOO_LARGE_MESSAGE = "The file is too large to package. Try a smaller model or the STL format.";

let crcTable: Uint32Array | null = null;

function getCrcTable(): Uint32Array {
  if (crcTable) return crcTable;
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  crcTable = table;
  return table;
}

/** CRC-32 (IEEE 802.3, as ZIP and gzip use it). Pass the previous result as `crc` to continue over chunks. */
export function crc32(data: Uint8Array, crc = 0): number {
  const table = getCrcTable();
  let c = (crc ^ MAX_UINT32) >>> 0;
  for (let i = 0; i < data.length; i++) c = table[(c ^ data[i]) & 0xff] ^ (c >>> 8);
  return (c ^ MAX_UINT32) >>> 0;
}

/** Raw DEFLATE (RFC 1951) via CompressionStream; null when the runtime has no "deflate-raw" support. */
export async function deflateRaw(data: Uint8Array<ArrayBuffer>): Promise<Uint8Array<ArrayBuffer> | null> {
  if (typeof CompressionStream !== "function") return null;
  let stream: CompressionStream;
  try {
    stream = new CompressionStream("deflate-raw");
  } catch {
    // Older engines have CompressionStream but reject the "deflate-raw" format.
    return null;
  }
  const writer = stream.writable.getWriter();
  // Write and read concurrently: the readable side has to drain for the write to complete.
  const written = writer.write(data).then(() => writer.close());
  const [compressed] = await Promise.all([new Response(stream.readable).arrayBuffer(), written]);
  return new Uint8Array(compressed);
}

interface PackedEntry {
  name: Uint8Array;
  method: typeof ZIP_STORED | typeof ZIP_DEFLATE;
  crc: number;
  size: number;
  data: Uint8Array;
}

function assemble(entries: PackedEntry[]): ArrayBuffer {
  if (entries.length > MAX_UINT16) throw new Error(TOO_LARGE_MESSAGE);
  let localBytes = 0;
  let centralBytes = 0;
  for (const e of entries) {
    if (e.name.length > MAX_UINT16 || e.size > MAX_UINT32) throw new Error(TOO_LARGE_MESSAGE);
    localBytes += LOCAL_HEADER_SIZE + e.name.length + e.data.length;
    centralBytes += CENTRAL_HEADER_SIZE + e.name.length;
  }
  // Every offset and size in the records is 32-bit.
  if (localBytes + centralBytes > MAX_UINT32) throw new Error(TOO_LARGE_MESSAGE);

  const out = new ArrayBuffer(localBytes + centralBytes + END_RECORD_SIZE);
  const bytes = new Uint8Array(out);
  const view = new DataView(out);
  const offsets: number[] = [];
  let p = 0;

  for (const e of entries) {
    offsets.push(p);
    view.setUint32(p, ZIP_LOCAL_HEADER_SIGNATURE, true);
    view.setUint16(p + 4, e.method === ZIP_DEFLATE ? VERSION_DEFLATE : VERSION_STORED, true);
    view.setUint16(p + 6, FLAG_UTF8_NAMES, true);
    view.setUint16(p + 8, e.method, true);
    view.setUint16(p + 10, DOS_TIME, true);
    view.setUint16(p + 12, DOS_DATE, true);
    view.setUint32(p + 14, e.crc, true);
    view.setUint32(p + 18, e.data.length, true);
    view.setUint32(p + 22, e.size, true);
    view.setUint16(p + 26, e.name.length, true);
    view.setUint16(p + 28, 0, true);
    bytes.set(e.name, p + LOCAL_HEADER_SIZE);
    p += LOCAL_HEADER_SIZE + e.name.length;
    bytes.set(e.data, p);
    p += e.data.length;
  }

  const centralStart = p;
  entries.forEach((e, i) => {
    view.setUint32(p, ZIP_CENTRAL_HEADER_SIGNATURE, true);
    view.setUint16(p + 4, VERSION_MADE_BY, true);
    view.setUint16(p + 6, e.method === ZIP_DEFLATE ? VERSION_DEFLATE : VERSION_STORED, true);
    view.setUint16(p + 8, FLAG_UTF8_NAMES, true);
    view.setUint16(p + 10, e.method, true);
    view.setUint16(p + 12, DOS_TIME, true);
    view.setUint16(p + 14, DOS_DATE, true);
    view.setUint32(p + 16, e.crc, true);
    view.setUint32(p + 20, e.data.length, true);
    view.setUint32(p + 24, e.size, true);
    view.setUint16(p + 28, e.name.length, true);
    // Extra field and comment lengths, disk number, internal and external attributes all stay 0.
    view.setUint32(p + 42, offsets[i], true);
    bytes.set(e.name, p + CENTRAL_HEADER_SIZE);
    p += CENTRAL_HEADER_SIZE + e.name.length;
  });

  view.setUint32(p, ZIP_END_SIGNATURE, true);
  view.setUint16(p + 8, entries.length, true);
  view.setUint16(p + 10, entries.length, true);
  view.setUint32(p + 12, p - centralStart, true);
  view.setUint32(p + 16, centralStart, true);
  return out;
}

/** Package `entries` as a ZIP archive (see {@link ZipOptions} for when entries are compressed). */
export async function writeZip(entries: readonly ZipEntry[], options: ZipOptions = {}): Promise<ArrayBuffer> {
  const encoder = new TextEncoder();
  const packed: PackedEntry[] = [];
  for (const entry of entries) {
    const deflated = options.compress === false ? null : await deflateRaw(entry.data);
    const useDeflate = deflated !== null && deflated.length < entry.data.length;
    packed.push({
      name: encoder.encode(entry.name),
      method: useDeflate ? ZIP_DEFLATE : ZIP_STORED,
      crc: crc32(entry.data),
      size: entry.data.length,
      data: useDeflate ? deflated : entry.data,
    });
  }
  return assemble(packed);
}
