import { describe, expect, it } from "vitest";
import { Mesh, MeshBasicMaterial, Raycaster, Vector3 } from "three";
import { makeDemoPlate } from "./demo-mesh";
import { buildPartGeometry } from "./geometry";
import { buildTriangleBvh, countNodes, partBvh, raycastBvh, raycastParts, type TriangleBvh } from "./raycast";

/** Axis-aligned square at height z facing +Z (counter-clockwise seen from above). */
function square(size: number, z: number) {
  const h = size / 2;
  return {
    positions: new Float32Array([-h, -h, z, h, -h, z, h, h, z, -h, h, z]),
    indices: new Uint32Array([0, 1, 2, 0, 2, 3]),
  };
}

/** Closed hollow ball (outer radius R, inner r), outward-wound: the inner surface faces the cavity. */
function hollowBall(outer: number, inner: number, segments = 24, rings = 12) {
  const positions: number[] = [];
  const indices: number[] = [];
  const surface = (radius: number, flip: boolean) => {
    const base = positions.length / 3;
    for (let r = 0; r <= rings; r++) {
      const phi = (r / rings) * Math.PI;
      for (let s = 0; s <= segments; s++) {
        const theta = (s / segments) * Math.PI * 2;
        positions.push(radius * Math.sin(phi) * Math.sin(theta), radius * Math.cos(phi), radius * Math.sin(phi) * Math.cos(theta));
      }
    }
    for (let r = 0; r < rings; r++) {
      for (let s = 0; s < segments; s++) {
        const a = base + r * (segments + 1) + s;
        const b = a + segments + 1;
        // (a, b, a+1) is counter-clockwise seen from outside with this parametrisation.
        if (flip) indices.push(a, a + 1, b, a + 1, b + 1, b);
        else indices.push(a, b, a + 1, a + 1, b, b + 1);
      }
    }
  };
  surface(outer, false);
  surface(inner, true);
  return { positions: new Float32Array(positions), indices: new Uint32Array(indices) };
}

/** Deterministic PRNG so failures reproduce. */
function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function expectValidTree(bvh: TriangleBvh, triangleCount: number) {
  expect(bvh.count.length).toBe(countNodes(triangleCount));
  expect(bvh.order.length).toBe(triangleCount);
  // Every triangle sits in exactly one leaf, inside that leaf's box; inner boxes contain their children.
  const seen = new Uint8Array(bvh.indices.length / 3);
  const { bounds, offset, count, order, positions, indices } = bvh;
  let outsideLeaf = 0;
  let outsideParent = 0;
  let badChild = 0;
  for (let node = 0; node < count.length; node++) {
    const k = node * 6;
    if (count[node] > 0) {
      for (let i = offset[node]; i < offset[node] + count[node]; i++) {
        const t = order[i];
        seen[t]++;
        for (let corner = 0; corner < 3; corner++) {
          const v = indices[t * 3 + corner] * 3;
          for (let axis = 0; axis < 3; axis++) {
            if (positions[v + axis] < bounds[k + axis] || positions[v + axis] > bounds[k + 3 + axis]) outsideLeaf++;
          }
        }
      }
    } else {
      for (const child of [node + 1, offset[node]]) {
        if (child <= node || child >= count.length) badChild++;
        for (let axis = 0; axis < 3; axis++) {
          if (bounds[child * 6 + axis] < bounds[k + axis] || bounds[child * 6 + 3 + axis] > bounds[k + 3 + axis]) {
            outsideParent++;
          }
        }
      }
    }
  }
  expect({ outsideLeaf, outsideParent, badChild }).toEqual({ outsideLeaf: 0, outsideParent: 0, badChild: 0 });
  expect(Array.from(order).every((t) => seen[t] === 1)).toBe(true);
}

