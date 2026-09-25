"use client";

import { useEffect, useState } from "react";
import { MeshWorkerClient } from "./client";

/**
 * One MeshWorkerClient per component. The worker itself starts lazily on the first request (client only)
 * and is terminated on unmount; the client re-creates it on demand, so StrictMode's mount → unmount → mount
 * cycle keeps working.
 */
export function useMeshWorker(): MeshWorkerClient {
  const [client] = useState(() => new MeshWorkerClient());
  useEffect(() => () => client.dispose(), [client]);
  return client;
}
