/**
 * Crease edges of a triangle mesh on plain arrays — no three.js, so the same code runs in the
 * holo edge worker (`holo-edges.worker.ts`) and, as the fallback, on the main thread.
 *
 * An edge is kept when the two triangles that share it meet at more than `creaseDeg`
 * (and the larger of them is at least `minArea`), or when only one triangle has it (an
 * open boundary). Positions are matched by a rounded hash, so split vertices still pair up.
 */
export interface HoloEdgeJob {
  /** xyz per vertex. */
  positions: Float32Array;
  /** Triangle corners; `null` = non-indexed (every three vertices one triangle). */
  index: Uint32Array | Uint16Array | null;
  creaseDeg: number;
  minArea: number;
}

const PRECISION = 1e4;

interface OpenEdge {
  nx: number;
  ny: number;
  nz: number;
  area: number;
  a: number;
  b: number;
}

/** Line segment endpoints (xyz xyz per edge). */
export function creaseEdgeArray(job: HoloEdgeJob): Float32Array {
  const { positions: p, index } = job;
  const thresholdDot = Math.cos((Math.PI / 180) * job.creaseDeg);
  const minArea = job.minArea;
  const count = index ? index.length : Math.floor(p.length / 3);
  const hashOf = (v: number) =>
    `${Math.round(p[v * 3] * PRECISION)},${Math.round(p[v * 3 + 1] * PRECISION)},${Math.round(p[v * 3 + 2] * PRECISION)}`;
  const open = new Map<string, OpenEdge | null>();
  const out: number[] = [];
  const push = (a: number, b: number) =>
    out.push(p[a * 3], p[a * 3 + 1], p[a * 3 + 2], p[b * 3], p[b * 3 + 1], p[b * 3 + 2]);
  const ids = [0, 0, 0];
  const hashes = ['', '', ''];
  for (let i = 0; i + 2 < count; i += 3) {
    for (let k = 0; k < 3; k++) {
      ids[k] = index ? index[i + k] : i + k;
      hashes[k] = hashOf(ids[k]);
    }
    if (hashes[0] === hashes[1] || hashes[1] === hashes[2] || hashes[2] === hashes[0]) continue;
    // Same as THREE.Triangle: normal = (c − b) × (a − b), normalised; area = half its length.
    const a = ids[0] * 3, b = ids[1] * 3, c = ids[2] * 3;
    const ux = p[c] - p[b], uy = p[c + 1] - p[b + 1], uz = p[c + 2] - p[b + 2];
    const vx = p[a] - p[b], vy = p[a + 1] - p[b + 1], vz = p[a + 2] - p[b + 2];
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const len = Math.sqrt(nx * nx + ny * ny + nz * nz);
    const area = len / 2;
    if (len > 0) {
      nx /= len;
      ny /= len;
      nz /= len;
    } else {
      nx = ny = nz = 0;
    }
    for (let k = 0; k < 3; k++) {
      const n = (k + 1) % 3;
      const hash = `${hashes[k]}_${hashes[n]}`;
      const reverse = `${hashes[n]}_${hashes[k]}`;
      const other = open.get(reverse);
      if (other) {
        const dot = nx * other.nx + ny * other.ny + nz * other.nz;
        if (dot <= thresholdDot && Math.max(area, other.area) >= minArea) push(ids[k], ids[n]);
        open.set(reverse, null);
      } else if (!open.has(hash)) {
        open.set(hash, { nx, ny, nz, area, a: ids[k], b: ids[n] });
      }
    }
  }
  // Open (boundary) edges always count as creases.
  for (const e of open.values()) if (e && e.area >= minArea) push(e.a, e.b);
  return new Float32Array(out);
}
