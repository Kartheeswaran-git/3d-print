import type { ViewerPart } from "./types";

const WIDTH_MM = 90;
const HEIGHT_MM = 64;
const PITCH_MM = 0.5;
const BASE_MM = 0.8;
const MIN_RELIEF_MM = 0.8;
const MAX_RELIEF_MM = 3;

/** Wall-thickness range of {@link makeDemoPlate} (base + relief), for the viewer's backlight settings. */
export const DEMO_PLATE_THICKNESS = { min: BASE_MM + MIN_RELIEF_MM, max: BASE_MM + MAX_RELIEF_MM } as const;

/**
 * A small procedural lithophane (a cratered moon over rolling hills with a few stars) as a closed,
 * outward-wound solid in the builders' coordinate system, for smoke-testing the viewer in isolation.
 */
export function makeDemoPlate(): ViewerPart {
  const cols = Math.round(WIDTH_MM / PITCH_MM);
  const rows = Math.round(HEIGHT_MM / PITCH_MM);
  const w = cols + 1;
  const h = rows + 1;
  const top = w * h;
  const positions = new Float32Array(top * 2 * 3);
  const uvs = new Float32Array(top * 2 * 2);
  const thickness = new Float32Array(top * 2);

  for (let r = 0; r < h; r++) {
    for (let c = 0; c < w; c++) {
      const k = r * w + c;
      const u = c / cols;
      const v = r / rows;
      const wall = BASE_MM + MIN_RELIEF_MM + (1 - demoLuminance(u, v)) * (MAX_RELIEF_MM - MIN_RELIEF_MM);
      const x = (u - 0.5) * WIDTH_MM;
      const y = (0.5 - v) * HEIGHT_MM;
      positions.set([x, y, wall], k * 3);
      positions.set([x, y, 0], (k + top) * 3);
      uvs.set([u, 1 - v], k * 2);
      uvs.set([u, 1 - v], (k + top) * 2);
      thickness[k] = wall;
      thickness[k + top] = wall;
    }
  }

  const triangles = cols * rows * 4 + (cols + rows) * 4;
  const indices = new Uint32Array(triangles * 3);
  let n = 0;
  const tri = (a: number, b: number, c: number) => {
    indices[n++] = a;
    indices[n++] = b;
    indices[n++] = c;
  };

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const a = r * w + c;
      const b = a + 1;
      const d = a + w;
      const e = d + 1;
      // Relief faces +Z, back faces -Z.
      tri(a, d, b);
      tri(b, d, e);
      tri(a + top, b + top, d + top);
      tri(b + top, e + top, d + top);
    }
  }

  // Side walls: top edge t0→t1 above bottom edge b0→b1, wound to face `outward`.
  const wall = (t0: number, t1: number, outward: [number, number]) => {
    const b0 = t0 + top;
    const b1 = t1 + top;
    if (faces(positions, t0, b0, t1, outward)) {
      tri(t0, b0, t1);
      tri(t1, b0, b1);
    } else {
      tri(t0, t1, b0);
      tri(t1, b1, b0);
    }
  };
  for (let c = 0; c < cols; c++) {
    wall(c, c + 1, [0, 1]);
    wall(rows * w + c, rows * w + c + 1, [0, -1]);
  }
  for (let r = 0; r < rows; r++) {
    wall(r * w, (r + 1) * w, [-1, 0]);
    wall(r * w + cols, (r + 1) * w + cols, [1, 0]);
  }

  return { key: "demo", role: "body", positions, indices, uvs, thickness, color: "#f2ece2" };
}

/** True when triangle (a, b, c) faces along the horizontal direction `outward`. */
function faces(p: Float32Array, a: number, b: number, c: number, outward: [number, number]): boolean {
  const ax = p[a * 3];
  const ay = p[a * 3 + 1];
  const az = p[a * 3 + 2];
  const ux = p[b * 3] - ax;
  const uy = p[b * 3 + 1] - ay;
  const uz = p[b * 3 + 2] - az;
  const vx = p[c * 3] - ax;
  const vy = p[c * 3 + 1] - ay;
  const vz = p[c * 3 + 2] - az;
  const nx = uy * vz - uz * vy;
  const ny = uz * vx - ux * vz;
  return nx * outward[0] + ny * outward[1] > 0;
}

/** 0 = dark (thick wall), 1 = light (thin wall); v = 0 is the top edge. */
function demoLuminance(u: number, v: number): number {
  const aspect = WIDTH_MM / HEIGHT_MM;
  const x = u * aspect;
  const y = v;

  // Moon with a soft halo, limb darkening and craters.
  const mx = 0.68 * aspect;
  const my = 0.34;
  const mr = 0.2;
  const dm = Math.hypot(x - mx, y - my) / mr;

  // Night sky, slightly brighter towards the horizon and around the moon.
  let lum = 0.2 + 0.18 * y + 0.22 * Math.exp(-Math.max(0, dm - 1) * 5);
  if (dm < 1) {
    let moon = 0.95 - 0.35 * dm ** 4;
    const craters: [number, number, number, number][] = [
      [-0.35, -0.3, 0.22, 0.28],
      [0.3, 0.1, 0.3, 0.22],
      [-0.1, 0.45, 0.16, 0.3],
      [0.45, -0.45, 0.12, 0.25],
      [-0.5, 0.25, 0.1, 0.2],
    ];
    for (const [cx, cy, cr, depth] of craters) {
      const dc = Math.hypot((x - mx) / mr - cx, (y - my) / mr - cy) / cr;
      if (dc < 1.25) moon -= depth * Math.exp(-dc * dc * 2.2) - (dc > 0.9 ? 0.08 * (1.25 - dc) : 0);
    }
    lum += (moon - lum) * smoothstep(1, 0.94, dm);
  }

  // Stars.
  const stars: [number, number][] = [
    [0.18, 0.14],
    [0.42, 0.24],
    [0.3, 0.42],
    [1.15, 0.12],
    [1.3, 0.38],
    [0.08, 0.36],
  ];
  for (const [sx, sy] of stars) {
    const ds = Math.hypot(x - sx, y - sy);
    lum += 0.8 * Math.exp(-(ds * ds) / 0.00008);
  }

  // Rolling hills in the foreground.
  const hill = 0.78 + 0.06 * Math.sin(x * 5.1 + 0.6) + 0.035 * Math.sin(x * 11.3 + 2.1);
  const nearHill = 0.88 + 0.05 * Math.sin(x * 3.7 + 2.4);
  lum += (0.3 - lum) * smoothstep(hill - 0.012, hill + 0.012, y);
  lum += (0.08 - lum) * smoothstep(nearHill - 0.012, nearHill + 0.012, y);

  return Math.min(1, Math.max(0, lum));
}

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}
