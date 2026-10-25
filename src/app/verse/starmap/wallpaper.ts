import type { VerseExplorerPatch, VerseExplorerState } from '../data/verse.models';
import type { RenderConstellation } from './constellation-render';
import { FALLBACK_POINTS, STARS_PER_PATCH } from './starmap.model';

/** Wallpaper inputs of the explorer state: selected patch first, then older ones. */
export function wallpaperConstellations(state: VerseExplorerState, first: VerseExplorerPatch): RenderConstellation[] {
  const rest = state.patches.filter((p) => p !== first && p.starCount > 0);
  return [first, ...rest].slice(0, 7).map((p) => ({
    patchLine: p.patchLine,
    points: p.constellation?.points?.length === 7 ? p.constellation.points : FALLBACK_POINTS,
    starCount: Math.min(STARS_PER_PATCH, p.starCount),
    sun: p.sun,
  }));
}
