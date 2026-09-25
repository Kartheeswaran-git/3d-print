import type { ShapeTest } from "./shapes";
import type { HeightMap, MeshBuildResult, ScalarField, ThicknessMapping } from "./types";

/** Smallest relief height above the base, so walls never collapse to zero height (FIXES G6). */
export const DEFAULT_MIN_HEIGHT_MM = 0.05;

/**
 * Outline snapping moves a vertex at most this far (in cells) along each axis. Below ½ cell, the squares that
 * vertices can reach never overlap, so no two vertices meet and no two outline edges cross.
 */
export const MAX_OUTLINE_SHIFT = 0.45;
/** Smallest top-face triangle after outline snapping, as a fraction of its unsnapped area (½ cell). */
export const MIN_SNAPPED_AREA_RATIO = 0.1;
/** Bisection steps that locate the contour between two cell centres (precision 2⁻¹² cell). */
const CONTOUR_STEPS = 12;
/** Times an offending vertex's shift is halved before it goes back onto the grid. */
const MAX_SHIFT_HALVINGS = 4;

export const NO_PRINTABLE_AREA_MESSAGE =
  "The selected shape has no printable area. Adjust the shape, mask or size so part of the piece is solid.";

/** Throws a readable Error unless `field` is a well-formed grid of at least `minW` × `minH` samples. */
export function assertField(field: ScalarField, label: string, minW = 2, minH = 2): void {
  if (
    !field ||
    !Number.isInteger(field.width) ||
    !Number.isInteger(field.height) ||
    field.width < minW ||
    field.height < minH
  ) {
    throw new Error(`The ${label} grid must be at least ${minW} × ${minH} samples.`);
  }
  if (!(field.values instanceof Float32Array) || field.values.length < field.width * field.height) {
    throw new Error(`The ${label} data does not match its ${field.width} × ${field.height} size.`);
  }
}

/** thickness = min + (1 - lum^gamma) · (max - min), with lum clamped to 0..1 (NaN counts as white). */
export function luminanceToHeights(lum: ScalarField, mapping: ThicknessMapping): HeightMap {
  const { minThickness: min, maxThickness: max } = mapping;
  const gamma = mapping.gamma > 0 && Number.isFinite(mapping.gamma) ? mapping.gamma : 1;
  const range = max - min;
  const n = lum.width * lum.height;
  const src = lum.values;
  const out = new Float32Array(n);
  if (gamma === 1) {
    for (let i = 0; i < n; i++) {
      const l = src[i];
      const c = l > 0 ? (l < 1 ? l : 1) : 0;
      out[i] = min + (1 - c) * range;
    }
  } else {
    for (let i = 0; i < n; i++) {
      const l = src[i];
      const c = l > 0 ? (l < 1 ? l : 1) : 0;
      out[i] = min + (1 - Math.pow(c, gamma)) * range;
    }
  }
  return { width: lum.width, height: lum.height, values: out };
}

/** cells has (cols = w-1) × (rows = h-1) entries, 1 = solid; sampled at cell centres. */
export function buildCellMask(cols: number, rows: number, inside: (u: number, v: number) => boolean): Uint8Array {
  const cells = new Uint8Array(Math.max(0, cols) * Math.max(0, rows));
  for (let y = 0; y < rows; y++) {
    const v = (y + 0.5) / rows;
    const row = y * cols;
    for (let x = 0; x < cols; x++) {
      if (inside((x + 0.5) / cols, v)) cells[row + x] = 1;
    }
  }
  return cells;
}

/**
 * Cell mask from a coverage field sampled on the same point grid (w × h points → (w-1) × (h-1) cells).
 * A cell is solid when the coverage at its centre (mean of its four corners) exceeds `threshold`.
 */
export function buildFieldCellMask(field: ScalarField, threshold: number): Uint8Array {
  const w = field.width;
  const cols = w - 1;
  const rows = field.height - 1;
  const src = field.values;
  const cells = new Uint8Array(cols * rows);
  const limit = threshold * 4;
  for (let y = 0; y < rows; y++) {
    const r0 = y * w;
    const r1 = r0 + w;
    const out = y * cols;
    for (let x = 0; x < cols; x++) {
      if (src[r0 + x] + src[r0 + x + 1] + src[r1 + x] + src[r1 + x + 1] > limit) cells[out + x] = 1;
    }
  }
  return cells;
}

