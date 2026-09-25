import type { ViewerPart } from "./types";

/** Anything with x, y and z; three.js `Vector3` fits. */
export interface Vec3Like {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

/** Most triangles in one leaf. Small leaves keep a pick far below a millisecond on 100k-triangle previews. */
const LEAF_SIZE = 8;
/** Deepest possible tree for 2³² triangles, plus room: the traversal stack never grows past depth + 1. */
const STACK_SIZE = 64;
/** Smallest |det| treated as a real triangle; below it the triangle is degenerate or seen edge-on. */
const DET_EPSILON = 1e-12;
/** Barycentric slack so a ray through a shared edge or vertex never slips between neighbouring triangles. */
const EDGE_EPSILON = 1e-7;
/** Relative slack on a box's exit distance, so rounding never culls a ray that grazes an edge or corner. */
const BOX_SLACK = 1e-9;

/**
 * Bounding-volume hierarchy over an indexed triangle mesh, kept in flat typed arrays in depth-first
 * order: an inner node's left child is the next node. Built once per mesh and reused by every pick,
 * so picking costs a few dozen box tests instead of a pass over every triangle.
 */
export interface TriangleBvh {
  readonly positions: Float32Array;
  readonly indices: Uint32Array;
  /** Triangle numbers in leaf order. Triangles that reference missing vertices are left out. */
  readonly order: Uint32Array;
  /** Six floats per node: min x, y, z, then max x, y, z. */
  readonly bounds: Float32Array;
  /** Leaf: first slot in `order`. Inner node: index of the right child. */
  readonly offset: Uint32Array;
  /** Leaf: number of triangles (> 0). Inner node: 0. */
  readonly count: Uint32Array;
}

export interface RayHit {
  /** Distance from the ray origin, in the units of the positions. */
  distance: number;
  /** Triangle number: the hit triangle's vertices are `indices[3t…3t+2]`. */
  triangle: number;
  point: [number, number, number];
}

/** Build the hierarchy by median splits along the longest centroid axis. O(n log n); the input arrays are not copied. */
export function buildTriangleBvh(positions: Float32Array, indices: Uint32Array): TriangleBvh {
  const vertexCount = Math.floor(positions.length / 3);
  const total = Math.floor(indices.length / 3);
  const centroids = new Float32Array(total * 3);
  const triBounds = new Float32Array(total * 6);
  const valid = new Uint32Array(total);
  let n = 0;

  for (let t = 0; t < total; t++) {
    const a = indices[t * 3];
    const b = indices[t * 3 + 1];
    const c = indices[t * 3 + 2];
    if (a >= vertexCount || b >= vertexCount || c >= vertexCount) continue;
    valid[n++] = t;
    for (let axis = 0; axis < 3; axis++) {
      const va = positions[a * 3 + axis];
      const vb = positions[b * 3 + axis];
      const vc = positions[c * 3 + axis];
      centroids[t * 3 + axis] = (va + vb + vc) / 3;
      triBounds[t * 6 + axis] = Math.min(va, vb, vc);
      triBounds[t * 6 + 3 + axis] = Math.max(va, vb, vc);
    }
  }

  const order = n === total ? valid : valid.slice(0, n);
  const nodeCount = countNodes(n);
  const bounds = new Float32Array(nodeCount * 6);
  const offset = new Uint32Array(nodeCount);
  const count = new Uint32Array(nodeCount);
  let next = 0;

  const build = (start: number, size: number): number => {
    const node = next++;
    const k = node * 6;
    if (size <= LEAF_SIZE) {
      offset[node] = start;
      count[node] = size;
      bounds.fill(Infinity, k, k + 3);
      bounds.fill(-Infinity, k + 3, k + 6);
      for (let i = start; i < start + size; i++) {
        const tb = order[i] * 6;
        for (let axis = 0; axis < 3; axis++) {
          if (triBounds[tb + axis] < bounds[k + axis]) bounds[k + axis] = triBounds[tb + axis];
          if (triBounds[tb + 3 + axis] > bounds[k + 3 + axis]) bounds[k + 3 + axis] = triBounds[tb + 3 + axis];
        }
      }
      return node;
    }

    let minX = Infinity;
    let minY = Infinity;
    let minZ = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    let maxZ = -Infinity;
    for (let i = start; i < start + size; i++) {
      const c = order[i] * 3;
      const x = centroids[c];
      const y = centroids[c + 1];
      const z = centroids[c + 2];
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
      if (z < minZ) minZ = z;
      if (z > maxZ) maxZ = z;
    }
    const ex = maxX - minX;
    const ey = maxY - minY;
    const ez = maxZ - minZ;
    const axis = ex >= ey && ex >= ez ? 0 : ey >= ez ? 1 : 2;
    const half = size >> 1;
    selectByCentroid(order, centroids, axis, start, start + size - 1, start + half);

    const left = build(start, half);
    const right = build(start + half, size - half);
    offset[node] = right;
    count[node] = 0;
    for (let a = 0; a < 3; a++) {
      bounds[k + a] = Math.min(bounds[left * 6 + a], bounds[right * 6 + a]);
      bounds[k + 3 + a] = Math.max(bounds[left * 6 + 3 + a], bounds[right * 6 + 3 + a]);
    }
    return node;
  };

  if (n > 0) build(0, n);
  return { positions, indices, order, bounds, offset, count };
}

/** Exact node count of the median-split tree over `n` triangles, so the node arrays are allocated once. */
export function countNodes(n: number, memo: Map<number, number> = new Map()): number {
  if (n <= 0) return 0;
  if (n <= LEAF_SIZE) return 1;
  const known = memo.get(n);
  if (known !== undefined) return known;
  const half = n >> 1;
  const result = 1 + countNodes(half, memo) + countNodes(n - half, memo);
  memo.set(n, result);
  return result;
}

/**
 * Quickselect (Hoare partition, middle pivot: grid meshes arrive sorted): afterwards `order[k]` holds the
 * triangle whose centroid ranks k-th along `axis` in `order[lo..hi]`, with no larger centroid before it
 * and no smaller one after it.
 */
function selectByCentroid(order: Uint32Array, centroids: Float32Array, axis: number, lo: number, hi: number, k: number) {
  while (hi > lo) {
    const pivot = centroids[order[(lo + hi) >> 1] * 3 + axis];
    let i = lo;
    let j = hi;
    while (i <= j) {
      while (centroids[order[i] * 3 + axis] < pivot) i++;
      while (centroids[order[j] * 3 + axis] > pivot) j--;
      if (i <= j) {
        const swap = order[i];
        order[i] = order[j];
        order[j] = swap;
        i++;
        j--;
      }
    }
    if (k <= j) hi = j;
    else if (k >= i) lo = i;
    else return;
  }
}

/**
 * Nearest front-facing triangle hit by the ray, closer than `far`. Back faces are skipped, matching the
 * viewer's single-sided materials: a pick lands on the surface the camera actually shows.
 * Winding is counter-clockwise seen from outside, as {@link ViewerPart} requires.
 */
export function raycastBvh(bvh: TriangleBvh, origin: Vec3Like, direction: Vec3Like, far = Infinity): RayHit | null {
  const { positions: p, indices: idx, order, bounds: b, offset, count } = bvh;
  if (count.length === 0) return null;
  const length = Math.hypot(direction.x, direction.y, direction.z);
  if (!(length > 0) || !Number.isFinite(length)) return null;
  const ox = origin.x;
  const oy = origin.y;
  const oz = origin.z;
  const dx = direction.x / length;
  const dy = direction.y / length;
  const dz = direction.z / length;
  const ix = 1 / dx;
  const iy = 1 / dy;
  const iz = 1 / dz;

  /**
   * Distance at which the ray enters the node's box (0 when it starts inside), or Infinity when it misses.
   * Boxes are closed: a ray running along a face still enters, and the exit gets a hair of slack against rounding.
   */
  const enter = (node: number): number => {
    const k = node * 6;
    let near = 0;
    let exit = Infinity;
    // A zero direction component never crosses that slab: inside it for all t, or never (and 0 × ∞ would be NaN).
    if (dx === 0) {
      if (ox < b[k] || ox > b[k + 3]) return Infinity;
    } else {
      const t0 = (b[k] - ox) * ix;
      const t1 = (b[k + 3] - ox) * ix;
      near = Math.max(near, Math.min(t0, t1));
      exit = Math.min(exit, Math.max(t0, t1));
    }
    if (dy === 0) {
      if (oy < b[k + 1] || oy > b[k + 4]) return Infinity;
    } else {
      const t0 = (b[k + 1] - oy) * iy;
      const t1 = (b[k + 4] - oy) * iy;
      near = Math.max(near, Math.min(t0, t1));
      exit = Math.min(exit, Math.max(t0, t1));
    }
    if (dz === 0) {
      if (oz < b[k + 2] || oz > b[k + 5]) return Infinity;
    } else {
      const t0 = (b[k + 2] - oz) * iz;
      const t1 = (b[k + 5] - oz) * iz;
      near = Math.max(near, Math.min(t0, t1));
      exit = Math.min(exit, Math.max(t0, t1));
    }
    return near <= exit + BOX_SLACK * Math.max(1, exit) ? near : Infinity;
  };

  let best = far;
  let bestTriangle = -1;
  const stack = new Uint32Array(STACK_SIZE);
  const stackNear = new Float64Array(STACK_SIZE);
  const rootNear = enter(0);
  if (rootNear >= best) return null;
  stack[0] = 0;
  stackNear[0] = rootNear;
  let sp = 1;

  while (sp > 0) {
    sp--;
    if (stackNear[sp] >= best) continue;
    const node = stack[sp];
    const size = count[node];

    if (size === 0) {
      const left = node + 1;
      const right = offset[node];
      const nearLeft = enter(left);
      const nearRight = enter(right);
      // Push the farther child first so the nearer one is searched first and can prune the other.
      const leftNearer = nearLeft <= nearRight;
      const farNode = leftNearer ? right : left;
      const farNear = leftNearer ? nearRight : nearLeft;
      const nearNode = leftNearer ? left : right;
      const nearNear = leftNearer ? nearLeft : nearRight;
      if (farNear < best) {
        stack[sp] = farNode;
        stackNear[sp++] = farNear;
      }
      if (nearNear < best) {
        stack[sp] = nearNode;
        stackNear[sp++] = nearNear;
      }
      continue;
    }

    const end = offset[node] + size;
    for (let i = offset[node]; i < end; i++) {
      const t = order[i];
      const a = idx[t * 3] * 3;
      const bi = idx[t * 3 + 1] * 3;
      const ci = idx[t * 3 + 2] * 3;
      const ax = p[a];
      const ay = p[a + 1];
      const az = p[a + 2];
      const e1x = p[bi] - ax;
      const e1y = p[bi + 1] - ay;
      const e1z = p[bi + 2] - az;
      const e2x = p[ci] - ax;
      const e2y = p[ci + 1] - ay;
      const e2z = p[ci + 2] - az;
      // Möller–Trumbore. det = −direction · (e1 × e2), so a front face (normal against the ray) has det > 0.
      const px = dy * e2z - dz * e2y;
      const py = dz * e2x - dx * e2z;
      const pz = dx * e2y - dy * e2x;
      const det = e1x * px + e1y * py + e1z * pz;
      if (det <= DET_EPSILON) continue;
      const inv = 1 / det;
      const sx = ox - ax;
      const sy = oy - ay;
      const sz = oz - az;
      const u = (sx * px + sy * py + sz * pz) * inv;
      if (u < -EDGE_EPSILON || u > 1 + EDGE_EPSILON) continue;
      const qx = sy * e1z - sz * e1y;
      const qy = sz * e1x - sx * e1z;
      const qz = sx * e1y - sy * e1x;
      const v = (dx * qx + dy * qy + dz * qz) * inv;
      if (v < -EDGE_EPSILON || u + v > 1 + EDGE_EPSILON) continue;
      const distance = (e2x * qx + e2y * qy + e2z * qz) * inv;
      if (distance < 0 || distance >= best) continue;
      best = distance;
      bestTriangle = t;
    }
  }

  if (bestTriangle < 0) return null;
  return { distance: best, triangle: bestTriangle, point: [ox + dx * best, oy + dy * best, oz + dz * best] };
}

// Keyed by the positions array: parts are immutable, so a mesh keeps its tree until it is garbage-collected.
const bvhCache = new WeakMap<Float32Array, TriangleBvh>();

/** The part's hierarchy, built on first use and cached for as long as its arrays live. */
export function partBvh(part: Pick<ViewerPart, "positions" | "indices">): TriangleBvh {
  const cached = bvhCache.get(part.positions);
  if (cached && cached.indices === part.indices) return cached;
  const bvh = buildTriangleBvh(part.positions, part.indices);
  bvhCache.set(part.positions, bvh);
  return bvh;
}

/** Nearest front-facing hit over all parts, with the index of the part it belongs to. */
export function raycastParts(
  parts: readonly Pick<ViewerPart, "positions" | "indices">[],
  origin: Vec3Like,
  direction: Vec3Like,
): (RayHit & { part: number }) | null {
  let best: RayHit | null = null;
  let bestPart = -1;
  for (let i = 0; i < parts.length; i++) {
    const hit = raycastBvh(partBvh(parts[i]), origin, direction, best?.distance ?? Infinity);
    if (hit) {
      best = hit;
      bestPart = i;
    }
  }
  return best ? { ...best, part: bestPart } : null;
}
