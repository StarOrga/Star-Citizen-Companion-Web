/**
 * The app-wide background scene (beta `shell`): one camera over one set of CSS
 * layers. Each main area is a fixed camera POSE on that one scene; a
 * navigation flies directly from the current pose to the target pose.
 * Every other page inherits the sky of the main page it lives under, but
 * shows none of its set pieces (see `isSubPage`).
 *
 * The scene draws no planet: the only planet is the Verse hub's own live one
 * (`sc-briefing-planet`). An older CSS planet here used to flash before the
 * hub mounted, fly along between the areas and stand behind every sub-page.
 */
export type SceneKind = 'verse' | 'hq' | 'codex' | 'admin';

export const SCENES: readonly SceneKind[] = ['verse', 'hq', 'codex', 'admin'];

/** How a pose change plays: camera flight, reduced-motion dissolve, or a cut (sub-page target, first paint). */
export type SceneMode = 'still' | 'move' | 'fade';

export const SCENE_FADE_MS = 420;

/**
 * A camera pose as data. The component writes it as custom properties on the
 * scene and the stylesheet transitions `transform` / `opacity` towards them.
 */
export interface ScenePose {
  /** Transform of the sky layers. */
  sky: string;
  skyOpacity: number;
  /** Opacity of the night-surface layer (HQ: dark ground with faint city lights). */
  detail: number;
  /** Opacity of the ground-shade (keeps the footer corner dark). */
  ground: number;
  /** Opacity of the Codex holo glow. */
  plane: number;
  /** Dimming veil over the whole scene, 0 = none. */
  dim: number;
  /** Abstract camera position for the flight-distance function (x right, y down, z = depth/zoom). */
  cam: readonly [number, number, number];
}

export const POSES: Readonly<Record<SceneKind, ScenePose>> = {
  // Open sky: the hub draws its own planet into the page.
  verse: { sky: 'none', skyOpacity: 1, detail: 0, ground: 0, plane: 0, dim: 0, cam: [0, 0, 0] },
  // Camera panned right: the sky slides left, the holo glow of the Codex swings in.
  codex: { sky: 'translateX(-16vw)', skyOpacity: 1, detail: 0, ground: 0, plane: 1, dim: 0, cam: [1.1, 0.2, -0.2] },
  // Dive towards the surface: the sky drops away and fades, the night side rises in.
  hq: { sky: 'translateY(-10dvh) scale(1.08)', skyOpacity: 0.45, detail: 1, ground: 1, plane: 0, dim: 0, cam: [0, 1.8, 1.6] },
  // Admin hub: the open sky, slightly dimmed (a quieter stage for tables and forms).
  admin: { sky: 'none', skyOpacity: 1, detail: 0, ground: 0, plane: 0, dim: 0.28, cam: [0, 0, 0.1] },
};

/** Flight time: 0.9 s base plus a distance term, capped at 1.6 s. */
export const SCENE_MOVE_MIN_MS = 900;
export const SCENE_MOVE_MAX_MS = 1600;

/** Distance between two poses in camera space (x, y and zoom, zoom counting double). */
export function poseDistance(a: SceneKind, b: SceneKind): number {
  const [ax, ay, az] = POSES[a].cam;
  const [bx, by, bz] = POSES[b].cam;
  return Math.hypot(ax - bx, ay - by, (az - bz) * 1.25);
}

/** Verse↔Codex 1.1 s, Verse↔HQ 1.4 s, Codex↔HQ 1.5 s; never above 1.6 s, never below 0.9 s. */
export function flightMs(from: SceneKind, to: SceneKind): number {
  if (from === to) return 0;
  const ms = SCENE_MOVE_MIN_MS + poseDistance(from, to) * 200;
  return Math.round(Math.min(SCENE_MOVE_MAX_MS, Math.max(SCENE_MOVE_MIN_MS, ms)));
}

/** Path without query / fragment / trailing slash. */
export function scenePath(url: string): string {
  const path = url.split(/[?#]/, 1)[0] ?? '';
  return path.length > 1 ? path.replace(/\/+$/, '') : path;
}

/** The pose a URL shows: its main area's, the open sky for pages outside the areas. */
export function sceneOf(url: string): SceneKind {
  const first = scenePath(url).split('/')[1] ?? '';
  return first === 'hq' || first === 'codex' || first === 'admin' ? first : 'verse';
}

/** A main page — the only kind of target the camera flies for. */
export function isMainPage(url: string): boolean {
  const p = scenePath(url);
  return p === '/verse' || p === '/hq' || p === '/codex' || p === '/admin' || p === '/admin/hub';
}

/**
 * Every page that is not a main page: deep space only — its area's sky,
 * slightly dimmed, without the holo glow or the night surface, so lists,
 * forms and detail pages stand on a calm, neutral backdrop.
 */
export function isSubPage(url: string): boolean {
  return !isMainPage(url);
}

/** The Verse hub itself (the footer keeps its stage mode off there). */
export function isVerseHome(url: string): boolean {
  return scenePath(url) === '/verse';
}

/**
 * What a navigation does to the scene. Same pose: nothing (sub-pages stay
 * static). Different pose: the camera flies only for a main-page target;
 * a sub-page target cuts to its main page's pose. Reduced motion turns a
 * flight into a dissolve.
 */
export function sceneStep(from: SceneKind, url: string, reducedMotion: boolean): { scene: SceneKind; mode: SceneMode } | null {
  const scene = sceneOf(url);
  if (scene === from) return null;
  if (!isMainPage(url)) return { scene, mode: 'still' };
  return { scene, mode: reducedMotion ? 'fade' : 'move' };
}
