/**
 * Shared fixtures for the geometry, export and worker tests (not used by the app).
 */
import type { MeshData, ScalarField } from "./types";

/** Deterministic PRNG (mulberry32) so failures are reproducible. */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function field(width: number, height: number, fn: (x: number, y: number) => number): ScalarField {
  const values = new Float32Array(width * height);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) values[y * width + x] = fn(x, y);
  return { width, height, values };
}

export function randomField(width: number, height: number, seed: number): ScalarField {
  const r = rng(seed);
  return field(width, height, () => r());
}

/** Irregular blobs plus salt noise: plenty of diagonal-only contacts and islands. */
export function blobMask(width: number, height: number, seed: number): ScalarField {
  const r = rng(seed);
  const blobs = Array.from({ length: 6 }, () => ({ x: r(), y: r(), s: 0.08 + r() * 0.18 }));
  return field(width, height, (x, y) => {
    const u = x / (width - 1);
    const v = y / (height - 1);
    let c = 0;
    for (const b of blobs) c += Math.exp(-((u - b.x) ** 2 + (v - b.y) ** 2) / (2 * b.s * b.s));
    return Math.min(1, c) * 0.8 + r() * 0.35;
  });
}

/** Signed volume via the divergence theorem; positive when triangles are wound CCW seen from outside. */
export function signedVolume(mesh: MeshData): number {
  const { positions: p, indices: idx } = mesh;
  let sum = 0;
  for (let i = 0; i < idx.length; i += 3) {
    const a = idx[i] * 3;
    const b = idx[i + 1] * 3;
    const c = idx[i + 2] * 3;
    sum +=
      p[a] * (p[b + 1] * p[c + 2] - p[b + 2] * p[c + 1]) -
      p[a + 1] * (p[b] * p[c + 2] - p[b + 2] * p[c]) +
      p[a + 2] * (p[b] * p[c + 1] - p[b + 1] * p[c]);
  }
  return sum / 6;
}

/**
 * Orientation consistency: every directed edge appears exactly once and its reverse exactly once.
 * Returns the number of offending directed edges (0 for a closed, consistently wound surface).
 */
export function orientationErrors(mesh: MeshData): number {
  const V = mesh.positions.length / 3;
  const directed = new Map<number, number>();
  const idx = mesh.indices;
  for (let i = 0; i < idx.length; i += 3) {
    for (let e = 0; e < 3; e++) {
      const a = idx[i + e];
      const b = idx[i + ((e + 1) % 3)];
      const key = a * V + b;
      directed.set(key, (directed.get(key) ?? 0) + 1);
    }
  }
  let errors = 0;
  for (const [key, count] of directed) {
    const a = Math.floor(key / V);
    const b = key - a * V;
    if (count !== 1 || directed.get(b * V + a) !== 1) errors++;
  }
  return errors;
}

/** Tiny XML well-formedness check: balanced tags, one root, no stray '&' or '<' in text. */
export function isWellFormedXml(xml: string): boolean {
  const body = xml.replace(/^<\?xml[^?]*\?>\s*/, "");
  const tokens = body.match(/<[^>]*>|[^<]+/g) ?? [];
  const stack: string[] = [];
  let roots = 0;
  for (const token of tokens) {
    if (!token.startsWith("<")) {
      if (/&(?!(amp|lt|gt|quot|apos);)/.test(token)) return false;
      if (stack.length === 0 && token.trim()) return false;
      continue;
    }
    const close = /^<\/([A-Za-z_][\w.-]*)\s*>$/.exec(token);
    if (close) {
      if (stack.pop() !== close[1]) return false;
      continue;
    }
    const open = /^<([A-Za-z_][\w.-]*)(\s+[A-Za-z_][\w.-]*="[^"<&]*(?:&(?:amp|lt|gt|quot|apos);[^"<&]*)*")*\s*(\/?)>$/.exec(token);
    if (!open) return false;
    if (stack.length === 0) roots++;
    if (open[3] !== "/") stack.push(open[1]);
  }
  return stack.length === 0 && roots === 1;
}
