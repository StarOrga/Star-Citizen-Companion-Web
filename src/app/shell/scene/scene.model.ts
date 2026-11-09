/**
 * The app-wide background scene (beta `shell`, concept 2026-11-09 Kamera-Welt):
 * ONE world — the Verse planet with its four set pieces (News, Patches,
 * Galerie planets, the Sternkarte constellation), the admin station in orbit,
 * the HQ ground station on the right limb, the Codex holotable glow off to the
 * right — and one camera over it. Every page is a camera POSE on that world;
 * a navigation never swaps or fades the background, the camera flies on a
 * straight path from wherever it stands to the target pose (`poseAt`).
 *
 * Units: the world is laid out in `vw` exactly like the mock (rounds/05.html,
 * `.d5-world`, 350 × 262.5 cqw at a 100-cqw stage). A pose is the mock's
 * `transform: scale(s) translate(x, y)` with `transform-origin: 0 0`, so a
 * world point w lands on screen at `s · (w + t)`.
 *
 * The Verse hub draws its own live planet and tiles (`sc-briefing-planet`):
 * at the `verse` pose the scene hides its copies (`pageDraws`), so there are
 * never two planets (r3 „zwei riesen planeten“).
 */

/** A camera pose: zoom and the world translation in vw (mock `scale(s) translate(x, y)`). */
export interface CameraPose {
  readonly s: number;
  readonly x: number;
  readonly y: number;
}

/** The objects of the world that a pose shows or hides (per-pose isolation, C5). */
export type SceneObject = 'planet' | 'news' | 'patches' | 'gallery' | 'starmap' | 'station' | 'hqst' | 'holo';

export const SCENE_OBJECTS: readonly SceneObject[] = ['planet', 'news', 'patches', 'gallery', 'starmap', 'station', 'hqst', 'holo'];

/** Every named place the camera can stand. `deep` = pages outside the areas (settings, profile, …). */
export type ScenePoseId =
  | 'entrance'
  | 'verse'
  | 'news'
  | 'patches'
  | 'gallery'
  | 'starmap'
  | 'codex'
  | 'codex-index'
  | 'hq'
  | 'hq-sub'
  | 'admin'
  | 'deep';

/** World rectangles of the set pieces (vw, mock `.d5-o-*` / `.d5-o-hi-*`). */
export const WORLD_RECTS: Readonly<Record<'planet' | 'news' | 'patches' | 'gallery' | 'starmap' | 'station' | 'hqst' | 'holo', readonly [number, number, number, number]>> = {
  planet: [69.688, 85.75, 160, 160],
  news: [103.438, 82.938, 6, 6],
  patches: [114.625, 80, 4.625, 4.625],
  gallery: [181.5, 79.313, 6, 6],
  starmap: [169, 76.688, 5.938, 4.375],
  station: [124.313, 73.5, 6.063, 4.375],
  hqst: [172.375, 89.125, 2.75, 1.375],
  holo: [225, 37.5, 100, 56.25],
};

const VERSE: CameraPose = { s: 1, x: -100, y: -50 };
/** News: the planet big at the left edge (mock `d5-news-cam` end). */
const NEWS: CameraPose = { s: 7.8571, x: -106.756, y: -81.801 };

/**
 * The pose that puts `rect` where the News pose puts the News planet (big,
 * cut by the left edge), so Patches and Galerie frame their planets the same way.
 */
export function framedLikeNews(rect: readonly [number, number, number, number]): CameraPose {
  const [nx, ny, nw] = WORLD_RECTS.news;
  const sx = NEWS.s * (nx + NEWS.x);
  const sy = NEWS.s * (ny + NEWS.y);
  const s = (NEWS.s * nw) / rect[2];
  return { s, x: sx / s - rect[0], y: sy / s - rect[1] };
}

export interface ScenePoseDef {
  readonly cam: CameraPose;
  /** Objects shown at rest (opacity); every other object fades out during the flight. */
  readonly show: Partial<Record<SceneObject, number>>;
  /** Dimming veil, 0 = none (HQ `.d5-calm` = 0.38). */
  readonly veil: number;
}

export const POSES: Readonly<Record<ScenePoseId, ScenePoseDef>> = {
  // First visit: the camera far out, the whole world small (mock `d5-pb-main-cam` 0 %).
  entrance: { cam: { s: 0.42, x: -30.952, y: -11.161 }, show: { planet: 1, hqst: 1, holo: 1 }, veil: 0 },
  // The hub draws its own planet and tiles: the scene shows only what the page does not.
  verse: { cam: VERSE, show: { hqst: 1, holo: 1 }, veil: 0 },
  news: { cam: NEWS, show: { news: 1 }, veil: 0 },
  patches: { cam: framedLikeNews(WORLD_RECTS.patches), show: { patches: 1 }, veil: 0 },
  gallery: { cam: framedLikeNews(WORLD_RECTS.gallery), show: { gallery: 1 }, veil: 0 },
  // The constellation morphs into the star map; the big planet stays faint, Galerie is gone (r4).
  starmap: { cam: { s: 3, x: -155.427, y: -70.5 }, show: { starmap: 1, planet: 0.3 }, veil: 0 },
  codex: { cam: { s: 1, x: -225, y: -37.5 }, show: { planet: 1, holo: 1 }, veil: 0 },
  // Below the holotable: an even background for the index (r2 „gleichmäßiger hintergrund“).
  'codex-index': { cam: { s: 1.2, x: -233.021, y: -87.813 }, show: { planet: 1 }, veil: 0.22 },
  // On the planet's night side, right half, zoomed in: only a calm hint of city lights.
  hq: { cam: { s: 3.6, x: -162.986, y: -120.313 }, show: { planet: 1, hqst: 1 }, veil: 0.38 },
  // Further HQ pages continue straight below HQ (r3 „einfach darunter“).
  'hq-sub': { cam: { s: 3.6, x: -162.986, y: -135.938 }, show: { planet: 1, hqst: 1 }, veil: 0.38 },
  // Only the station, big; no planet (r3).
  admin: { cam: { s: 6, x: -115.365, y: -71.521 }, show: { station: 1 }, veil: 0 },
  // Pages outside the areas: the Verse view with its planet, under a veil (minor-page playbook dims the scene).
  deep: { cam: VERSE, show: { planet: 1, hqst: 1, holo: 1 }, veil: 0.45 },
};