describe("buildTriangleBvh", () => {
  it("builds a complete, consistent tree", () => {
    const plate = makeDemoPlate();
    const bvh = buildTriangleBvh(plate.positions, plate.indices);
    expect(bvh.positions).toBe(plate.positions);
    expect(bvh.indices).toBe(plate.indices);
    expectValidTree(bvh, plate.indices.length / 3);

    const ball = hollowBall(60, 58);
    expectValidTree(buildTriangleBvh(ball.positions, ball.indices), ball.indices.length / 3);
  });

  it("skips triangles that reference missing vertices", () => {
    const { positions } = square(10, 0);
    const bvh = buildTriangleBvh(positions, new Uint32Array([0, 1, 2, 0, 2, 9]));
    expect(Array.from(bvh.order)).toEqual([0]);
    expect(raycastBvh(bvh, { x: -4, y: 4, z: 5 }, { x: 0, y: 0, z: -1 })).toBeNull();
    expect(raycastBvh(bvh, { x: 4, y: -4, z: 5 }, { x: 0, y: 0, z: -1 })).not.toBeNull();
  });

  it("handles an empty mesh", () => {
    const bvh = buildTriangleBvh(new Float32Array(), new Uint32Array());
    expect(bvh.count.length).toBe(0);
    expect(raycastBvh(bvh, { x: 0, y: 0, z: 1 }, { x: 0, y: 0, z: -1 })).toBeNull();
  });

  it("sizes the node arrays exactly", () => {
    expect(countNodes(0)).toBe(0);
    expect(countNodes(1)).toBe(1);
    expect(countNodes(8)).toBe(1);
    expect(countNodes(9)).toBe(3);
    expect(countNodes(17)).toBe(5);
    // Leaves hold at least 4 triangles, so there are at most n/2 nodes.
    for (const n of [9, 100, 1000, 12345, 93392]) expect(countNodes(n)).toBeLessThanOrEqual(n / 2);
  });
});

