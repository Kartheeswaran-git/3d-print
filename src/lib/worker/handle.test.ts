import { describe, expect, it } from "vitest";
import { field, randomField } from "@/lib/geometry/test-helpers";
import { entryData, readZip } from "@/lib/export/test-helpers";
import { handleMeshRequest } from "./handle";
import type { FlatJob, KeychainJob, MeshRequest, MeshResponse, SphereJob } from "./protocol";

async function run(request: MeshRequest) {
  const out: { response: MeshResponse; transfer: Transferable[] }[] = [];
  await handleMeshRequest(request, (response, transfer) => out.push({ response, transfer }));
  return out;
}

const flat = (): FlatJob => ({
  kind: "flat",
  luminance: randomField(30, 20, 1),
  mapping: { minThickness: 0.8, maxThickness: 3, gamma: 1 },
  widthMm: 90,
  heightMm: 60,
  baseMm: 0.6,
  shape: { shape: "circle", crescent: 0.4, outerRadius: 0.95, innerRadius: 0.8, offsetX: 0, offsetY: 0, rotationDeg: 0 },
});

const sphere = (): SphereJob => ({
  kind: "sphere",
  luminance: randomField(24, 13, 2),
  mapping: { minThickness: 0.8, maxThickness: 3, gamma: 1 },
  diameterMm: 100,
  openingDeg: 22,
});

const keychain = (withText = true): KeychainJob => ({
  kind: "keychain",
  baseAlpha: field(41, 17, (x, y) => (x > 2 && x < 38 && y > 2 && y < 14 ? 1 : 0)),
  textAlpha: field(41, 17, (x, y) => (withText && x > 10 && x < 30 && y > 6 && y < 10 ? 1 : 0)),
  widthMm: 20,
  heightMm: 8,
  baseThicknessMm: 2,
  textThicknessMm: 1.5,
  maskThreshold: 0.5,
});

