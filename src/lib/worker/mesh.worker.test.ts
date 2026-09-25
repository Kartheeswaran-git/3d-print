import { afterEach, describe, expect, it, vi } from "vitest";
import { randomField } from "@/lib/geometry/test-helpers";
import type { MeshRequest, MeshResponse } from "./protocol";

describe("mesh.worker entry", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it("answers messages on the worker scope with transfers", async () => {
    const posted: { message: MeshResponse; transfer: Transferable[] }[] = [];
    const scope: { onmessage: ((event: MessageEvent<MeshRequest>) => void) | null; postMessage: typeof post } = {
      onmessage: null,
      postMessage: post,
    };
    function post(message: MeshResponse, transfer: Transferable[]) {
      posted.push({ message, transfer });
    }
    vi.stubGlobal("self", scope);
    await import("./mesh.worker");
    expect(scope.onmessage).toBeTypeOf("function");

    const request: MeshRequest = {
      id: 1,
      output: "stl-binary",
      name: "lamp",
      validate: true,
      job: {
        kind: "sphere",
        luminance: randomField(16, 9, 1),
        mapping: { minThickness: 0.8, maxThickness: 3, gamma: 1 },
        diameterMm: 80,
        openingDeg: 20,
      },
    };
    scope.onmessage?.({ data: request } as MessageEvent<MeshRequest>);
    const last = posted[posted.length - 1];
    expect(last.message.type).toBe("file");
    if (last.message.type !== "file") return;
    expect(last.transfer).toEqual([last.message.buffer]);
    expect(last.message.stats.manifold?.watertight).toBe(true);

    scope.onmessage?.({ data: { ...request, id: 2, job: { ...request.job, diameterMm: -1 } } } as MessageEvent<MeshRequest>);
    expect(posted[posted.length - 1].message).toMatchObject({ id: 2, type: "error" });
  });
});
