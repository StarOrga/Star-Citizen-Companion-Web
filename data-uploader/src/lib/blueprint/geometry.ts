/**
 * Blueprint drawings: the pure geometry half (docs/blueprint.md).
 *
 * A ship hull (welded triangles, glTF Y-up metres) becomes two orthographic
 * line drawings: `top` (looking down, nose to the right) and `side` (from
 * starboard, nose to the right). Each view is
 *
 *   1. a depth raster (z-buffer) of every triangle, nearest surface wins,
 *   2. the outer silhouette, traced from the raster's coverage mask
 *      (marching squares, Douglas-Peucker), holes included,
 *   3. feature lines: mesh edges that are a crease (dihedral angle), an open
 *      panel border or a view contour (one face toward the viewer, one away),
 *      kept only where the depth raster says nothing lies in front of them.
 *
 * No I/O and no randomness: the same mesh always yields the same drawing.
 * Raster coordinates are pixels at `pxPerM`; the SVG writer maps them 1:1
 * into its viewBox, so every number here is already a drawing unit.
 */

/** Welded triangle mesh in glTF space: +X starboard, +Y up, -Z nose, metres. */
export interface TriMesh {
  positions: Float32Array;
  indices: Uint32Array;
}

export type ViewName = 'top' | 'side';

/**
 * Model point -> view coordinates. `u` runs to the right (nose), `v` runs down
 * the drawing, `d` grows toward the viewer.
 *   top:  u = -z, v = x  (starboard down), d = y (viewer above)
 *   side: u = -z, v = -y (up is up),       d = x (viewer at starboard)
 */
export function viewCoords(view: ViewName, x: number, y: number, z: number): [number, number, number] {
  return view === 'top' ? [-z, x, y] : [-z, -y, x];
}

/** Unit vector toward the viewer, in model space. */
function viewerDir(view: ViewName): [number, number, number] {
  return view === 'top' ? [0, 1, 0] : [1, 0, 0];
}

export interface Extent {
  min: [number, number, number];
  max: [number, number, number];
}

export function meshExtent(mesh: TriMesh): Extent | null {
  const p = mesh.positions;
  if (p.length < 3) return null;
  const min: [number, number, number] = [Infinity, Infinity, Infinity];
  const max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < p.length; i += 3) {
    for (let a = 0; a < 3; a++) {
      const v = p[i + a]!;
      if (v < min[a]!) min[a] = v;
      if (v > max[a]!) max[a] = v;
    }
  }
  return min.every(Number.isFinite) && max.every(Number.isFinite) ? { min, max } : null;
}

/** The u/v window a view covers, in metres. */
export interface ViewWindow {
  view: ViewName;
  uMin: number;
  vMin: number;
  uSpan: number;
  vSpan: number;
}

export function viewWindow(view: ViewName, e: Extent): ViewWindow {
  // u = -z for both views; v = x (top) or -y (side).
  const uMin = -e.max[2];
  const uSpan = e.max[2] - e.min[2];
  if (view === 'top') return { view, uMin, vMin: e.min[0], uSpan, vSpan: e.max[0] - e.min[0] };
  return { view, uMin, vMin: -e.max[1], uSpan, vSpan: e.max[1] - e.min[1] };
}

export interface DepthRaster {
  w: number;
  h: number;
  /** Pixels per metre. */
  k: number;
  /** Pixel border kept empty on every side (contours need a closed frame). */
  pad: number;
  win: ViewWindow;
  /** Nearest depth per pixel, -Infinity where nothing was drawn. */
  depth: Float32Array;
}

/** Model point -> raster pixel (x, y) and depth. */
export function toPixel(r: DepthRaster, x: number, y: number, z: number): [number, number, number] {
  const [u, v, d] = viewCoords(r.win.view, x, y, z);
  return [(u - r.win.uMin) * r.k + r.pad, (v - r.win.vMin) * r.k + r.pad, d];
}

