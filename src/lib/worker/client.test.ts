import { describe, expect, it } from "vitest";
import { field } from "@/lib/geometry/test-helpers";
import type { MeshStats } from "@/lib/geometry/types";
import { CANCELLED_MESSAGE, MeshWorkerClient, WORKER_CRASHED_MESSAGE } from "./client";
import type { FlatJob, KeychainJob, MeshRequest, MeshResponse } from "./protocol";

class FakeWorker {
  onmessage: ((event: MessageEvent<MeshResponse>) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  onmessageerror: ((event: MessageEvent) => void) | null = null;
  readonly posted: { request: MeshRequest; transfer: Transferable[] }[] = [];
  terminated = false;

  postMessage(request: MeshRequest, transfer: Transferable[] = []) {
    this.posted.push({ request, transfer });
  }

  terminate() {
    this.terminated = true;
  }

  reply(response: MeshResponse) {
    this.onmessage?.({ data: response } as MessageEvent<MeshResponse>);
  }

  crash() {
    this.onerror?.({ message: "boom", preventDefault() {} } as ErrorEvent);
  }

  lastId() {
    return this.posted[this.posted.length - 1].request.id;
  }
}

function setup() {
  const workers: FakeWorker[] = [];
  const client = new MeshWorkerClient(() => {
    const w = new FakeWorker();
    workers.push(w);
    return w as unknown as Worker;
  });
  return { client, workers };
}

const STATS: MeshStats = { vertices: 3, triangles: 1, activeCells: 1, bounds: { min: [0, 0, 0], max: [1, 1, 1] } };

const job = (tag = 0): FlatJob => ({
  kind: "flat",
  luminance: field(4, 3, () => tag),
  mapping: { minThickness: 0.8, maxThickness: 3, gamma: 1 },
  widthMm: 50,
  heightMm: 40,
  baseMm: 0.6,
  shape: {
    shape: "custom",
    crescent: 0.4,
    outerRadius: 1,
    innerRadius: 0.8,
    offsetX: 0,
    offsetY: 0,
    rotationDeg: 0,
    mask: field(8, 8, () => 1),
    maskThreshold: 0.5,
  },
});

const previewReply = (id: number): MeshResponse => ({
  id,
  type: "preview",
  parts: [{ role: "body", positions: new Float32Array(9), indices: new Uint32Array([0, 1, 2]) }],
  stats: STATS,
});

const fileReply = (id: number): MeshResponse => ({
  id,
  type: "file",
  buffer: new ArrayBuffer(134),
  mime: "model/stl",
  extension: "stl",
  stats: { ...STATS, bytes: 134 },
});

/** Let promise callbacks run. */
const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

describe("MeshWorkerClient", () => {
  it("creates the worker lazily", async () => {
    const { client, workers } = setup();
    expect(workers).toHaveLength(0);
    const p = client.preview(job());
    expect(workers).toHaveLength(1);
    workers[0].reply(previewReply(workers[0].lastId()));
    await expect(p).resolves.not.toBeNull();
  });

  it("coalesces previews: one in flight + the latest pending; superseded ones resolve null", async () => {
    const { client, workers } = setup();
    const a = client.preview(job(1));
    const b = client.preview(job(2));
    const c = client.preview(job(3));
    const w = workers[0];
    expect(w.posted).toHaveLength(1);
    await expect(b).resolves.toBeNull();

    w.reply(previewReply(w.posted[0].request.id));
    await expect(a).resolves.toMatchObject({ stats: STATS });
    // The latest pending preview is sent as soon as the slot frees up.
    expect(w.posted).toHaveLength(2);
    const second = w.posted[1].request;
    expect(second.output).toBe("preview");
    expect(second.job.kind === "flat" && second.job.luminance.values[0]).toBe(3);
    w.reply(previewReply(second.id));
    await expect(c).resolves.toMatchObject({ parts: [{ role: "body" }] });
  });

  it("never confuses previews and exports (FIXES K1)", async () => {
    const { client, workers } = setup();
    const preview = client.preview(job());
    const file = client.exportFile(job(), "stl-binary", "lamp");
    const w = workers[0];
    // Exports are not coalesced: sent immediately with their own id.
    expect(w.posted).toHaveLength(2);
    const [pReq, fReq] = w.posted.map((p) => p.request);
    expect(pReq.id).not.toBe(fReq.id);
    expect(fReq).toMatchObject({ output: "stl-binary", name: "lamp", validate: true });
    expect(pReq.validate).toBe(false);

    let fileSettled = false;
    void file.then(() => (fileSettled = true));
    w.reply(previewReply(pReq.id));
    await expect(preview).resolves.toMatchObject({ stats: STATS });
    await flush();
    expect(fileSettled).toBe(false);

    w.reply(fileReply(fReq.id));
    const result = await file;
    expect(result.buffer.byteLength).toBe(134);
    expect(result.extension).toBe("stl");
  });

  it("routes progress to the right request and rejects only the failing one", async () => {
    const { client, workers } = setup();
    const seenA: string[] = [];
    const seenB: string[] = [];
    const a = client.exportFile(job(), "stl-ascii", "a", (stage) => seenA.push(stage));
    const b = client.exportFile(job(), "amf", "b", (stage) => seenB.push(stage));
    const w = workers[0];
    const [idA, idB] = w.posted.map((p) => p.request.id);
    w.reply({ id: idA, type: "progress", stage: "mesh", message: "Building mesh…" });
    w.reply({ id: idB, type: "progress", stage: "validate", message: "Checking…" });
    w.reply({ id: idA, type: "error", message: "The selected shape has no printable area." });
    await expect(a).rejects.toThrow("The selected shape has no printable area.");
    w.reply(fileReply(idB));
    await expect(b).resolves.toMatchObject({ mime: "model/stl" });
    expect(seenA).toEqual(["mesh"]);
    expect(seenB).toEqual(["validate"]);
  });

  it("starts the queued preview after the in-flight preview fails", async () => {
    const { client, workers } = setup();
    const a = client.preview(job(1));
    const b = client.preview(job(2));
    const w = workers[0];
    w.reply({ id: w.posted[0].request.id, type: "error", message: "bad" });
    await expect(a).rejects.toThrow("bad");
    expect(w.posted).toHaveLength(2);
    w.reply(previewReply(w.posted[1].request.id));
    await expect(b).resolves.not.toBeNull();
  });

  it("transfers only the per-request input buffers, never the reused mask", () => {
    const { client, workers } = setup();
    const flatJob = job();
    void client.preview(flatJob);
    const [{ transfer }] = workers[0].posted;
    expect(transfer).toEqual([flatJob.luminance.values.buffer]);
    expect(transfer).not.toContain(flatJob.shape.mask?.values.buffer);

    const shared = new Float32Array(24);
    const keychain: KeychainJob = {
      kind: "keychain",
      baseAlpha: { width: 4, height: 3, values: shared.subarray(0, 12) },
      textAlpha: { width: 4, height: 3, values: shared.subarray(12) },
      widthMm: 10,
      heightMm: 5,
      baseThicknessMm: 2,
      textThicknessMm: 1,
      maskThreshold: 0.5,
    };
    void client.exportFile(keychain, "amf", "k");
    // One buffer backing both fields is listed once (listing it twice would throw DataCloneError).
    expect(workers[0].posted[1].transfer).toEqual([shared.buffer]);
  });

  it("rejects all pending work when the worker crashes, then starts a fresh worker (FIXES L6)", async () => {
    const { client, workers } = setup();
    const a = client.preview(job(1));
    const b = client.preview(job(2));
    const c = client.exportFile(job(), "stl-binary", "x");
    workers[0].crash();
    await expect(a).rejects.toThrow(WORKER_CRASHED_MESSAGE);
    await expect(b).rejects.toThrow(WORKER_CRASHED_MESSAGE);
    await expect(c).rejects.toThrow(WORKER_CRASHED_MESSAGE);
    expect(workers[0].terminated).toBe(true);

    const d = client.preview(job(3));
    expect(workers).toHaveLength(2);
    // Late messages from the dead worker are ignored.
    workers[0].reply(previewReply(workers[1].lastId()));
    workers[1].reply(previewReply(workers[1].lastId()));
    await expect(d).resolves.not.toBeNull();
  });

  it("treats messageerror like a crash", async () => {
    const { client, workers } = setup();
    const a = client.exportFile(job(), "stl-binary", "x");
    workers[0].onmessageerror?.({} as MessageEvent);
    await expect(a).rejects.toThrow(WORKER_CRASHED_MESSAGE);
  });

  it("dispose() terminates the worker and rejects pending work with 'cancelled'; the client stays usable", async () => {
    const { client, workers } = setup();
    const a = client.preview(job(1));
    const b = client.preview(job(2));
    const c = client.exportFile(job(), "amf", "x");
    client.dispose();
    await expect(a).rejects.toThrow(CANCELLED_MESSAGE);
    await expect(b).rejects.toThrow(CANCELLED_MESSAGE);
    await expect(c).rejects.toThrow(CANCELLED_MESSAGE);
    expect(workers[0].terminated).toBe(true);

    const d = client.preview(job());
    expect(workers).toHaveLength(2);
    workers[1].reply(previewReply(workers[1].lastId()));
    await expect(d).resolves.not.toBeNull();
  });

  it("reports a readable error when postMessage fails or the worker cannot start", async () => {
    const { client, workers } = setup();
    const first = client.preview(job());
    workers[0].postMessage = () => {
      throw new Error("DataCloneError");
    };
    workers[0].reply(previewReply(workers[0].lastId()));
    await first;
    await expect(client.exportFile(job(), "stl-binary", "x")).rejects.toThrow(/could not be sent/);
    // The preview slot is released after a failed send.
    const next = client.preview(job());
    await expect(next).rejects.toThrow(/could not be sent/);

    const broken = new MeshWorkerClient(() => {
      throw new Error("no workers");
    });
    await expect(broken.preview(job())).rejects.toThrow(/could not start/);
  });
});
