/**
 * The hub planet's world (concept 2026-10-29 "Verse-Planet Nachtseite"):
 * a made-up planet — no Earth geography — generated once from a fixed seed.
 * Pure data and maths only; the canvases and the WebGL upload live in
 * planet-textures.ts / planet-gl.ts.
 *
 * Coordinates: planet-frame unit vectors p = (cos lat · cos lon, sin lat,
 * cos lat · sin lon). The view tilts the spin axis away from the viewer by
 * TILT, so the hub's rim (the top of the disc) sits near latitude 35° N and
 * the visible cap runs from there down over the equator.
 */

export type Vec3 = readonly [number, number, number];

/** One full turn of the planet. */
export const DAY_MS = 30 * 60 * 1000;
/** Spin axis leans away from the viewer by this angle (radians). */
export const TILT = 0.95;
/** Sun direction in view space: top right, slightly behind the planet. */
export const SUN: Vec3 = normalize([0.85, -0.22, -0.45]);
/** A starting turn that shows a populated region under the stage. */
export const START_ROT = 4.0;

/** Equirect grid of the surface fields (land height, clouds, population). */
export const FIELD_W = 1024;
export const FIELD_H = 512;
/** Height above which a cell is land. */
export const SEA = 0.535;

export interface City {
  readonly lat: number;
  readonly lon: number;
  /** 0..1, power-law: few big cities, many towns. */
  readonly size: number;
  readonly v: Vec3;
  readonly links: { readonly to: number; readonly edge: Edge }[];
}

export interface Edge {
  readonly a: number;
  readonly b: number;
  /** Angular length (radians). */
  readonly w: number;
}

export interface PlanetWorld {
  readonly height: Float32Array;
  readonly cloud: Float32Array;
  readonly people: Float32Array;
  readonly cities: City[];
  readonly edges: Edge[];
}

export function normalize(v: Vec3): Vec3 {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
}

/** Deterministic LCG in [0, 1). */
export function seeded(seed: number): () => number {
  let s = seed >>> 0;
  return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296);
}

export function gauss(rnd: () => number): number {
  let s = 0;
  for (let i = 0; i < 4; i++) s += rnd();
  return (s - 2) / 2;
}

export const sph = (lat: number, lon: number): Vec3 => [Math.cos(lat) * Math.cos(lon), Math.sin(lat), Math.cos(lat) * Math.sin(lon)];
export const toLatLon = (v: Vec3): [number, number] => [Math.asin(Math.max(-1, Math.min(1, v[1]))), Math.atan2(v[2], v[0])];

export function angle(a: Vec3, b: Vec3): number {
  return Math.acos(Math.max(-1, Math.min(1, a[0] * b[0] + a[1] * b[1] + a[2] * b[2])));
}

/** Great-circle interpolation. */
export function slerp(a: Vec3, b: Vec3, t: number): Vec3 {
  const w = angle(a, b);
  if (w < 1e-6) return a;
  const s = Math.sin(w), ka = Math.sin((1 - t) * w) / s, kb = Math.sin(t * w) / s;
  return [a[0] * ka + b[0] * kb, a[1] * ka + b[1] * kb, a[2] * ka + b[2] * kb];
}

export interface Projected {
  readonly x: number;
  readonly y: number;
  /** > 0 on the visible hemisphere. */
  readonly z: number;
  /** Sun incidence: < 0 is night. */
  readonly ndl: number;
}

/** Planet frame → screen (the shader's inverse, forward). */
export function project(v: Vec3, rot: number, cx: number, cy: number, r: number): Projected {
  const cr = Math.cos(rot), sr = Math.sin(rot);
  const qx = v[0] * cr + v[2] * sr, qz = -v[0] * sr + v[2] * cr;
  const ct = Math.cos(TILT), st = Math.sin(TILT);
  const ny = v[1] * ct + qz * st, nz = -v[1] * st + qz * ct;
  return { x: cx + r * qx, y: cy - r * ny, z: nz, ndl: qx * SUN[0] + ny * SUN[1] + nz * SUN[2] };
}

// ── 3D value noise on the sphere (seamless, no poles seam) ─────────────
function noiseFn(rnd: () => number): (x: number, y: number, z: number) => number {
  const perm = new Uint8Array(512);
  const p = Array.from({ length: 256 }, (_, i) => i);
  for (let i = 255; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [p[i], p[j]] = [p[j], p[i]];
  }
  for (let i = 0; i < 512; i++) perm[i] = p[i & 255];
  const val = new Float32Array(256).map(() => rnd());
  const fade = (t: number) => t * t * (3 - 2 * t);
  const h = (a: number, b: number, c: number) => val[perm[perm[perm[a & 255] + (b & 255)] + (c & 255)]];
  const l = (a: number, b: number, t: number) => a + (b - a) * t;
  return (x, y, z) => {
    const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
    const u = fade(x - xi), v = fade(y - yi), w = fade(z - zi);
    return l(
      l(l(h(xi, yi, zi), h(xi + 1, yi, zi), u), l(h(xi, yi + 1, zi), h(xi + 1, yi + 1, zi), u), v),
      l(l(h(xi, yi, zi + 1), h(xi + 1, yi, zi + 1), u), l(h(xi, yi + 1, zi + 1), h(xi + 1, yi + 1, zi + 1), u), v),
      w,
    );
  };
}