export function rasterize(mesh: TriMesh, win: ViewWindow, k: number, pad = 3): DepthRaster {
  const w = Math.max(1, Math.ceil(win.uSpan * k)) + 2 * pad + 1;
  const h = Math.max(1, Math.ceil(win.vSpan * k)) + 2 * pad + 1;
  const depth = new Float32Array(w * h).fill(-Infinity);
  const r: DepthRaster = { w, h, k, pad, win, depth };
  const p = mesh.positions;
  const idx = mesh.indices;
  const sx = new Float64Array(3);
  const sy = new Float64Array(3);
  const sd = new Float64Array(3);
  for (let t = 0; t + 2 < idx.length; t += 3) {
    for (let c = 0; c < 3; c++) {
      const i = idx[t + c]! * 3;
      const [x, y, d] = toPixel(r, p[i]!, p[i + 1]!, p[i + 2]!);
      sx[c] = x;
      sy[c] = y;
      sd[c] = d;
      // Stamp every vertex: a triangle seen edge-on (a wing from the side)
      // covers no pixel centre, but its vertices still mark where it is.
      const px = Math.floor(x);
      const py = Math.floor(y);
      if (px >= 0 && py >= 0 && px < w && py < h) {
        const o = py * w + px;
        if (d > depth[o]!) depth[o] = d;
      }
    }
    fillTriangle(r, sx, sy, sd);
  }
  return r;
}

function fillTriangle(r: DepthRaster, sx: Float64Array, sy: Float64Array, sd: Float64Array): void {
  const [x0, x1, x2] = [sx[0]!, sx[1]!, sx[2]!];
  const [y0, y1, y2] = [sy[0]!, sy[1]!, sy[2]!];
  const area = (x1 - x0) * (y2 - y0) - (x2 - x0) * (y1 - y0);
  if (Math.abs(area) < 1e-9) return;
  const minX = Math.max(0, Math.floor(Math.min(x0, x1, x2)));
  const maxX = Math.min(r.w - 1, Math.ceil(Math.max(x0, x1, x2)));
  const minY = Math.max(0, Math.floor(Math.min(y0, y1, y2)));
  const maxY = Math.min(r.h - 1, Math.ceil(Math.max(y0, y1, y2)));
  const inv = 1 / area;
  const eps = -1e-7;
  for (let py = minY; py <= maxY; py++) {
    const cy = py + 0.5;
    for (let px = minX; px <= maxX; px++) {
      const cx = px + 0.5;
      const w0 = ((x1 - cx) * (y2 - cy) - (x2 - cx) * (y1 - cy)) * inv;
      const w1 = ((x2 - cx) * (y0 - cy) - (x0 - cx) * (y2 - cy)) * inv;
      const w2 = 1 - w0 - w1;
      if (w0 < eps || w1 < eps || w2 < eps) continue;
      const d = w0 * sd[0]! + w1 * sd[1]! + w2 * sd[2]!;
      const o = py * r.w + px;
      if (d > r.depth[o]!) r.depth[o] = d;
    }
  }
}

/** Coverage mask of a raster, morphologically closed by `radius` px (fills hairline cracks). */
export function coverageMask(r: DepthRaster, radius = 1): Uint8Array {
  let m = new Uint8Array(r.w * r.h);
  for (let i = 0; i < m.length; i++) m[i] = r.depth[i]! > -Infinity ? 1 : 0;
  for (let i = 0; i < radius; i++) m = morph(m, r.w, r.h, true);
  for (let i = 0; i < radius; i++) m = morph(m, r.w, r.h, false);
  return m;
}

/** One 3x3 dilate (grow) or erode step. The outermost ring always stays empty. */
function morph(src: Uint8Array, w: number, h: number, grow: boolean): Uint8Array {
  const out = new Uint8Array(w * h);
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      let hit = grow ? 0 : 1;
      for (let dy = -1; dy <= 1 && hit === (grow ? 0 : 1); dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const v = src[(y + dy) * w + x + dx]!;
          if (grow && v) { hit = 1; break; }
          if (!grow && !v) { hit = 0; break; }
        }
      }
      out[y * w + x] = hit;
    }
  }
  return out;
}

