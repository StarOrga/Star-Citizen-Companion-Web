/**
 * The app-wide background scene (beta `shell`): one camera over one set of CSS
 * layers. Each main area has a pose — Verse = open sky over the planet,
 * HQ = descended to the planet, the hangar doors open, Codex = turned right,
 * a strip of the planet left at the edge. Every other page inherits the pose
 * of the main page it lives under.
 */
export type SceneKind = 'verse' | 'hq' | 'codex';

export const SCENES: readonly SceneKind[] = ['verse', 'hq', 'codex'];

/** How a pose change plays: camera move, reduced-motion dissolve, or a cut (sub-page target, first paint). */
export type SceneMode = 'still' | 'move' | 'fade';

/** Camera move length; the HQ doors start once the descent is mostly done. */
export const SCENE_MOVE_MS = 1100;
export const SCENE_DOORS_DELAY_MS = 650;
export const SCENE_FADE_MS = 420;

/** Path without query / fragment / trailing slash. */
export function scenePath(url: string): string {
  const path = url.split(/[?#]/, 1)[0] ?? '';
  return path.length > 1 ? path.replace(/\/+$/, '') : path;
}

/** The pose a URL shows: its main area's, the open sky for pages outside the three areas. */
export function sceneOf(url: string): SceneKind {
  const first = scenePath(url).split('/')[1] ?? '';
  return first === 'hq' || first === 'codex' ? first : 'verse';
}

/** A main page — the only kind of target the camera moves for. */
export function isMainPage(url: string): boolean {
  const p = scenePath(url);
  return p === '/verse' || p === '/hq' || p === '/codex';
}

/** The Verse hub itself: the planet scrolls with its planet zone there. */
export function isVerseHome(url: string): boolean {
  return scenePath(url) === '/verse';
}

/**
 * What a navigation does to the scene. Same pose: nothing (sub-pages stay
 * static). Different pose: the camera moves only for a main-page target;
 * a sub-page target cuts to its main page's pose. Reduced motion turns a
 * move into a dissolve.
 */
export function sceneStep(from: SceneKind, url: string, reducedMotion: boolean): { scene: SceneKind; mode: SceneMode } | null {
  const scene = sceneOf(url);
  if (scene === from) return null;
  if (!isMainPage(url)) return { scene, mode: 'still' };
  return { scene, mode: reducedMotion ? 'fade' : 'move' };
}