/** True when the 2×2 block with top-left cell (x, y) is solid only along one diagonal. */
function isCheckerBlock(cells: Uint8Array, cols: number, x: number, y: number): boolean {
  const i = y * cols + x;
  const a = cells[i];
  const b = cells[i + 1];
  const c = cells[i + cols];
  const d = cells[i + cols + 1];
  return a === d && b === c && a !== b;
}

/**
 * Mutates `cells`: for every 2×2 block in a diagonal-only (checkerboard) configuration, set one empty cell solid;
 * repeat until stable. Returns number of cells filled. Afterwards no two solid cells touch only at a corner,
 * so every vertical wall edge of the flat mesh is shared by exactly two triangles (FIXES G4).
 */
export function resolveDiagonalContacts(cells: Uint8Array, cols: number, rows: number): number {
  if (cols < 2 || rows < 2) return 0;
  const bw = cols - 1;
  const bh = rows - 1;
  const stack: number[] = [];
  for (let y = 0; y < bh; y++) {
    for (let x = 0; x < bw; x++) {
      if (isCheckerBlock(cells, cols, x, y)) stack.push(y * bw + x);
    }
  }
  let filled = 0;
  while (stack.length > 0) {
    const block = stack.pop() as number;
    const bx = block % bw;
    const by = (block - bx) / bw;
    if (!isCheckerBlock(cells, cols, bx, by)) continue;
    const i = by * cols + bx;
    // Solid on the main diagonal → fill the top-right cell; solid on the anti-diagonal → fill the top-left cell.
    const fx = cells[i] === 1 ? bx + 1 : bx;
    const fy = by;
    cells[fy * cols + fx] = 1;
    filled++;
    // Filling can create a new checkerboard only in the four blocks that contain the filled cell.
    for (let ny = fy - 1; ny <= fy; ny++) {
      if (ny < 0 || ny >= bh) continue;
      for (let nx = fx - 1; nx <= fx; nx++) {
        if (nx < 0 || nx >= bw) continue;
        if (isCheckerBlock(cells, cols, nx, ny)) stack.push(ny * bw + nx);
      }
    }
  }
  return filled;
}

export interface FlatMeshOptions {
  /** mm of relief above the base, per grid point (w × h points). */
  heights: HeightMap;
  /** From buildCellMask; diagonal contacts are resolved here on a copy (idempotent). */
  cells: Uint8Array;
  widthMm: number;
  heightMm: number;
  /** Solid slab under the relief; top z = zOffsetMm + baseMm + max(minHeightMm, heights). */
  baseMm: number;
  /** Default 0.05 (FIXES G6). */
  minHeightMm?: number;
  /** Default 0; shifts the whole solid (keychain text sits on the base). */
  zOffsetMm?: number;
  withUvs?: boolean;
  /** Per-vertex wall thickness (top vertices: base+relief, bottom vertices: same value as their top twin). */
  withThickness?: boolean;
  /** Bottom surface Z-coordinates. If provided, replaces the flat zOffsetMm plane. Must have w x h values. */
  bottoms?: Float32Array;
  /**
   * The exact shape the cells were sampled from (u, v in 0..1, v = 0 top; true = solid). When given, outline
   * vertices are snapped onto its contour (see {@link snapOutline}) so the walls follow the true outline
   * instead of the cell staircase.
   */
  inside?: ShapeTest;
}

/** Outline snapping result for a (cols + 1) × (rows + 1) point grid; see {@link snapOutline}. */
export interface OutlineSnap {
  /** In-plane shift per grid point in cells (x right, y down the rows), 2 values each; 0 = stays on the grid. */
  shift: Float32Array;
  /** Per cell: 1 = split along the 00–11 diagonal instead of the usual 01–10 one. */
  flip: Uint8Array;
}