/** A flat [x0, y0, x1, y1, …] point list. */
export type Pts = number[];

/**
 * Closed outlines of a binary mask (marching squares over pixel centres).
 * The mask's outer ring must be empty, so every loop closes. Saddles are
 * split the same way every time (corners cut), which keeps every crossing
 * point at degree two.
 */
export function traceContours(mask: Uint8Array, w: number, h: number): Pts[] {
  const adj = new Map<number, number[]>();
  const link = (a: number, b: number): void => {
    const la = adj.get(a);
    if (la) la.push(b); else adj.set(a, [b]);
    const lb = adj.get(b);
    if (lb) lb.push(a); else adj.set(b, [a]);
  };
  const H = (x: number, y: number): number => (y * w + x) * 2;
  const V = (x: number, y: number): number => (y * w + x) * 2 + 1;
  for (let y = 0; y < h - 1; y++) {
    for (let x = 0; x < w - 1; x++) {
      const a = mask[y * w + x]!;
      const b = mask[y * w + x + 1]!;
      const c = mask[(y + 1) * w + x + 1]!;
      const d = mask[(y + 1) * w + x]!;
      const code = (a << 3) | (b << 2) | (c << 1) | d;
      if (code === 0 || code === 15) continue;
      const top = H(x, y);
      const bottom = H(x, y + 1);
      const left = V(x, y);
      const right = V(x + 1, y);
      switch (code) {
        case 1: case 14: link(left, bottom); break;
        case 2: case 13: link(bottom, right); break;
        case 3: case 12: link(left, right); break;
        case 4: case 11: link(top, right); break;
        case 6: case 9: link(top, bottom); break;
        case 7: case 8: link(top, left); break;
        case 5: link(top, right); link(left, bottom); break;
        case 10: link(top, left); link(bottom, right); break;
      }
    }
  }
  const point = (id: number): [number, number] => {
    const cell = id >> 1;
    const x = cell % w;
    const y = (cell - x) / w;
    return id & 1 ? [x + 0.5, y + 1] : [x + 1, y + 0.5];
  };
  const seen = new Set<number>();
  const loops: Pts[] = [];
  // Sorted start ids keep the output order independent of Map insertion quirks.
  for (const start of [...adj.keys()].sort((p, q) => p - q)) {
    if (seen.has(start)) continue;
    const loop: Pts = [];
    let prev = -1;
    let cur = start;
    while (!seen.has(cur)) {
      seen.add(cur);
      const [px, py] = point(cur);
      loop.push(px, py);
      const next = (adj.get(cur) ?? []).find((n) => n !== prev && !seen.has(n));
      if (next === undefined) break;
      prev = cur;
      cur = next;
    }
    if (loop.length >= 6) loops.push(loop);
  }
  return loops;
}

/** Shoelace area of a closed loop (absolute, px²). */
export function loopArea(pts: Pts): number {
  let s = 0;
  const n = pts.length / 2;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    s += pts[2 * i]! * pts[2 * j + 1]! - pts[2 * j]! * pts[2 * i + 1]!;
  }
  return Math.abs(s) / 2;
}

