import type {
  FileResult,
  MeshJob,
  MeshRequest,
  MeshResponse,
  OutputFormat,
  PreviewResult,
  ProgressStage,
} from "./protocol";

export type ProgressHandler = (stage: ProgressStage, message: string) => void;

/** Rejection message for every pending request when the worker crashes (FIXES L6). */
export const WORKER_CRASHED_MESSAGE = "The mesh engine stopped unexpectedly. Try again.";
/** Rejection message after {@link MeshWorkerClient.dispose}; callers usually ignore it. */
export const CANCELLED_MESSAGE = "cancelled";
const WORKER_START_MESSAGE = "The mesh engine could not start in this browser.";
const SEND_FAILED_MESSAGE = "The model data could not be sent to the mesh engine. Try again.";

interface PendingPreview {
  kind: "preview";
  resolve: (result: PreviewResult | null) => void;
  reject: (error: Error) => void;
  onProgress?: ProgressHandler;
}

interface PendingFile {
  kind: "file";
  resolve: (result: FileResult) => void;
  reject: (error: Error) => void;
  onProgress?: ProgressHandler;
}

type Pending = PendingPreview | PendingFile;

interface QueuedPreview extends PendingPreview {
  job: MeshJob;
}

function defaultCreateWorker(): Worker {
  return new Worker(new URL("./mesh.worker.ts", import.meta.url), { type: "module" });
}

/**
 * Per-request input buffers to transfer (luminance / alpha grids). Callers create them fresh for each request,
 * so after sending they are detached. `shape.mask` is structured-cloned instead because callers reuse it.
 */
function transferablesOf(job: MeshJob): Transferable[] {
  const views = job.kind === "keychain" ? [job.baseAlpha?.values, job.textAlpha?.values] : [job.luminance?.values];
  const keep = job.kind === "flat" ? job.shape?.mask?.values.buffer : undefined;
  const buffers = new Set<ArrayBuffer>();
  for (const view of views) {
    const buffer = view?.buffer;
    if (buffer instanceof ArrayBuffer && buffer.byteLength > 0 && buffer !== keep) buffers.add(buffer);
  }
  return [...buffers];
}

/**
 * Promise API over the mesh worker. Previews coalesce (one in flight + the latest pending); exports are sent
 * straight away and queue inside the worker. Every request carries its own id, so a preview response can
 * never settle an export (FIXES K1). The worker is created lazily and re-created after a crash.
 */
export class MeshWorkerClient {
  private worker: Worker | null = null;
  private nextId = 1;
  private readonly pending = new Map<number, Pending>();
  private previewInFlight: number | null = null;
  private queuedPreview: QueuedPreview | null = null;
  private readonly createWorker: () => Worker;

  constructor(createWorker?: () => Worker) {
    this.createWorker = createWorker ?? defaultCreateWorker;
  }

  /**
   * Coalescing: at most one preview in flight + the latest pending. A superseded preview resolves null.
   * The in-flight preview still resolves with its own (older) result, and results arrive in request order,
   * so applying every non-null result leaves the newest mesh on screen.
   */
  preview(job: MeshJob, onProgress?: ProgressHandler): Promise<PreviewResult | null> {
    return new Promise<PreviewResult | null>((resolve, reject) => {
      const entry: QueuedPreview = { kind: "preview", job, resolve, reject, onProgress };
      if (this.previewInFlight !== null) {
        const superseded = this.queuedPreview;
        this.queuedPreview = entry;
        superseded?.resolve(null);
        return;
      }
      this.startPreview(entry);
    });
  }

  /** Never coalesced; never confused with previews (request ids). Always validated in the worker. */
  exportFile(
    job: MeshJob,
    output: Exclude<OutputFormat, "preview">,
    name: string,
    onProgress?: ProgressHandler,
  ): Promise<FileResult> {
    return new Promise<FileResult>((resolve, reject) => {
      const id = this.nextId++;
      this.pending.set(id, { kind: "file", resolve, reject, onProgress });
      this.send({ id, job, output, name, validate: true });
    });
  }

  /** Terminates the worker and rejects pending work with Error("cancelled"). The client stays usable. */
  dispose(): void {
    this.failAll(new Error(CANCELLED_MESSAGE));
  }

  private startPreview(entry: QueuedPreview): void {
    const id = this.nextId++;
    this.pending.set(id, { kind: "preview", resolve: entry.resolve, reject: entry.reject, onProgress: entry.onProgress });
    this.previewInFlight = id;
    this.send({ id, job: entry.job, output: "preview", name: "preview", validate: false });
  }

  private send(request: MeshRequest): void {
    let worker: Worker;
    try {
      worker = this.ensureWorker();
    } catch {
      this.settle(request.id, (entry) => entry.reject(new Error(WORKER_START_MESSAGE)));
      return;
    }
    try {
      worker.postMessage(request, transferablesOf(request.job));
    } catch {
      this.settle(request.id, (entry) => entry.reject(new Error(SEND_FAILED_MESSAGE)));
    }
  }

  private ensureWorker(): Worker {
    if (this.worker) return this.worker;
    const worker = this.createWorker();
    worker.onmessage = (event: MessageEvent<MeshResponse>) => {
      if (this.worker === worker) this.handleResponse(event.data);
    };
    worker.onerror = (event: ErrorEvent) => {
      // Handled here: the UI shows the error, so keep it out of the global error handler.
      event.preventDefault?.();
      if (this.worker === worker) this.failAll(new Error(WORKER_CRASHED_MESSAGE));
    };
    worker.onmessageerror = () => {
      if (this.worker === worker) this.failAll(new Error(WORKER_CRASHED_MESSAGE));
    };
    this.worker = worker;
    return worker;
  }

  private handleResponse(response: MeshResponse): void {
    if (!response || typeof response.id !== "number") return;
    const entry = this.pending.get(response.id);
    if (!entry) return;
    switch (response.type) {
      case "progress":
        try {
          entry.onProgress?.(response.stage, response.message);
        } catch {
          // A failing progress callback must not break response routing.
        }
        return;
      case "preview":
        this.settle(response.id, (e) =>
          e.kind === "preview"
            ? e.resolve({ parts: response.parts, stats: response.stats })
            : e.reject(new Error("The mesh engine returned a preview instead of a file.")),
        );
        return;
      case "file":
        this.settle(response.id, (e) =>
          e.kind === "file"
            ? e.resolve({ buffer: response.buffer, mime: response.mime, extension: response.extension, stats: response.stats })
            : e.reject(new Error("The mesh engine returned a file instead of a preview.")),
        );
        return;
      case "error":
        this.settle(response.id, (e) => e.reject(new Error(response.message || "The model could not be generated.")));
        return;
    }
  }

  /** Remove a pending request, settle it, and start the queued preview when the preview slot frees up. */
  private settle(id: number, action: (entry: Pending) => void): void {
    const entry = this.pending.get(id);
    if (!entry) return;
    this.pending.delete(id);
    action(entry);
    if (id === this.previewInFlight) {
      this.previewInFlight = null;
      const next = this.queuedPreview;
      this.queuedPreview = null;
      if (next) this.startPreview(next);
    }
  }

  private failAll(error: Error): void {
    const worker = this.worker;
    this.worker = null;
    if (worker) {
      worker.onmessage = null;
      worker.onerror = null;
      worker.onmessageerror = null;
      worker.terminate();
    }
    const entries: Pending[] = [...this.pending.values()];
    if (this.queuedPreview) entries.push(this.queuedPreview);
    this.pending.clear();
    this.queuedPreview = null;
    this.previewInFlight = null;
    for (const entry of entries) entry.reject(error);
  }
}