/**
 * Snap the outline of a cell mask onto the contour of `inside`. `cells` must be free of diagonal-only contacts
 * (resolveDiagonalContacts), so every outline point has exactly two outline edges.
 *
 * Each outline edge separates a solid cell from an empty one (or the grid border, whose crossing is the edge
 * midpoint). The contour crosses the line joining the two cell centres, which runs through the edge's
 * midpoint; bisection finds that crossing (one cell further out where `inside` disagrees with the cells, e.g.
 * for cells filled by the diagonal fix). Each outline vertex moves to the mean of its two edges' crossings,
 * which lies on the contour wherever it is locally straight (marching-squares style), then steps onto the
 * contour along the normal of the chord between the crossings where it curves. Shifts are clamped to
 * ±MAX_OUTLINE_SHIFT and points on the grid border only slide along it.
 *
 * Where a staircase corner has three outline corners in one triangle, snapping all three onto a straight
 * contour would flatten it, so each outline cell is split along the diagonal whose smaller triangle is larger.
 * Any top-face triangle still smaller than MIN_SNAPPED_AREA_RATIO of its unsnapped area (thin tips, one-cell
 * strips) has its corners' shifts halved, then zeroed, until every triangle passes. Vertices, triangles and
 * walls stay the same; the result is deterministic.
 */