/** Douglas-Peucker on an open polyline (iterative, no recursion depth limit). */
export function simplify(pts: Pts, tol: number): Pts {
  const n = pts.length / 2;
  if (n <= 2) return pts.slice();
  const keep = new Uint8Array(n);
  keep[0] = 1;
  keep[n - 1] = 1;
  const stack: [number, number][] = [[0, n - 1]];
  const tol2 = tol * tol;
  while (stack.length) {
    const [a, b] = stack.pop()!;
    const ax = pts[2 * a]!;
    const ay = pts[2 * a + 1]!;
    const dx = pts[2 * b]! - ax;
    const dy = pts[2 * b + 1]! - ay;
    const len2 = dx * dx + dy * dy;
    let best = -1;
    let bestD = tol2;
    for (let i = a + 1; i < b; i++) {
      const px = pts[2 * i]! - ax;
      const py = pts[2 * i + 1]! - ay;
      let d2: number;
      if (len2 === 0) {
        d2 = px * px + py * py;
      } else {
        const cross = px * dy - py * dx;
        d2 = (cross * cross) / len2;
      }
      if (d2 > bestD) {
        bestD = d2;
        best = i;
      }
    }
    if (best > 0) {
      keep[best] = 1;
      stack.push([a, best], [best, b]);
    }
  }
  const out: Pts = [];
  for (let i = 0; i < n; i++) if (keep[i]) out.push(pts[2 * i]!, pts[2 * i + 1]!);
  return out;
}

/** Simplify a closed loop: split at the point farthest from the start so both halves keep their shape. */
export function simplifyLoop(pts: Pts, tol: number): Pts {
  const n = pts.length / 2;
  if (n < 4) return pts.slice();
  let far = 0;
  let farD = -1;
  for (let i = 1; i < n; i++) {
    const d = (pts[2 * i]! - pts[0]!) ** 2 + (pts[2 * i + 1]! - pts[1]!) ** 2;
    if (d > farD) {
      farD = d;
      far = i;
    }
  }
  const first = simplify(pts.slice(0, 2 * far + 2), tol);
  const second = simplify([...pts.slice(2 * far), pts[0]!, pts[1]!], tol);
  // Drop the duplicated joint and the closing point.
  return [...first, ...second.slice(2, -2)];
}

export function polylineLength(pts: Pts): number {
  let s = 0;
  for (let i = 2; i < pts.length; i += 2) s += Math.hypot(pts[i]! - pts[i - 2]!, pts[i + 1]! - pts[i - 1]!);
  return s;
}

export type LineKind = 'major' | 'minor';

export interface FeatureLine {
  kind: LineKind;
  pts: Pts;
  length: number;
}

export interface FeatureOptions {
  /** Dihedral angle (deg) above which a shared edge is a crease. */
  minorAngle: number;
  /** Dihedral angle (deg) above which a crease counts as a main line. */
  majorAngle: number;
  /** Include open panel borders (edges used by one triangle only). */
  borders: boolean;
}

export const DEFAULT_FEATURES: FeatureOptions = { minorAngle: 28, majorAngle: 62, borders: true };

/**
 * Visible feature edges of one view as raster-space segments, already chained
 * into polylines. `outline` is the closed coverage mask: a line within one
 * pixel of the silhouette is the silhouette itself and is left to the outline.
 */