describe("handleMeshRequest", () => {
  it("flat preview → one body part with uvs + thickness, all buffers transferred", async () => {
    const out = await run({ id: 3, job: flat(), output: "preview", name: "p", validate: false });
    expect(out[0].response).toMatchObject({ id: 3, type: "progress", stage: "mesh" });
    const last = out[out.length - 1];
    expect(last.response.type).toBe("preview");
    if (last.response.type !== "preview") return;
    const [part] = last.response.parts;
    expect(last.response.parts).toHaveLength(1);
    expect(part.role).toBe("body");
    expect(part.uvs).toBeInstanceOf(Float32Array);
    expect(part.thickness).toBeInstanceOf(Float32Array);
    expect(last.transfer).toEqual([part.positions.buffer, part.indices.buffer, part.uvs?.buffer, part.thickness?.buffer]);
    expect(last.response.stats.triangles).toBe(part.indices.length / 3);
    expect(last.response.stats.activeCells).toBeGreaterThan(0);
    expect(last.response.stats.manifold).toBeUndefined();
  });

  it("preview with validate reports the manifold check", async () => {
    const out = await run({ id: 4, job: sphere(), output: "preview", name: "p", validate: true });
    expect(out.map((o) => o.response.type === "progress" && o.response.stage)).toContain("validate");
    const last = out[out.length - 1].response;
    expect(last.type === "preview" && last.stats.manifold?.watertight).toBe(true);
  });

  it("keychain preview → base and text parts with thickness, no uvs", async () => {
    const last = (await run({ id: 5, job: keychain(), output: "preview", name: "k", validate: false })).pop();
    expect(last?.response.type).toBe("preview");
    if (last?.response.type !== "preview") return;
    expect(last.response.parts.map((p) => p.role)).toEqual(["base", "text"]);
    expect(last.response.parts.every((p) => p.thickness && !p.uvs)).toBe(true);
    const onlyBase = (await run({ id: 6, job: keychain(false), output: "preview", name: "k", validate: false })).pop();
    expect(onlyBase?.response.type === "preview" && onlyBase.response.parts.map((p) => p.role)).toEqual(["base"]);
  });

  it("binary STL export: progress stages, validated stats, exact bytes, transferred buffer", async () => {
    const out = await run({ id: 7, job: flat(), output: "stl-binary", name: "lamp", validate: true });
    expect(out.slice(0, 3).map((o) => o.response.type === "progress" && o.response.stage)).toEqual(["mesh", "validate", "write"]);
    const last = out[3];
    expect(out).toHaveLength(4);
    expect(last.response.type).toBe("file");
    if (last.response.type !== "file") return;
    const { buffer, stats, mime, extension } = last.response;
    expect(mime).toBe("model/stl");
    expect(extension).toBe("stl");
    expect(buffer.byteLength).toBe(84 + 50 * stats.triangles);
    expect(stats.bytes).toBe(buffer.byteLength);
    expect(stats.manifold).toEqual({ watertight: true, boundaryEdges: 0, nonManifoldEdges: 0, degenerateTriangles: 0 });
    expect(last.transfer).toEqual([buffer]);
  });

  it("ASCII STL export of a keychain uses the single-colour solid", async () => {
    const last = (await run({ id: 8, job: keychain(), output: "stl-ascii", name: "Ann", validate: true })).pop()?.response;
    expect(last?.type).toBe("file");
    if (last?.type !== "file") return;
    const text = new TextDecoder().decode(last.buffer);
    expect(text.startsWith("solid Ann\n")).toBe(true);
    expect(last.stats.manifold?.watertight).toBe(true);
    expect(last.stats.bounds.max[2]).toBeCloseTo(3.5, 5);
  });

  it("AMF keychain export: zipped XML with two named volumes, stats cover both parts (FIXES G7)", async () => {
    const out = await run({ id: 9, job: keychain(), output: "amf", name: "Ann", validate: true });
    const last = out.pop();
    expect(last?.response.type).toBe("file");
    if (last?.response.type !== "file") return;
    const { buffer, stats, mime, extension } = last.response;
    expect(mime).toBe("application/x-amf");
    expect(extension).toBe("amf");
    expect(stats.bytes).toBe(buffer.byteLength);
    expect(last.transfer).toEqual([buffer]);
    const records = readZip(buffer);
    expect(records.map((r) => r.name)).toEqual(["Ann.amf"]);
    const xml = new TextDecoder().decode(await entryData(records[0]));
    expect(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>')).toBe(true);
    expect(xml.match(/<volume /g)?.length).toBe(2);
    expect(xml).toContain('<metadata type="name">Base</metadata>');
    expect(xml).toContain('<metadata type="name">Text</metadata>');
    expect(xml).toContain("<color><r>1</r><g>0.48</g><b>0</b></color>");
    expect(xml.match(/<triangle>/g)?.length).toBe(stats.triangles);
    expect(stats.manifold?.watertight).toBe(true);
  });

  it("posts previews and STL files synchronously (the AMF waits for compression)", () => {
    const posted: MeshResponse["type"][] = [];
    const post = (response: MeshResponse) => void posted.push(response.type);
    void handleMeshRequest({ id: 12, job: keychain(), output: "preview", name: "k", validate: false }, post);
    void handleMeshRequest({ id: 13, job: keychain(), output: "stl-binary", name: "k", validate: true }, post);
    expect(posted.filter((t) => t !== "progress")).toEqual(["preview", "file"]);
  });

  it("errors become error responses with the builder's message", async () => {
    const job = flat();
    job.shape = { ...job.shape, shape: "custom", mask: null };
    const out = await run({ id: 10, job, output: "stl-binary", name: "x", validate: true });
    const last = out[out.length - 1].response;
    expect(last).toEqual({ id: 10, type: "error", message: expect.stringMatching(/no printable area/) });
  });

  it("malformed requests never reject", async () => {
    await expect(handleMeshRequest({} as MeshRequest, () => {})).resolves.toBeUndefined();
    expect((await run({} as MeshRequest))[0].response).toMatchObject({ id: -1, type: "error" });
    const out = await run({ id: 11, job: flat(), output: "obj" as never, name: "x", validate: true });
    expect(out[0].response).toMatchObject({ id: 11, type: "error" });
  });
});