export function snapOutline(cells: Uint8Array, cols: number, rows: number, inside: ShapeTest): OutlineSnap {
  const w = cols + 1;
  const shift = new Float32Array(w * (rows + 1) * 2);
  const flip = new Uint8Array(cols * rows);
  const count = new Uint8Array(w * (rows + 1));
  const solidAt = (gx: number, gy: number) => inside(gx / cols, gy / rows);
  /**
   * Where the contour crosses the line from a solid cell's centre s (t = 0) to an empty neighbour's centre e
   * (t = 1). Normally 0 < t < 1; when the test disagrees with the cells it looks one cell further: behind s
   * (−1 < t < 0) for a cell filled by the diagonal fix, beyond e (1 < t < 2) when e's centre tests solid.
   */
  const crossing = (sx: number, sy: number, ex: number, ey: number): number => {
    const dx = ex - sx;
    const dy = ey - sy;
    let lo: number; // solidAt(lo) is true, solidAt(hi) is false.
    let hi: number;
    if (solidAt(sx, sy)) {
      if (!solidAt(ex, ey)) [lo, hi] = [0, 1];
      else if (!solidAt(ex + dx, ey + dy)) [lo, hi] = [2, 1];
      else return 1;
    } else if (solidAt(sx - dx, sy - dy)) [lo, hi] = [-1, 0];
    else return 0;
    for (let i = 0; i < CONTOUR_STEPS; i++) {
      const t = (lo + hi) / 2;
      if (solidAt(sx + dx * t, sy + dy * t)) lo = t;
      else hi = t;
    }
    return (lo + hi) / 2;
  };
  /** Offset t (|t| < ½) that puts (mx, my) + t·(nx, ny) on the contour; 0 when both ends of that range agree. */
  const project = (mx: number, my: number, nx: number, ny: number): number => {
    const before = solidAt(mx - nx / 2, my - ny / 2);
    if (before === solidAt(mx + nx / 2, my + ny / 2)) return 0;
    let lo = before ? -0.5 : 0.5; // solidAt(lo) is true, solidAt(hi) is false.
    let hi = -lo;
    for (let i = 0; i < CONTOUR_STEPS; i++) {
      const t = (lo + hi) / 2;
      if (solidAt(mx + nx * t, my + ny * t)) lo = t;
      else hi = t;
    }
    return (lo + hi) / 2;
  };
  // Per point: the sum of its outline edges' crossings and the first of them (both relative to the point).
  const first = new Float32Array(shift.length);
  const addCrossing = (q: number, rx: number, ry: number) => {
    if (count[q] === 0) {
      first[q * 2] = rx;
      first[q * 2 + 1] = ry;
    }
    shift[q * 2] += rx;
    shift[q * 2 + 1] += ry;
    count[q]++;
  };
  /** Record the crossing (gx, gy) of the outline edge from grid point (ax, ay) to (bx, by) at both endpoints. */
  const addEdge = (ax: number, ay: number, bx: number, by: number, gx: number, gy: number) => {
    addCrossing(ay * w + ax, gx - ax, gy - ay);
    addCrossing(by * w + bx, gx - bx, gy - by);
  };

  for (let y = 0; y < rows; y++) {
    const row = y * cols;
    const cy = y + 0.5;
    for (let x = 0; x < cols; x++) {
      if (cells[row + x] !== 1) continue;
      const cx = x + 0.5;
      if (x === 0) addEdge(x, y, x, y + 1, 0, cy);
      else if (cells[row + x - 1] !== 1) addEdge(x, y, x, y + 1, cx - crossing(cx, cy, cx - 1, cy), cy);
      if (x === cols - 1) addEdge(x + 1, y, x + 1, y + 1, cols, cy);
      else if (cells[row + x + 1] !== 1) addEdge(x + 1, y, x + 1, y + 1, cx + crossing(cx, cy, cx + 1, cy), cy);
      if (y === 0) addEdge(x, y, x + 1, y, cx, 0);
      else if (cells[row - cols + x] !== 1) addEdge(x, y, x + 1, y, cx, cy - crossing(cx, cy, cx, cy - 1));
      if (y === rows - 1) addEdge(x, y + 1, x + 1, y + 1, cx, rows);
      else if (cells[row + cols + x] !== 1) addEdge(x, y + 1, x + 1, y + 1, cx, cy + crossing(cx, cy, cx, cy + 1));
    }
  }
  const clamp = (d: number) => (d > MAX_OUTLINE_SHIFT ? MAX_OUTLINE_SHIFT : d < -MAX_OUTLINE_SHIFT ? -MAX_OUTLINE_SHIFT : d);
  let moved = false;
  for (let p = 0; p < count.length; p++) {
    const n = count[p];
    if (n === 0) continue;
    const gx = p % w;
    const gy = (p - gx) / w;
    const borderX = gx === 0 || gx === cols;
    const borderY = gy === 0 || gy === rows;
    let dx = shift[p * 2] / n;
    let dy = shift[p * 2 + 1] / n;
    if (n === 2 && !borderX && !borderY) {
      // The mean is on the contour where it is straight; where it curves (tips, tight bends), step onto it
      // along the normal of the chord between the two crossings.
      const chordX = shift[p * 2] - 2 * first[p * 2];
      const chordY = shift[p * 2 + 1] - 2 * first[p * 2 + 1];
      const length = Math.hypot(chordX, chordY);
      if (length > 1e-6) {
        const nx = -chordY / length;
        const ny = chordX / length;
        const t = project(gx + dx, gy + dy, nx, ny);
        dx += nx * t;
        dy += ny * t;
      }
    }
    dx = borderX ? 0 : clamp(dx);
    dy = borderY ? 0 : clamp(dy);
    shift[p * 2] = dx;
    shift[p * 2 + 1] = dy;
    if (dx !== 0 || dy !== 0) moved = true;
  }
  if (!moved) return { shift, flip };

  /** Twice the area of triangle a, b, c (grid points, cell units: 1 unsnapped), positive when CCW seen from +Z. */
  const twiceArea = (a: number, b: number, c: number) => {
    const ax = (a % w) + shift[a * 2];
    const ay = Math.floor(a / w) + shift[a * 2 + 1];
    const ux = (b % w) + shift[b * 2] - ax;
    const uy = Math.floor(b / w) + shift[b * 2 + 1] - ay;
    const vx = (c % w) + shift[c * 2] - ax;
    const vy = Math.floor(c / w) + shift[c * 2 + 1] - ay;
    // Rows grow downwards (−Y), so the grid-space cross product has the opposite sign.
    return uy * vx - ux * vy;
  };
  const isMoved = (p: number) => shift[p * 2] !== 0 || shift[p * 2 + 1] !== 0;

  // Solid cells with a shifted corner are the only ones snapping can shrink or flip; pick their diagonal.
  const touched: number[] = [];
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const cell = y * cols + x;
      if (cells[cell] !== 1) continue;
      const p = y * w + x;
      if (!isMoved(p) && !isMoved(p + 1) && !isMoved(p + w) && !isMoved(p + w + 1)) continue;
      touched.push(cell);
      const usual = Math.min(twiceArea(p, p + w, p + 1), twiceArea(p + w, p + w + 1, p + 1));
      const other = Math.min(twiceArea(p, p + w, p + w + 1), twiceArea(p, p + w + 1, p + 1));
      if (other > usual) flip[cell] = 1;
    }
  }

  const flagged = new Uint8Array(count.length);
  const offenders: number[] = [];
  const check = (a: number, b: number, c: number) => {
    if (twiceArea(a, b, c) >= MIN_SNAPPED_AREA_RATIO) return;
    for (const q of [a, b, c]) {
      if (flagged[q] === 0 && isMoved(q)) {
        flagged[q] = 1;
        offenders.push(q);
      }
    }
  };
  for (let round = 0; ; round++) {
    for (const cell of touched) {
      const p = cell + Math.floor(cell / cols); // y · w + x
      // Same splits as buildFlatMesh.
      if (flip[cell] === 1) {
        check(p, p + w, p + w + 1);
        check(p, p + w + 1, p + 1);
      } else {
        check(p, p + w, p + 1);
        check(p + w, p + w + 1, p + 1);
      }
    }
    if (offenders.length === 0) break;
    const scale = round < MAX_SHIFT_HALVINGS ? 0.5 : 0;
    for (const q of offenders) {
      shift[q * 2] *= scale;
      shift[q * 2 + 1] *= scale;
      flagged[q] = 0;
    }
    offenders.length = 0;
  }
  return { shift, flip };
}