export function featureLines(
  mesh: TriMesh,
  r: DepthRaster,
  outline: Uint8Array,
  opts: FeatureOptions = DEFAULT_FEATURES,
): FeatureLine[] {
  const p = mesh.positions;
  const idx = mesh.indices;
  const nTri = Math.floor(idx.length / 3);
  const normals = new Float32Array(nTri * 3);
  for (let t = 0; t < nTri; t++) {
    const a = idx[3 * t]! * 3;
    const b = idx[3 * t + 1]! * 3;
    const c = idx[3 * t + 2]! * 3;
    const ux = p[b]! - p[a]!, uy = p[b + 1]! - p[a + 1]!, uz = p[b + 2]! - p[a + 2]!;
    const vx = p[c]! - p[a]!, vy = p[c + 1]! - p[a + 1]!, vz = p[c + 2]! - p[a + 2]!;
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const len = Math.hypot(nx, ny, nz);
    if (len > 0) {
      normals[3 * t] = nx / len;
      normals[3 * t + 1] = ny / len;
      normals[3 * t + 2] = nz / len;
    }
  }
  // Edge table: key = lo * nVert + hi (exact in a double for < 9e7 vertices).
  const nVert = p.length / 3;
  const slot = new Map<number, number>();
  const ea: number[] = [];
  const eb: number[] = [];
  const f1: number[] = [];
  const f2: number[] = [];
  const cnt: number[] = [];
  for (let t = 0; t < nTri; t++) {
    if (normals[3 * t] === 0 && normals[3 * t + 1] === 0 && normals[3 * t + 2] === 0) continue;
    for (let e = 0; e < 3; e++) {
      const i = idx[3 * t + e]!;
      const j = idx[3 * t + ((e + 1) % 3)]!;
      if (i === j) continue;
      const lo = Math.min(i, j);
      const hi = Math.max(i, j);
      const key = lo * nVert + hi;
      const s = slot.get(key);
      if (s === undefined) {
        slot.set(key, ea.length);
        ea.push(lo);
        eb.push(hi);
        f1.push(t);
        f2.push(-1);
        cnt.push(1);
      } else {
        if (cnt[s] === 1) f2[s] = t;
        cnt[s]!++;
      }
    }
  }
  const view = viewerDir(r.win.view);
  const cosMinor = Math.cos((opts.minorAngle * Math.PI) / 180);
  const cosMajor = Math.cos((opts.majorAngle * Math.PI) / 180);
  const eps = Math.max(0.04, 2.5 / r.k);
  // Candidates first, then drawn nearest-first: where two edges project onto
  // the same pixels (the top and bottom rim of a vertical wall), only the
  // nearer one is kept.
  const cand: { s: number; major: boolean; depth: number }[] = [];
  const dir = r.win.view === 'top' ? 1 : 0;
  for (let s = 0; s < ea.length; s++) {
    let kind: LineKind | null = null;
    const n = cnt[s]!;
    if (n === 1) {
      kind = opts.borders ? 'minor' : null;
    } else if (n === 2) {
      const a = f1[s]! * 3;
      const b = f2[s]! * 3;
      const dot = normals[a]! * normals[b]! + normals[a + 1]! * normals[b + 1]! + normals[a + 2]! * normals[b + 2]!;
      const fa = normals[a]! * view[0] + normals[a + 1]! * view[1] + normals[a + 2]! * view[2];
      const fb = normals[b]! * view[0] + normals[b + 1]! * view[1] + normals[b + 2]! * view[2];
      if (fa * fb < 0 && Math.abs(fa - fb) > 0.05) kind = 'major';
      else if (dot < cosMajor) kind = 'major';
      else if (dot < cosMinor) kind = 'minor';
    } else {
      kind = 'minor';
    }
    if (!kind) continue;
    cand.push({ s, major: kind === 'major', depth: Math.max(p[3 * ea[s]! + dir]!, p[3 * eb[s]! + dir]!) });
  }
  cand.sort((a, b) => Number(b.major) - Number(a.major) || b.depth - a.depth || a.s - b.s);
  const taken = new Uint8Array(r.w * r.h);
  const segs: { kind: LineKind; s: number[] }[] = [];
  for (const c of cand) {
    const kind: LineKind = c.major ? 'major' : 'minor';
    visibleRuns(r, outline, taken, p, ea[c.s]!, eb[c.s]!, eps, (run) => segs.push({ kind, s: run }));
  }
  return [...chain(segs.filter((x) => x.kind === 'major').map((x) => x.s), 'major'),
    ...chain(segs.filter((x) => x.kind === 'minor').map((x) => x.s), 'minor')];
}

