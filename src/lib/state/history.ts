import { create, type StoreApi, type UseBoundStore } from "zustand";
import { shallow } from "zustand/shallow";

/**
 * Undo/redo for a zustand store whose state holds a `settings` object.
 *
 * Every change to `settings` is recorded as a snapshot. Changes that arrive within `coalesceMs` of
 * each other merge into one step (typing, held arrow keys), and everything between `begin()` and
 * `end()` is exactly one step (drags). Undo/redo write snapshots back without recording new steps,
 * and changes that leave every value equal are ignored. When the store uses the persist middleware,
 * loading the autosave clears the history, so the first undo never reverts to the defaults.
 */
export interface History<T> {
  undo(): void;
  redo(): void;
  canUndo: boolean;
  canRedo: boolean;
  /** Group continuous edits (drags) into one step. Nestable; every `begin()` needs an `end()`. */
  begin(): void;
  end(): void;
  /** Run a discrete action (reset, load, preset) as its own single step, never merged with its neighbours. */
  batch(action: () => void): void;
  /** Forget every step, e.g. after replacing the document. */
  clear(): void;
  /** Settings the next undo would restore (a copy), or null — e.g. to announce which values an undo changes. */
  peekUndo(): T | null;
  /** Settings the next redo would restore (a copy), or null. */
  peekRedo(): T | null;
}

export interface HistoryOptions {
  /** Maximum number of undo steps kept; the oldest are dropped first. Default 100. */
  limit?: number;
  /** Changes closer together than this (ms) merge into one step. Default 500. */
  coalesceMs?: number;
}

interface HydrationApi {
  onFinishHydration: (listener: () => void) => () => void;
}

/** The persist middleware's API, when the store has one. */
function hydrationApi(store: object): HydrationApi | null {
  const persist: unknown = (store as { persist?: unknown }).persist;
  if (!persist || typeof persist !== "object") return null;
  return typeof (persist as Partial<HydrationApi>).onFinishHydration === "function" ? (persist as HydrationApi) : null;
}

export function attachHistory<T extends object>(
  store: StoreApi<{ settings: T }>,
  opts: HistoryOptions = {},
): UseBoundStore<StoreApi<History<T>>> {
  const limit = Math.max(1, Math.floor(opts.limit ?? 100));
  const coalesceMs = Math.max(0, opts.coalesceMs ?? 500);

  /** Settings before each step, oldest first. */
  const past: T[] = [];
  /** Settings after each undone step, most recently undone last. */
  const future: T[] = [];
  /** True while undo/redo write to the store, so those writes aren't recorded. */
  let applying = false;
  /** Open begin() calls. */
  let depth = 0;
  /** Whether the latest step still absorbs changes (inside a group or the coalescing window). */
  let stepOpen = false;
  let lastChangeAt = Number.NEGATIVE_INFINITY;

  const copy = (settings: T): T => ({ ...settings });

  const history = create<History<T>>()(() => ({
    canUndo: false,
    canRedo: false,
    undo: () => travel(past, future),
    redo: () => travel(future, past),
    begin: () => {
      // A gesture always starts a fresh step, even right after another edit.
      if (depth === 0) stepOpen = false;
      depth += 1;
    },
    end: () => {
      if (depth === 0) return;
      depth -= 1;
      if (depth === 0) stepOpen = false;
    },
    batch: (action) => {
      const { begin, end } = history.getState();
      begin();
      try {
        action();
      } finally {
        end();
      }
    },
    clear: () => {
      past.length = 0;
      future.length = 0;
      stepOpen = false;
      sync();
    },
    peekUndo: () => peek(past),
    peekRedo: () => peek(future),
  }));

  function peek(stack: T[]): T | null {
    const top = stack[stack.length - 1];
    return top === undefined ? null : copy(top);
  }

  function sync() {
    const canUndo = past.length > 0;
    const canRedo = future.length > 0;
    const state = history.getState();
    if (state.canUndo !== canUndo || state.canRedo !== canRedo) history.setState({ canUndo, canRedo });
  }

  /** Move one step from `from` to `to`, writing the popped snapshot to the store. */
  function travel(from: T[], to: T[]) {
    const target = from.pop();
    if (target === undefined) return;
    to.push(copy(store.getState().settings));
    applying = true;
    try {
      store.setState({ settings: copy(target) });
    } finally {
      applying = false;
    }
    // Whatever is edited next is a new step, never merged into the one just travelled.
    stepOpen = false;
    sync();
  }

  store.subscribe((state, prev) => {
    if (applying || state.settings === prev.settings || shallow(state.settings, prev.settings)) return;
    const now = Date.now();
    const merge = stepOpen && (depth > 0 || now - lastChangeAt <= coalesceMs);
    lastChangeAt = now;
    future.length = 0;
    if (merge) {
      // A step that ends where it started (e.g. a drag back to the original value) isn't worth an undo.
      const start = past[past.length - 1];
      if (start !== undefined && shallow(state.settings, start)) {
        past.pop();
        stepOpen = false;
      }
    } else {
      past.push(copy(prev.settings));
      if (past.length > limit) past.splice(0, past.length - limit);
      stepOpen = true;
    }
    sync();
  });

  hydrationApi(store)?.onFinishHydration(() => history.getState().clear());

  return history;
}
