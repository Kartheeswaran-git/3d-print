import { writeZippedAmf, type AmfVolume } from "@/lib/export/amf";
import { writeAsciiStl, writeBinaryStl } from "@/lib/export/stl";
import {
  buildFlatJob,
  buildKeychainParts,
  buildKeychainSolid,
  buildSphereJob,
  checkManifold,
  meshStats,
  mergeManifoldReports,
} from "@/lib/geometry";
import type { ManifoldReport, MeshBuildResult } from "@/lib/geometry/types";
import type { MeshJob, MeshRequest, MeshResponse, OutputFormat, PreviewPart } from "./protocol";

/** Posts a response, transferring the listed buffers. */
export type PostResponse = (response: MeshResponse, transfer: Transferable[]) => void;

type Rgb = AmfVolume["color"];
interface BuiltPart {
  role: PreviewPart["role"];
  mesh: MeshBuildResult;
}

const KEYCHAIN_BASE_COLOR: Rgb = [0.2, 0.2, 0.2];
const KEYCHAIN_TEXT_COLOR: Rgb = [1, 0.48, 0];
const BODY_COLOR: Rgb = [0.94, 0.93, 0.9];

const FALLBACK_ERROR = "The model could not be generated. Try again.";

const JOB_KINDS = new Set<MeshJob["kind"]>(["flat", "sphere", "keychain"]);
const OUTPUTS = new Set<OutputFormat>(["preview", "stl-binary", "stl-ascii", "amf"]);

function bufferOf(view: ArrayBufferView): ArrayBuffer | null {
  return view.buffer instanceof ArrayBuffer ? view.buffer : null;
}

/** Unique ArrayBuffers behind the given typed arrays (a buffer may only be listed once per transfer). */
function transferList(arrays: (ArrayBufferView | undefined)[]): Transferable[] {
  const seen = new Set<ArrayBuffer>();
  for (const a of arrays) {
    const buffer = a ? bufferOf(a) : null;
    if (buffer) seen.add(buffer);
  }
  return [...seen];
}

function toPart(role: PreviewPart["role"], mesh: MeshBuildResult): PreviewPart {
  const part: PreviewPart = { role, positions: mesh.positions, indices: mesh.indices };
  if (mesh.uvs) part.uvs = mesh.uvs;
  if (mesh.thickness) part.thickness = mesh.thickness;
  return part;
}

function buildPreviewMeshes(job: MeshJob): BuiltPart[] {
  switch (job.kind) {
    case "flat":
      return [{ role: "body", mesh: buildFlatJob(job, { withUvs: true, withThickness: true }) }];
    case "sphere":
      return [{ role: "body", mesh: buildSphereJob(job, { withUvs: true, withThickness: true }) }];
    case "keychain": {
      const { base, text } = buildKeychainParts(job, { withThickness: true });
      const parts: BuiltPart[] = [{ role: "base", mesh: base }];
      if (text) parts.push({ role: "text", mesh: text });
      return parts;
    }
  }
}

function buildSingleSolid(job: MeshJob): MeshBuildResult {
  switch (job.kind) {
    case "flat":
      return buildFlatJob(job);
    case "sphere":
      return buildSphereJob(job);
    case "keychain":
      return buildKeychainSolid(job);
  }
}

function buildAmfVolumes(job: MeshJob): { volumes: AmfVolume[]; meshes: MeshBuildResult[] } {
  if (job.kind === "keychain") {
    const { base, text } = buildKeychainParts(job);
    const volumes: AmfVolume[] = [{ mesh: base, name: "Base", color: KEYCHAIN_BASE_COLOR }];
    if (text) volumes.push({ mesh: text, name: "Text", color: KEYCHAIN_TEXT_COLOR });
    return { volumes, meshes: text ? [base, text] : [base] };
  }
  const body = buildSingleSolid(job);
  return { volumes: [{ mesh: body, name: "Body", color: BODY_COLOR }], meshes: [body] };
}

function validateMeshes(meshes: MeshBuildResult[]): ManifoldReport {
  return mergeManifoldReports(meshes.map((m) => checkManifold(m)));
}

function assertRequest(request: MeshRequest): void {
  if (!request || typeof request !== "object" || !request.job || !JOB_KINDS.has(request.job.kind)) {
    throw new Error("The mesh request is not valid.");
  }
  if (!OUTPUTS.has(request.output)) throw new Error(`Unsupported output format "${String(request.output)}".`);
}

/**
 * Process one request: progress messages, then exactly one preview, file or error response.
 * Never rejects; every failure becomes `{ type: "error" }` with the Error's message.
 * Previews and STL files are posted synchronously; an AMF is posted once its ZIP compression settles.
 */
export async function handleMeshRequest(request: MeshRequest, post: PostResponse): Promise<void> {
  const id = typeof request?.id === "number" ? request.id : -1;
  try {
    assertRequest(request);
    const { job, output } = request;

    if (output === "preview") {
      post({ id, type: "progress", stage: "mesh", message: "Building mesh…" }, []);
      const built = buildPreviewMeshes(job);
      const meshes = built.map((b) => b.mesh);
      let manifold: ManifoldReport | undefined;
      if (request.validate) {
        post({ id, type: "progress", stage: "validate", message: "Checking watertightness…" }, []);
        manifold = validateMeshes(meshes);
      }
      const stats = meshStats(meshes, manifold ? { manifold } : undefined);
      const parts = built.map((b) => toPart(b.role, b.mesh));
      post(
        { id, type: "preview", parts, stats },
        transferList(parts.flatMap((p) => [p.positions, p.indices, p.uvs, p.thickness])),
      );
      return;
    }

    post({ id, type: "progress", stage: "mesh", message: "Building mesh…" }, []);
    let meshes: MeshBuildResult[];
    let volumes: AmfVolume[] | null = null;
    if (output === "amf") {
      const built = buildAmfVolumes(job);
      meshes = built.meshes;
      volumes = built.volumes;
    } else {
      meshes = [buildSingleSolid(job)];
    }

    post({ id, type: "progress", stage: "validate", message: "Checking watertightness…" }, []);
    const manifold = validateMeshes(meshes);

    post({ id, type: "progress", stage: "write", message: "Writing file…" }, []);
    const name = typeof request.name === "string" && request.name.trim() ? request.name.trim() : "luna_litho";
    let buffer: ArrayBuffer;
    let mime: string;
    let extension: "stl" | "amf";
    if (volumes) {
      // Zipped like PrusaSlicer's own AMF: the keychain XML shrinks about 15× (REVIEW-NOTES R1).
      buffer = await writeZippedAmf(volumes, name);
      mime = "application/x-amf";
      extension = "amf";
    } else if (output === "stl-ascii") {
      buffer = writeAsciiStl(meshes[0], name);
      mime = "model/stl";
      extension = "stl";
    } else {
      buffer = writeBinaryStl(meshes[0]);
      mime = "model/stl";
      extension = "stl";
    }
    const stats = meshStats(meshes, { manifold, bytes: buffer.byteLength });
    post({ id, type: "file", buffer, mime, extension, stats }, [buffer]);
  } catch (error) {
    const message = error instanceof Error && error.message ? error.message : FALLBACK_ERROR;
    try {
      post({ id, type: "error", message }, []);
    } catch {
      // Posting can only fail if the port is gone; nothing left to report to.
    }
  }
}
