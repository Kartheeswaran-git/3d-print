import { handleMeshRequest } from "./handle";
import type { MeshRequest, MeshResponse } from "./protocol";

/** The parts of DedicatedWorkerGlobalScope this worker uses (the project compiles against the DOM lib). */
interface WorkerScope {
  onmessage: ((event: MessageEvent<MeshRequest>) => void) | null;
  postMessage(message: MeshResponse, transfer: Transferable[]): void;
}

const scope = self as unknown as WorkerScope;

scope.onmessage = (event) => {
  handleMeshRequest(event.data, (response, transfer) => scope.postMessage(response, transfer));
};
