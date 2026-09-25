import { crc32 as zlibCrc32, inflateRawSync } from "node:zlib";
import { describe, expect, it, vi } from "vitest";
import { entryData, readZip } from "./test-helpers";
import { crc32, deflateRaw, writeZip, ZIP_DEFLATE, ZIP_STORED } from "./zip";

const encoder = new TextEncoder();
const decoder = new TextDecoder();
const text = (s: string) => encoder.encode(s);
/** Repetitive, XML-like payload that DEFLATE shrinks a lot. */
const xmlLike = (lines: number) =>
  text(Array.from({ length: lines }, (_, i) => `<vertex><x>${i % 97}</x><y>${(i * 7) % 13}</y></vertex>\n`).join(""));

describe("crc32", () => {
  it("matches the standard check value and zlib", () => {
    expect(crc32(text("123456789"))).toBe(0xcbf43926);
    expect(crc32(new Uint8Array())).toBe(0);
    const data = xmlLike(500);
    expect(crc32(data)).toBe(zlibCrc32(data));
  });

  it("continues across chunks", () => {
    const data = xmlLike(200);
    expect(crc32(data.subarray(1234), crc32(data.subarray(0, 1234)))).toBe(crc32(data));
  });
});

describe("writeZip (STORED)", () => {
  it("writes signatures, sizes, CRCs, UTF-8 names and a fixed DOS time", async () => {
    const entries = [
      { name: "Ann keychain.amf", data: text("<amf/>\n") },
      { name: "李娜 🌙/notes.txt", data: text("hello") },
      { name: "empty.txt", data: new Uint8Array() },
    ];
    const buffer = await writeZip(entries, { compress: false });
    const bytes = new Uint8Array(buffer);
    expect([...bytes.subarray(0, 4)]).toEqual([0x50, 0x4b, 0x03, 0x04]);

    const records = readZip(buffer);
    expect(records.map((r) => r.name)).toEqual(entries.map((e) => e.name));
    for (const [i, r] of records.entries()) {
      expect(r.method).toBe(ZIP_STORED);
      expect(r.flags & 0x0800).toBe(0x0800);
      expect(r.dosDate).toBe(0x0021);
      expect(r.dosTime).toBe(0);
      expect(r.size).toBe(entries[i].data.length);
      expect(r.compressedSize).toBe(entries[i].data.length);
      expect(r.crc).toBe(zlibCrc32(entries[i].data));
      expect([...(await entryData(r))]).toEqual([...entries[i].data]);
    }
    // 3 × (30-byte local header + 46-byte central header + name × 2) + data + 22-byte end record.
    const names = entries.reduce((n, e) => n + text(e.name).length, 0);
    const data = entries.reduce((n, e) => n + e.data.length, 0);
    expect(buffer.byteLength).toBe(3 * (30 + 46) + names * 2 + data + 22);
  });

  it("is deterministic", async () => {
    const entries = [{ name: "a.amf", data: xmlLike(50) }];
    const a = new Uint8Array(await writeZip(entries, { compress: false }));
    const b = new Uint8Array(await writeZip(entries, { compress: false }));
    expect(a).toEqual(b);
  });

  it("writes a valid empty archive", async () => {
    const buffer = await writeZip([], { compress: false });
    expect(buffer.byteLength).toBe(22);
    expect(readZip(buffer)).toEqual([]);
  });

  it("falls back to STORED when CompressionStream is missing or rejects deflate-raw", async () => {
    const data = xmlLike(300);
    vi.stubGlobal("CompressionStream", undefined);
    try {
      expect(await deflateRaw(data)).toBeNull();
      const [record] = readZip(await writeZip([{ name: "a.amf", data }]));
      expect(record.method).toBe(ZIP_STORED);
      expect(decoder.decode(await entryData(record))).toBe(decoder.decode(data));
    } finally {
      vi.unstubAllGlobals();
    }
    vi.stubGlobal(
      "CompressionStream",
      class {
        constructor() {
          throw new TypeError("Unsupported compression format: 'deflate-raw'");
        }
      },
    );
    try {
      expect(await deflateRaw(data)).toBeNull();
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe.runIf(typeof CompressionStream === "function")("writeZip (DEFLATE)", () => {
  it("compresses with deflate-raw and inflates back to the original bytes", async () => {
    const data = xmlLike(20_000);
    const buffer = await writeZip([{ name: "Luna keychain.amf", data }]);
    const [record] = readZip(buffer);
    expect(record.method).toBe(ZIP_DEFLATE);
    expect(record.size).toBe(data.length);
    expect(record.compressedSize).toBeLessThan(data.length / 4);
    expect(buffer.byteLength).toBe(30 + 46 + 2 * text(record.name).length + record.compressedSize + 22);
    expect(record.crc).toBe(zlibCrc32(data));

    // Inflate twice: with DecompressionStream and independently with zlib.
    const inflated = await entryData(record);
    expect(inflated.length).toBe(data.length);
    expect(crc32(inflated)).toBe(record.crc);
    expect(inflateRawSync(record.raw).equals(Buffer.from(data))).toBe(true);
  });

  it("stores entries that compression would not shrink", async () => {
    const tiny = text("x");
    const [record] = readZip(await writeZip([{ name: "tiny.txt", data: tiny }]));
    expect(record.method).toBe(ZIP_STORED);
    expect([...record.raw]).toEqual([...tiny]);
  });

  it("is deterministic", async () => {
    const entries = [{ name: "a.amf", data: xmlLike(2_000) }];
    expect(new Uint8Array(await writeZip(entries))).toEqual(new Uint8Array(await writeZip(entries)));
  });
});