describe("raycastBvh", () => {
  const { positions, indices } = square(10, 0);
  const bvh = buildTriangleBvh(positions, indices);

  it("hits a front face at the right point and distance", () => {
    const hit = raycastBvh(bvh, { x: 1, y: 2, z: 5 }, { x: 0, y: 0, z: -3 });
    expect(hit?.distance).toBeCloseTo(5, 10);
    expect(hit?.point[0]).toBeCloseTo(1, 10);
    expect(hit?.point[1]).toBeCloseTo(2, 10);
    expect(hit?.point[2]).toBeCloseTo(0, 10);
  });

  it("ignores back faces, misses and hits beyond `far`", () => {
    expect(raycastBvh(bvh, { x: 1, y: 2, z: -5 }, { x: 0, y: 0, z: 1 })).toBeNull();
    expect(raycastBvh(bvh, { x: 6, y: 0, z: 5 }, { x: 0, y: 0, z: -1 })).toBeNull();
    expect(raycastBvh(bvh, { x: 1, y: 2, z: 5 }, { x: 0, y: 0, z: 1 })).toBeNull();
    expect(raycastBvh(bvh, { x: 1, y: 2, z: 5 }, { x: 0, y: 0, z: -1 }, 4.9)).toBeNull();
    expect(raycastBvh(bvh, { x: 1, y: 2, z: 5 }, { x: 0, y: 0, z: 0 })).toBeNull();
  });

  it("never slips between triangles along a shared edge or through a shared vertex", () => {
    // (1, 1) lies on the diagonal both triangles share; (5, 5) is a corner they share.
    expect(raycastBvh(bvh, { x: 1, y: 1, z: 5 }, { x: 0, y: 0, z: -1 })?.distance).toBeCloseTo(5, 10);
    expect(raycastBvh(bvh, { x: 5, y: 5, z: 5 }, { x: 0, y: 0, z: -1 })?.distance).toBeCloseTo(5, 10);
    // The ball's +Z vertex is shared by six triangles.
    const ball = hollowBall(60, 58);
    const hit = raycastBvh(buildTriangleBvh(ball.positions, ball.indices), { x: 0, y: 0, z: 300 }, { x: 0, y: 0, z: -1 });
    expect(hit?.distance).toBeCloseTo(240, 3);
  });

  it("hits the outside of a hollow ball and skips walls seen from behind", () => {
    // Facets sit up to 1 mm inside the true spheres (60 and 58 mm).
    const ball = hollowBall(60, 58);
    const tree = buildTriangleBvh(ball.positions, ball.indices);
    const down = { x: 0, y: 0, z: -1 };
    const front = raycastBvh(tree, { x: 0.3, y: 0.2, z: 300 }, down);
    expect(front?.distance).toBeGreaterThanOrEqual(240 - 1e-4);
    expect(front?.distance).toBeLessThanOrEqual(241);
    // The inner wall faces the cavity, so from the centre it is a front face.
    const fromCentre = raycastBvh(tree, { x: 0.3, y: 0.2, z: 0 }, down);
    expect(fromCentre?.distance).toBeGreaterThanOrEqual(57);
    expect(fromCentre?.distance).toBeLessThanOrEqual(58 + 1e-4);
    // From inside the wall material the near inner wall is seen from behind; the ray crosses the cavity.
    const fromWall = raycastBvh(tree, { x: 0.3, y: 0.2, z: 59 }, down);
    expect(fromWall?.distance).toBeGreaterThanOrEqual(116);
    expect(fromWall?.distance).toBeLessThanOrEqual(117 + 1e-4);
  });

  it("agrees with three.js on random rays (front faces, nearest hit)", () => {
    const random = mulberry32(7);
    const meshes = [makeDemoPlate(), { ...hollowBall(60, 57, 40, 20), uvs: undefined, thickness: undefined }];
    const raycaster = new Raycaster();
    let hits = 0;
    for (const part of meshes) {
      const geometry = buildPartGeometry(part.positions, part.indices);
      const mesh = new Mesh(geometry, new MeshBasicMaterial());
      const bvh = buildTriangleBvh(part.positions, part.indices);
      for (let i = 0; i < 60; i++) {
        const origin = new Vector3(random() - 0.5, random() - 0.5, random() - 0.5).setLength(260);
        const aim = new Vector3((random() - 0.5) * 120, (random() - 0.5) * 120, (random() - 0.5) * 40);
        const direction = aim.sub(origin).normalize();
        raycaster.set(origin, direction);
        const expected = raycaster.intersectObject(mesh, false)[0];
        const actual = raycastBvh(bvh, origin, direction);
        if (!expected) {
          expect(actual).toBeNull();
          continue;
        }
        hits++;
        expect(actual).not.toBeNull();
        expect(actual!.distance).toBeCloseTo(expected.distance, 3);
        expect(new Vector3(...actual!.point).distanceTo(expected.point)).toBeLessThan(1e-3);
      }
      geometry.dispose();
    }
    expect(hits).toBeGreaterThan(40);
  });
});

describe("raycastParts", () => {
  it("returns the nearest hit over all parts, with its part index", () => {
    const low = square(10, 0);
    const high = square(4, 2);
    const hit = raycastParts([low, high], { x: 0, y: 0, z: 10 }, { x: 0, y: 0, z: -1 });
    expect(hit?.part).toBe(1);
    expect(hit?.distance).toBeCloseTo(8, 10);
    // Beside the small square only the large one is hit.
    expect(raycastParts([low, high], { x: 4, y: 4, z: 10 }, { x: 0, y: 0, z: -1 })?.part).toBe(0);
    expect(raycastParts([], { x: 0, y: 0, z: 10 }, { x: 0, y: 0, z: -1 })).toBeNull();
  });

  it("builds each part's tree once and rebuilds for new arrays", () => {
    const part = square(10, 0);
    const first = partBvh(part);
    expect(partBvh({ positions: part.positions, indices: part.indices })).toBe(first);
    expect(partBvh({ positions: part.positions, indices: new Uint32Array([0, 1, 2]) })).not.toBe(first);
  });
});