function fbm(n: (x: number, y: number, z: number) => number, x: number, y: number, z: number, oct: number): number {
  let a = 0.5, f = 1, s = 0, t = 0;
  for (let i = 0; i < oct; i++) {
    s += a * n(x * f, y * f, z * f);
    t += a;
    a *= 0.5;
    f *= 2.03;
  }
  return s / t;
}

export function fieldIndex(lat: number, lon: number): number {
  let i = Math.floor((lon / (2 * Math.PI) + 0.5) * FIELD_W);
  i = ((i % FIELD_W) + FIELD_W) % FIELD_W;
  const j = Math.min(FIELD_H - 1, Math.max(0, Math.floor((0.5 - lat / Math.PI) * FIELD_H)));
  return j * FIELD_W + i;
}

/**
 * Generates the world in slices so the main thread never stalls: every
 * `yieldEvery` rows the generator hands control back (the caller decides how
 * to wait — idle callback in the app, nothing in tests).
 */
export function* generateWorld(seed = 1337, yieldEvery = 16): Generator<void, PlanetWorld> {
  const rnd = seeded(seed);
  const noise = noiseFn(rnd);
  const height = new Float32Array(FIELD_W * FIELD_H);
  const cloud = new Float32Array(FIELD_W * FIELD_H);
  const people = new Float32Array(FIELD_W * FIELD_H);
  for (let j = 0; j < FIELD_H; j++) {
    const lat = (0.5 - (j + 0.5) / FIELD_H) * Math.PI;
    for (let i = 0; i < FIELD_W; i++) {
      const [x, y, z] = sph(lat, ((i + 0.5) / FIELD_W - 0.5) * 2 * Math.PI);
      const wx = fbm(noise, x * 1.3 + 7, y * 1.3, z * 1.3, 3) - 0.5;
      const k = j * FIELD_W + i;
      height[k] = fbm(noise, x * 1.7 + wx * 1.2, y * 1.7 + wx, z * 1.7 - wx, 6);
      cloud[k] = fbm(noise, x * 3.1 + 40, y * 6.5, z * 3.1, 5);
      people[k] = fbm(noise, x * 2.4 + 90, y * 2.4, z * 2.4, 3);
    }
    if (j % yieldEvery === yieldEvery - 1) yield;
  }
  const isLand = (lat: number, lon: number) => height[fieldIndex(lat, lon)] > SEA && Math.abs(lat) < 1.25;

  // Cities: clustered where the population field is high, coasts preferred,
  // and the cold north thins out (fewer people want to live up there).
  const cities: City[] = [];
  for (let tries = 0; cities.length < 1100 && tries < 200000; tries++) {
    const lat = Math.asin(rnd() * 2 - 1), lon = (rnd() * 2 - 1) * Math.PI;
    if (!isLand(lat, lon)) continue;
    const k = fieldIndex(lat, lon);
    const coast = 1 - Math.min(1, (height[k] - SEA) / 0.05);
    const cold = lat > 0.55 ? Math.max(0.05, 1 - (lat - 0.55) / 0.45) : 1;
    const p = Math.min(1, Math.pow(Math.max(0, people[k] - 0.36) * 3.2, 1.6)) * (0.3 + 0.7 * coast) * cold;
    if (rnd() > p) continue;
    const size = Math.min(1, 0.06 + Math.pow(rnd(), 4) * 0.95);
    cities.push({ lat, lon, size, v: sph(lat, lon), links: [] });
  }
  yield;

  // Rail network: every city to its 2–3 nearest neighbours, over land only.
  const edges: Edge[] = [];
  cities.forEach((c, a) => {
    const near = cities
      .map((d, b) => [b, angle(c.v, d.v)] as const)
      .filter(([b, w]) => b !== a && w < 0.11)
      .sort((x, y) => x[1] - y[1])
      .slice(0, c.size > 0.4 ? 3 : 2);
    for (const [b, w] of near) {
      if (c.links.some((l) => l.to === b)) continue;
      let overLand = true;
      for (let t = 0.15; t < 1 && overLand; t += 0.15) overLand = isLand(...toLatLon(slerp(c.v, cities[b].v, t)));
      if (!overLand) continue;
      const edge: Edge = { a, b, w };
      edges.push(edge);
      c.links.push({ to: b, edge });
      cities[b].links.push({ to: a, edge });
    }
  });
  return { height, cloud, people, cities, edges };
}

/** Runs the generator to the end in one go (tests, or when time does not matter). */
export function buildWorldSync(seed = 1337): PlanetWorld {
  const gen = generateWorld(seed);
  for (;;) {
    const r = gen.next();
    if (r.done) return r.value;
  }
}