/** Split one model edge into the stretches no nearer surface hides. */
function visibleRuns(
  r: DepthRaster,
  outline: Uint8Array,
  taken: Uint8Array,
  p: Float32Array,
  i: number,
  j: number,
  eps: number,
  emit: (seg: number[]) => void,
): void {
  const [x0, y0, d0] = toPixel(r, p[3 * i]!, p[3 * i + 1]!, p[3 * i + 2]!);
  const [x1, y1, d1] = toPixel(r, p[3 * j]!, p[3 * j + 1]!, p[3 * j + 2]!);
  const len = Math.hypot(x1 - x0, y1 - y0);
  if (len < 0.75) return;
  const steps = Math.max(2, Math.ceil(len));
  let runStart = -1;
  const flush = (end: number): void => {
    if (runStart >= 0 && end - runStart >= 2) {
      const t0 = runStart / steps;
      const t1 = end / steps;
      emit([x0 + (x1 - x0) * t0, y0 + (y1 - y0) * t0, x0 + (x1 - x0) * t1, y0 + (y1 - y0) * t1]);
    }
    runStart = -1;
  };
  let last = -1;
  for (let k = 0; k <= steps; k++) {
    const t = k / steps;
    const x = x0 + (x1 - x0) * t;
    const y = y0 + (y1 - y0) * t;
    const o = Math.floor(y) * r.w + Math.floor(x);
    // A pixel a nearer line already drew is not drawn twice — except right at
    // this edge's own ends, where the next edge of the same line joins on.
    const free = k <= 1 || k >= steps - 1 || !taken[o] || o === last;
    const ok = free && sampleVisible(r, outline, x, y, d0 + (d1 - d0) * t, eps);
    if (ok) {
      taken[o] = 1;
      last = o;
      if (runStart < 0) runStart = k;
    } else {
      flush(k - 1);
    }
  }
  flush(steps);
}

function sampleVisible(r: DepthRaster, outline: Uint8Array, x: number, y: number, d: number, eps: number): boolean {
  const px = Math.floor(x);
  const py = Math.floor(y);
  if (px < 1 || py < 1 || px >= r.w - 1 || py >= r.h - 1) return false;
  let nearest = Infinity;
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      const o = (py + dy) * r.w + px + dx;
      // Next to the silhouette: the outline already draws this line.
      if (!outline[o]) return false;
      const z = r.depth[o]!;
      if (z < nearest) nearest = z;
    }
  }
  return d >= nearest - eps;
}

/** Join segments that share endpoints (0.5 px grid) into polylines, then simplify. */
export function chain(segs: number[][], kind: LineKind, tol = 0.6): FeatureLine[] {
  const key = (x: number, y: number): string => `${Math.round(x * 2)},${Math.round(y * 2)}`;
  const at = new Map<string, number[]>();
  segs.forEach((s, i) => {
    for (const k of [key(s[0]!, s[1]!), key(s[2]!, s[3]!)]) {
      const l = at.get(k);
      if (l) l.push(i); else at.set(k, [i]);
    }
  });
  const used = new Uint8Array(segs.length);
  const out: FeatureLine[] = [];
  const extend = (pts: number[], fromEnd: boolean): void => {
    for (;;) {
      const x = fromEnd ? pts[pts.length - 2]! : pts[0]!;
      const y = fromEnd ? pts[pts.length - 1]! : pts[1]!;
      const list = at.get(key(x, y)) ?? [];
      // Only continue through a clean joint (exactly two segments meet).
      if (list.length !== 2) return;
      const next = list.find((n) => !used[n]);
      if (next === undefined) return;
      used[next] = 1;
      const s = segs[next]!;
      const startsHere = key(s[0]!, s[1]!) === key(x, y);
      const [nx, ny] = startsHere ? [s[2]!, s[3]!] : [s[0]!, s[1]!];
      if (fromEnd) pts.push(nx, ny); else pts.unshift(nx, ny);
    }
  };
  for (let i = 0; i < segs.length; i++) {
    if (used[i]) continue;
    used[i] = 1;
    const pts = [...segs[i]!];
    extend(pts, true);
    extend(pts, false);
    const simple = simplify(pts, tol);
    const length = polylineLength(simple);
    if (length >= 1.5) out.push({ kind, pts: simple, length });
  }
  return out;
}