/** Main ↔ main flight (r2 decision). */
export const SCENE_FLIGHT_MS = 1100;
/** Push-in towards the clicked element / pull-out on back (detail playbook `d4-pb-detail`). */
export const SCENE_PUSH_MS = 700;
/** Reduced motion: crossfade instead of any flight. */
export const SCENE_FADE_MS = 420;
/** Zoom factor of a push-in towards the clicked element. */
export const SCENE_PUSH_ZOOM = 1.12;
/** Extra veil on a pushed-in (detail) page. */
export const SCENE_PUSH_VEIL = 0.15;

/** Ease-in-out cubic (parity: „ease-in-out cubic“). */
export function easeInOutCubic(t: number): number {
  const u = Math.min(1, Math.max(0, t));
  return u < 0.5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2;
}

/**
 * The straight camera path between two poses at progress `u` (0…1, already
 * eased): zoom interpolates logarithmically about the one world point both
 * poses put on the same screen spot, so that point stands still and every
 * other point moves on a straight line — no swing, no direction change (C3).
 * Equal zoom: a plain linear pan.
 */
export function poseAt(a: CameraPose, b: CameraPose, u: number): CameraPose {
  if (u <= 0) return a;
  if (u >= 1) return b;
  if (Math.abs(a.s - b.s) < 1e-9) return { s: a.s, x: a.x + (b.x - a.x) * u, y: a.y + (b.y - a.y) * u };
  const s = a.s * Math.pow(b.s / a.s, u);
  // Fixed point F (world): a.s·(F + a.t) = b.s·(F + b.t).
  const fx = (b.s * b.x - a.s * a.x) / (a.s - b.s);
  const fy = (b.s * b.y - a.s * a.y) / (a.s - b.s);
  const cx = a.s * (fx + a.x);
  const cy = a.s * (fy + a.y);
  return { s, x: cx / s - fx, y: cy / s - fy };
}

/** The CSS transform of a pose (world layer). */
export function poseTransform(p: CameraPose): string {
  return `scale(${round(p.s)}) translate(${round(p.x)}vw, ${round(p.y)}vw)`;
}

/** The sky follows the camera damped (stars far away move less than the planet). */
export function skyTransform(p: CameraPose): string {
  const s = 1 + (Math.max(0.3, p.s) - 1) * 0.035;
  return `translate(${round((p.x - VERSE.x) * 0.12)}vw, ${round((p.y - VERSE.y) * 0.12)}vw) scale(${round(s)})`;
}

/** `pose` zoomed by `k` about the screen point `(px, py)` (vw) — the push-in towards a clicked element. */
export function zoomAbout(p: CameraPose, k: number, px: number, py: number): CameraPose {
  const s = p.s * k;
  return { s, x: px / s - px / p.s + p.x, y: py / s - py / p.s + p.y };
}

function round(n: number): number {
  return Math.round(n * 10000) / 10000;
}

/** Path without query / fragment / trailing slash. */
export function scenePath(url: string): string {
  const path = url.split(/[?#]/, 1)[0] ?? '';
  return path.length > 1 ? path.replace(/\/+$/, '') : path;
}

const VERSE_SUB: Readonly<Record<string, ScenePoseId>> = { news: 'news', patches: 'patches', gallery: 'gallery', explorer: 'starmap' };

/**
 * Where a URL stands: its pose, and how many segments it lies below that
 * pose's own page (`depth` > 0 = pushed in towards the clicked element).
 */
export function sceneTargetOf(url: string): { pose: ScenePoseId; depth: number } {
  const parts = scenePath(url).split('/').filter(Boolean);
  const [a, b] = parts;
  if (a === 'verse') {
    if (!b) return { pose: 'verse', depth: 0 };
    const sub = VERSE_SUB[b];
    return sub ? { pose: sub, depth: parts.length - 2 } : { pose: 'deep', depth: 0 };
  }
  if (a === 'codex') return b ? { pose: 'codex-index', depth: parts.length - 2 } : { pose: 'codex', depth: 0 };
  if (a === 'hq') return b ? { pose: 'hq-sub', depth: parts.length - 2 } : { pose: 'hq', depth: 0 };
  if (a === 'admin') return { pose: 'admin', depth: b && b !== 'hub' ? parts.length - 2 : 0 };
  return { pose: 'deep', depth: 0 };
}

/** The Verse hub itself (the footer keeps its stage mode off there). */
export function isVerseHome(url: string): boolean {
  return scenePath(url) === '/verse';
}