/**
 * Closed height-field solid: relief on top (+Z), flat back on z = zOffsetMm, and side walls wherever a solid
 * cell meets an empty cell or the grid border. Triangles are CCW seen from outside. With `inside`, outline
 * vertices (top and bottom twins together, in-plane only) are snapped onto the shape's contour first.
 * Throws when there are no solid cells.
 */
export function buildFlatMesh(o: FlatMeshOptions): MeshBuildResult {
  const { heights, widthMm, heightMm } = o;
  assertField(heights, "height map");
  if (!(widthMm > 0) || !(heightMm > 0) || !Number.isFinite(widthMm) || !Number.isFinite(heightMm)) {
    throw new Error("Width and height must both be greater than 0 mm.");
  }
  const baseMm = Number.isFinite(o.baseMm) ? Math.max(0, o.baseMm) : 0;
  const minHeight = Math.max(1e-3, o.minHeightMm ?? DEFAULT_MIN_HEIGHT_MM);
  const zOffset = o.zOffsetMm ?? 0;
  const w = heights.width;
  const h = heights.height;
  const cols = w - 1;
  const rows = h - 1;
  if (o.cells.length !== cols * rows) {
    throw new Error(`The cell mask must have ${cols} × ${rows} entries.`);
  }

  const cells = o.cells.slice();
  resolveDiagonalContacts(cells, cols, rows);

  // Pass 1: which grid points are used, and how many walls there are.
  const pointIndex = new Int32Array(w * h).fill(-1);
  let activeCells = 0;
  let walls = 0;
  for (let y = 0; y < rows; y++) {
    const row = y * cols;
    for (let x = 0; x < cols; x++) {
      if (cells[row + x] !== 1) continue;
      activeCells++;
      if (x === 0 || cells[row + x - 1] !== 1) walls++;
      if (x === cols - 1 || cells[row + x + 1] !== 1) walls++;
      if (y === 0 || cells[row - cols + x] !== 1) walls++;
      if (y === rows - 1 || cells[row + cols + x] !== 1) walls++;
      const p = y * w + x;
      pointIndex[p] = 0;
      pointIndex[p + 1] = 0;
      pointIndex[p + w] = 0;
      pointIndex[p + w + 1] = 0;
    }
  }
  if (activeCells === 0) throw new Error(NO_PRINTABLE_AREA_MESSAGE);

  let topCount = 0;
  for (let p = 0; p < pointIndex.length; p++) {
    if (pointIndex[p] === 0) pointIndex[p] = topCount++;
  }
  const vertexCount = topCount * 2;
  const positions = new Float32Array(vertexCount * 3);
  const uvs = o.withUvs ? new Float32Array(vertexCount * 2) : undefined;
  const thickness = o.withThickness ? new Float32Array(vertexCount) : undefined;

  // Pass 2: vertices. Top vertex k, bottom twin k + topCount; outline points take their snapped position.
  const snap = o.inside ? snapOutline(cells, cols, rows, o.inside) : null;
  const shift = snap?.shift;
  const flip = snap?.flip;
  const hv = heights.values;
  const bottomBase = topCount * 3;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const p = y * w + x;
      const k = pointIndex[p];
      if (k < 0) continue;
      const gx = shift ? x + shift[p * 2] : x;
      const gy = shift ? y + shift[p * 2 + 1] : y;
      const px = (gx / cols - 0.5) * widthMm;
      const py = (0.5 - gy / rows) * heightMm;
      const raw = hv[p];
      const relief = raw > minHeight ? raw : minHeight;
      const wall = baseMm + relief;
      const t = k * 3;
      positions[t] = px;
      positions[t + 1] = py;
      positions[t + 2] = zOffset + wall;
      const b = bottomBase + t;
      positions[b] = px;
      positions[b + 1] = py;
      positions[b + 2] = o.bottoms ? o.bottoms[p] : zOffset;
      if (uvs) {
        const tu = gx / cols;
        const tv = 1 - gy / rows;
        uvs[k * 2] = tu;
        uvs[k * 2 + 1] = tv;
        uvs[(k + topCount) * 2] = tu;
        uvs[(k + topCount) * 2 + 1] = tv;
      }
      if (thickness) {
        thickness[k] = wall;
        thickness[k + topCount] = wall;
      }
    }
  }

  // Pass 3: triangles. Top and bottom: 2 each per cell; walls: 2 per boundary side.
  const indices = new Uint32Array((activeCells * 4 + walls * 2) * 3);
  let n = 0;
  const B = topCount;
  for (let y = 0; y < rows; y++) {
    const row = y * cols;
    for (let x = 0; x < cols; x++) {
      if (cells[row + x] !== 1) continue;
      const p = y * w + x;
      const t00 = pointIndex[p];
      const t10 = pointIndex[p + 1];
      const t01 = pointIndex[p + w];
      const t11 = pointIndex[p + w + 1];
      const b00 = t00 + B;
      const b10 = t10 + B;
      const b01 = t01 + B;
      const b11 = t11 + B;
      if (flip && flip[row + x] === 1) {
        // Snapped outline cell split along 00–11 (see snapOutline). Top (+Z), then back (-Z).
        indices[n++] = t00; indices[n++] = t01; indices[n++] = t11;
        indices[n++] = t00; indices[n++] = t11; indices[n++] = t10;
        indices[n++] = b00; indices[n++] = b11; indices[n++] = b01;
        indices[n++] = b00; indices[n++] = b10; indices[n++] = b11;
      } else {
        // Top (+Z).
        indices[n++] = t00; indices[n++] = t01; indices[n++] = t10;
        indices[n++] = t01; indices[n++] = t11; indices[n++] = t10;
        // Back (-Z).
        indices[n++] = b00; indices[n++] = b10; indices[n++] = b01;
        indices[n++] = b01; indices[n++] = b10; indices[n++] = b11;
      }
      // Left wall (-X).
      if (x === 0 || cells[row + x - 1] !== 1) {
        indices[n++] = t00; indices[n++] = b00; indices[n++] = t01;
        indices[n++] = t01; indices[n++] = b00; indices[n++] = b01;
      }
      // Right wall (+X).
      if (x === cols - 1 || cells[row + x + 1] !== 1) {
        indices[n++] = t10; indices[n++] = t11; indices[n++] = b10;
        indices[n++] = b10; indices[n++] = t11; indices[n++] = b11;
      }
      // Upper wall (+Y).
      if (y === 0 || cells[row - cols + x] !== 1) {
        indices[n++] = t00; indices[n++] = t10; indices[n++] = b00;
        indices[n++] = b00; indices[n++] = t10; indices[n++] = b10;
      }
      // Lower wall (-Y).
      if (y === rows - 1 || cells[row + cols + x] !== 1) {
        indices[n++] = t01; indices[n++] = b01; indices[n++] = t11;
        indices[n++] = t11; indices[n++] = b01; indices[n++] = b11;
      }
    }
  }

  const result: MeshBuildResult = { positions, indices, activeCells };
  if (uvs) result.uvs = uvs;
  if (thickness) result.thickness = thickness;
  return result;
}
