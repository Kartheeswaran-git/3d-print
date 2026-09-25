import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { create } from "zustand";
import { createJSONStorage, persist, type StateStorage } from "zustand/middleware";
import { createStore } from "zustand/vanilla";
import { attachHistory, type HistoryOptions } from "./history";

interface Doc {
  size: number;
  label: string;
  on: boolean;
}

interface DocState {
  settings: Doc;
  update: (patch: Partial<Doc>) => void;
  reset: () => void;
}

const INITIAL: Doc = { size: 10, label: "a", on: false };

function setup(opts?: HistoryOptions) {
  const store = createStore<DocState>()((set) => ({
    settings: { ...INITIAL },
    update: (patch) => set((state) => ({ settings: { ...state.settings, ...patch } })),
    reset: () => set({ settings: { ...INITIAL } }),
  }));
  const history = attachHistory(store, opts);
  const settings = () => store.getState().settings;
  const update = (patch: Partial<Doc>) => store.getState().update(patch);
  return { store, history, settings, update };
}

/** Advance the clock (Date.now) by `ms`. */
const wait = (ms: number) => vi.advanceTimersByTime(ms);

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
});

afterEach(() => {
  vi.useRealTimers();
});

describe("attachHistory", () => {
  it("starts empty and ignores undo/redo with nothing to travel", () => {
    const { history, settings } = setup();
    expect(history.getState().canUndo).toBe(false);
    expect(history.getState().canRedo).toBe(false);
    history.getState().undo();
    history.getState().redo();
    expect(settings()).toEqual(INITIAL);
    expect(history.getState().peekUndo()).toBeNull();
  });

  it("records separate steps for changes further apart than coalesceMs, and undoes/redoes them in order", () => {
    const { history, settings, update } = setup();
    update({ size: 11 });
    wait(600);
    update({ label: "b" });
    wait(600);
    update({ on: true });
    expect(history.getState().canUndo).toBe(true);

    history.getState().undo();
    expect(settings()).toEqual({ size: 11, label: "b", on: false });
    history.getState().undo();
    expect(settings()).toEqual({ size: 11, label: "a", on: false });
    history.getState().undo();
    expect(settings()).toEqual(INITIAL);
    expect(history.getState().canUndo).toBe(false);
    expect(history.getState().canRedo).toBe(true);

    history.getState().redo();
    history.getState().redo();
    history.getState().redo();
    expect(settings()).toEqual({ size: 11, label: "b", on: true });
    expect(history.getState().canRedo).toBe(false);
  });

  it("coalesces changes within coalesceMs of each other (sliding window) into one step", () => {
    const { history, settings, update } = setup({ coalesceMs: 500 });
    for (let i = 1; i <= 8; i++) {
      update({ size: 10 + i });
      wait(300); // 8 × 300 ms = 2.4 s in total, but never 500 ms between two changes
    }
    expect(settings().size).toBe(18);
    history.getState().undo();
    expect(settings()).toEqual(INITIAL);
    expect(history.getState().canUndo).toBe(false);
  });

  it("treats exactly coalesceMs as the same step and anything later as a new one", () => {
    const { history, settings, update } = setup({ coalesceMs: 500 });
    update({ size: 11 });
    wait(500);
    update({ size: 12 });
    wait(501);
    update({ size: 13 });
    history.getState().undo();
    expect(settings().size).toBe(12);
    history.getState().undo();
    expect(settings().size).toBe(10);
  });

  it("groups everything between begin() and end() into one step, however slow", () => {
    const { history, settings, update } = setup();
    update({ label: "b" });
    // The drag starts right after another edit but must still be its own step.
    wait(100);
    history.getState().begin();
    for (let i = 1; i <= 5; i++) {
      update({ size: 10 + i });
      wait(2_000);
    }
    history.getState().end();
    // An edit right after the gesture is a new step too.
    wait(50);
    update({ on: true });

    history.getState().undo();
    expect(settings()).toEqual({ size: 15, label: "b", on: false });
    history.getState().undo();
    expect(settings()).toEqual({ size: 10, label: "b", on: false });
    history.getState().undo();
    expect(settings()).toEqual(INITIAL);
  });

  it("supports nested begin/end and ignores unmatched end()", () => {
    const { history, settings, update } = setup();
    history.getState().end();
    history.getState().begin();
    update({ size: 11 });
    history.getState().begin();
    wait(2_000);
    update({ size: 12 });
    history.getState().end();
    wait(2_000);
    update({ size: 13 });
    history.getState().end();
    history.getState().undo();
    expect(settings()).toEqual(INITIAL);
    expect(history.getState().canUndo).toBe(false);
  });

  it("does not record the writes made by undo and redo", () => {
    const { history, settings, update } = setup();
    update({ size: 11 });
    wait(600);
    update({ size: 12 });
    history.getState().undo();
    expect(settings().size).toBe(11);
    // Still exactly one step left to undo, and one to redo.
    history.getState().undo();
    expect(settings().size).toBe(10);
    expect(history.getState().canUndo).toBe(false);
    history.getState().redo();
    history.getState().redo();
    expect(settings().size).toBe(12);
    expect(history.getState().canRedo).toBe(false);
    history.getState().undo();
    history.getState().undo();
    expect(history.getState().canUndo).toBe(false);
  });

  it("never merges an edit into a step that was just undone or redone", () => {
    const { history, settings, update } = setup();
    update({ size: 11 });
    history.getState().undo();
    update({ size: 20 }); // within coalesceMs of the undo
    history.getState().undo();
    expect(settings().size).toBe(10);
  });

  it("drops the redo stack on a new edit", () => {
    const { history, settings, update } = setup();
    update({ size: 11 });
    history.getState().undo();
    expect(history.getState().canRedo).toBe(true);
    update({ label: "z" });
    expect(history.getState().canRedo).toBe(false);
    history.getState().redo();
    expect(settings()).toEqual({ size: 10, label: "z", on: false });
  });

  it("ignores changes that leave every value equal", () => {
    const { history, update } = setup();
    update({ size: 10 });
    update({});
    expect(history.getState().canUndo).toBe(false);
  });

  it("drops a merged step that ends where it started", () => {
    const { history, settings, update } = setup();
    history.getState().begin();
    update({ size: 14 });
    update({ size: 10 });
    history.getState().end();
    expect(history.getState().canUndo).toBe(false);

    // A group that returns to the start and then moves again is one step.
    history.getState().begin();
    update({ size: 14 });
    update({ size: 10 });
    update({ size: 12 });
    history.getState().end();
    history.getState().undo();
    expect(settings().size).toBe(10);
    expect(history.getState().canUndo).toBe(false);
  });

  it("keeps at most `limit` steps, dropping the oldest", () => {
    const { history, settings, update } = setup({ limit: 3 });
    for (let i = 1; i <= 5; i++) {
      update({ size: 10 + i });
      wait(1_000);
    }
    let undos = 0;
    while (history.getState().canUndo) {
      history.getState().undo();
      undos += 1;
    }
    expect(undos).toBe(3);
    expect(settings().size).toBe(12);
  });

  it("clear() forgets both stacks", () => {
    const { history, settings, update } = setup();
    update({ size: 11 });
    wait(600);
    update({ size: 12 });
    history.getState().undo();
    history.getState().clear();
    expect(history.getState().canUndo).toBe(false);
    expect(history.getState().canRedo).toBe(false);
    history.getState().undo();
    history.getState().redo();
    expect(settings().size).toBe(11);
    // Recording carries on normally afterwards.
    update({ size: 30 });
    history.getState().undo();
    expect(settings().size).toBe(11);
  });

  it("batch() makes a discrete action (reset) its own single step", () => {
    const { store, history, settings, update } = setup();
    update({ size: 11, on: true });
    wait(100); // well inside the coalescing window
    history.getState().batch(() => store.getState().reset());
    expect(settings()).toEqual(INITIAL);
    history.getState().undo();
    expect(settings()).toEqual({ size: 11, label: "a", on: true });
    history.getState().redo();
    expect(settings()).toEqual(INITIAL);
  });

  it("peeks at the snapshots undo and redo would restore without changing anything", () => {
    const { history, settings, update } = setup();
    update({ size: 11 });
    expect(history.getState().peekUndo()).toEqual(INITIAL);
    expect(history.getState().peekRedo()).toBeNull();
    history.getState().undo();
    expect(history.getState().peekRedo()).toEqual({ ...INITIAL, size: 11 });
    expect(settings()).toEqual(INITIAL);
  });

  it("publishes canUndo/canRedo to subscribers", () => {
    const { history, update } = setup();
    const seen: [boolean, boolean][] = [];
    history.subscribe((state) => seen.push([state.canUndo, state.canRedo]));
    update({ size: 11 });
    history.getState().undo();
    history.getState().redo();
    expect(seen).toEqual([
      [true, false],
      [false, true],
      [true, false],
    ]);
  });

  it("works with a bound store using persist, and loading the autosave is not an undo step", async () => {
    const items = new Map<string, string>();
    const storage: StateStorage = {
      getItem: (key) => items.get(key) ?? null,
      setItem: (key, value) => void items.set(key, value),
      removeItem: (key) => void items.delete(key),
    };
    items.set("doc", JSON.stringify({ state: { settings: { size: 42, label: "saved", on: true } }, version: 0 }));
    const useDoc = create<DocState>()(
      persist(
        (set) => ({
          settings: { ...INITIAL },
          update: (patch) => set((state) => ({ settings: { ...state.settings, ...patch } })),
          reset: () => set({ settings: { ...INITIAL } }),
        }),
        { name: "doc", storage: createJSONStorage(() => storage), skipHydration: true, partialize: (s) => ({ settings: s.settings }) },
      ),
    );
    const history = attachHistory(useDoc);

    await useDoc.persist.rehydrate();
    expect(useDoc.getState().settings.size).toBe(42);
    expect(history.getState().canUndo).toBe(false);

    useDoc.getState().update({ size: 43 });
    history.getState().undo();
    expect(useDoc.getState().settings.size).toBe(42);
    // Undo writes go through the middleware, so the autosave follows.
    expect(JSON.parse(items.get("doc") ?? "{}").state.settings.size).toBe(42);
  });
});
