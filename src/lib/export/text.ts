/**
 * Builds a large text file as UTF-8 bytes without ever holding it as one giant string
 * (a multi-million-triangle ASCII STL would exceed engine string limits).
 */
export class TextFileWriter {
  private readonly encoder = new TextEncoder();
  private readonly chunks: Uint8Array[] = [];
  private pending: string[] = [];
  private pendingLength = 0;
  private total = 0;

  constructor(private readonly flushAt = 1 << 16) {}

  write(text: string): void {
    this.pending.push(text);
    this.pendingLength += text.length;
    if (this.pendingLength >= this.flushAt) this.flush();
  }

  private flush(): void {
    if (this.pending.length === 0) return;
    const bytes = this.encoder.encode(this.pending.join(""));
    this.chunks.push(bytes);
    this.total += bytes.length;
    this.pending = [];
    this.pendingLength = 0;
  }

  /** Concatenate everything written so far into one ArrayBuffer. */
  finish(): ArrayBuffer {
    this.flush();
    const out = new Uint8Array(this.total);
    let offset = 0;
    for (const chunk of this.chunks) {
      out.set(chunk, offset);
      offset += chunk.length;
    }
    return out.buffer;
  }
}

/** Format with 6 significant digits and no trailing zeros ("12.5", "-0.00125", "1.00000e-7" → "1e-7"). */
export function formatNumber(value: number): string {
  if (!Number.isFinite(value) || value === 0) return "0";
  const s = value.toPrecision(6);
  const e = s.indexOf("e");
  if (e !== -1) {
    // toPrecision uses exponent notation for very small/large magnitudes: trim the mantissa only.
    return trimZeros(s.slice(0, e)) + s.slice(e);
  }
  return trimZeros(s);
}

function trimZeros(s: string): string {
  if (s.indexOf(".") === -1) return s;
  let end = s.length;
  while (s.charCodeAt(end - 1) === 48) end--;
  if (s.charCodeAt(end - 1) === 46) end--;
  return s.slice(0, end);
}

/** Unit normal of triangle (a, b, c) from xyz triples; [0, 0, 0] for degenerate faces. */
export function faceNormal(positions: Float32Array, a: number, b: number, c: number, out: Float64Array): Float64Array {
  const ax = positions[a * 3], ay = positions[a * 3 + 1], az = positions[a * 3 + 2];
  const ux = positions[b * 3] - ax, uy = positions[b * 3 + 1] - ay, uz = positions[b * 3 + 2] - az;
  const vx = positions[c * 3] - ax, vy = positions[c * 3 + 1] - ay, vz = positions[c * 3 + 2] - az;
  const x = uy * vz - uz * vy;
  const y = uz * vx - ux * vz;
  const z = ux * vy - uy * vx;
  const len = Math.sqrt(x * x + y * y + z * z);
  if (len > 0 && Number.isFinite(len)) {
    out[0] = x / len;
    out[1] = y / len;
    out[2] = z / len;
  } else {
    out[0] = 0;
    out[1] = 0;
    out[2] = 0;
  }
  return out;
}
