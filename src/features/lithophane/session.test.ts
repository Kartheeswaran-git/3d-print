import { beforeEach, describe, expect, it, vi } from "vitest";
import type { GrayMap, MoonSurface } from "@/lib/image";

const pending = new Map<MoonSurface, { resolve: (map: GrayMap) => void; reject: (error: Error) => void }>();

vi.mock("@/lib/image", () => ({
  loadPhoto: vi.fn(),
  loadMaskFile: vi.fn(),
  loadMoonMap: vi.fn(
    (surface: MoonSurface) =>
      new Promise<GrayMap>((resolve, reject) => {
        pending.set(surface, { resolve, reject });
      }),
  ),
}));

const { useLithophaneSession } = await import("./session");

const map = (value: number): GrayMap => ({ width: 1, height: 1, data: new Uint8Array([value]) });
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("session moon map", () => {
  beforeEach(() => {
    pending.clear();
    useLithophaneSession.setState({ moon: null, moonSurface: null, moonError: null });
  });

  it("reports a failed surface instead of previewing the previously loaded one", async () => {
    const { ensureMoon } = useLithophaneSession.getState();
    ensureMoon("lro");
    pending.get("lro")!.resolve(map(100));
    await flush();
    expect(useLithophaneSession.getState().moonSurface).toBe("lro");

    ensureMoon("shaded");
    pending.get("shaded")!.reject(new Error("offline"));
    await flush();
    const state = useLithophaneSession.getState();
    expect(state.moon).toBeNull();
    expect(state.moonError).toBe("offline");
  });

  it("clears an older failure when a new load starts", async () => {
    const { ensureMoon } = useLithophaneSession.getState();
    ensureMoon("shaded");
    pending.get("shaded")!.reject(new Error("offline"));
    await flush();
    expect(useLithophaneSession.getState().moonError).toBe("offline");

    ensureMoon("lro");
    expect(useLithophaneSession.getState().moonError).toBeNull();
    pending.get("lro")!.resolve(map(50));
    await flush();
    expect(useLithophaneSession.getState()).toMatchObject({ moonSurface: "lro", moonError: null });
  });
});
