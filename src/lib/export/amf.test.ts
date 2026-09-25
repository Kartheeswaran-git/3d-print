import { describe, expect, it } from "vitest";
import { isWellFormedXml } from "@/lib/geometry/test-helpers";
import { amfEntryName, escapeXml, writeAmf, writeZippedAmf } from "./amf";
import { entryData, readZip } from "./test-helpers";
import { ZIP_DEFLATE, ZIP_STORED } from "./zip";

const tri = (offset: number) => ({
  positions: new Float32Array([offset, 0, 0, offset + 1, 0, 0, offset, 1, 0, offset, 0, 1]),
  indices: new Uint32Array([0, 2, 1, 0, 1, 3, 0, 3, 2, 1, 2, 3]),
});

describe("writeAmf", () => {
  const xml = new TextDecoder().decode(
    writeAmf(
      [
        { mesh: tri(0), name: "Base", color: [0.2, 0.2, 0.2] },
        { mesh: tri(5), name: 'Text & "Name" <1>', color: [1, 0.48, 0] },
      ],
      "Ann's <keychain> & co",
    ),
  );

  it("is well-formed XML with one object, a shared vertex list and one volume per part", () => {
    expect(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>')).toBe(true);
    expect(isWellFormedXml(xml)).toBe(true);
    expect(xml.match(/<object /g)?.length).toBe(1);
    expect(xml.match(/<vertices>/g)?.length).toBe(1);
    expect(xml.match(/<vertex>/g)?.length).toBe(8);
    expect(xml.match(/<triangle>/g)?.length).toBe(8);
    expect(xml.match(/<volume materialid="\d+">/g)).toEqual(['<volume materialid="1">', '<volume materialid="2">']);
    expect(xml.match(/<material id="\d+">/g)).toEqual(['<material id="1">', '<material id="2">']);
    expect(xml).toContain('<amf unit="millimeter"');
  });

  it("offsets the second volume's indices into the shared vertex list", () => {
    const volumes = xml.split("<volume ").slice(1);
    const indices = (v: string) => [...v.matchAll(/<v\d>(\d+)<\/v\d>/g)].map((m) => Number(m[1]));
    expect(Math.max(...indices(volumes[0]))).toBe(3);
    expect(Math.min(...indices(volumes[1]))).toBe(4);
    expect(Math.max(...indices(volumes[1]))).toBe(7);
  });

  it("escapes names and writes colours", () => {
    expect(xml).toContain("<metadata type=\"name\">Ann&apos;s &lt;keychain&gt; &amp; co</metadata>");
    expect(xml).toContain("Text &amp; &quot;Name&quot; &lt;1&gt;");
    expect(xml).toContain("<color><r>1</r><g>0.48</g><b>0</b></color>");
    expect(xml).toContain("<color><r>0.2</r><g>0.2</g><b>0.2</b></color>");
  });

  it("skips empty volumes", () => {
    const out = new TextDecoder().decode(
      writeAmf(
        [
          { mesh: tri(0), name: "Base", color: [0.2, 0.2, 0.2] },
          { mesh: { positions: new Float32Array(), indices: new Uint32Array() }, name: "Text", color: [1, 0, 0] },
        ],
        "x",
      ),
    );
    expect(isWellFormedXml(out)).toBe(true);
    expect(out.match(/<volume /g)?.length).toBe(1);
  });

  it("escapeXml drops characters XML cannot represent", () => {
    expect(escapeXml("a\u0001b￾c")).toBe("abc");
  });
});

describe("writeZippedAmf", () => {
  const volumes = [
    { mesh: tri(0), name: "Base", color: [0.2, 0.2, 0.2] as [number, number, number] },
    { mesh: tri(5), name: "Text", color: [1, 0.48, 0] as [number, number, number] },
  ];

  it("names the entry after the object, keeping Unicode and dropping path characters", () => {
    expect(amfEntryName("Luna keychain")).toBe("Luna keychain.amf");
    expect(amfEntryName("李娜 🌙 keychain")).toBe("李娜 🌙 keychain.amf");
    expect(amfEntryName("../a/b\\c:d*?\"<>|\u0007e")).toBe("a b c d e.amf");
    expect(amfEntryName("  ... ")).toBe("model.amf");
    expect(Array.from(amfEntryName("🌙".repeat(300)))).toHaveLength(100 + 4);
  });

  it("packs writeAmf's XML as the only entry of a ZIP archive", async () => {
    const xml = new Uint8Array(writeAmf(volumes, "Ann keychain"));
    for (const compress of [false, true]) {
      const buffer = await writeZippedAmf(volumes, "Ann keychain", { compress });
      expect(new TextDecoder().decode(new Uint8Array(buffer, 0, 2))).toBe("PK");
      const records = readZip(buffer);
      expect(records).toHaveLength(1);
      expect(records[0].name).toBe("Ann keychain.amf");
      expect(records[0].method).toBe(compress && typeof CompressionStream === "function" ? ZIP_DEFLATE : ZIP_STORED);
      expect(await entryData(records[0])).toEqual(xml);
    }
  });
});
