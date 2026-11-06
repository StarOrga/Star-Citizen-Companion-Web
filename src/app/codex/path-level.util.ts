import type { NavOriginService } from '../shared/page-header/nav-origin.service';

/**
 * How loud an item page's path control is: the full form when the reader came
 * from Planen (an HQ page; the fragment is not kept by NavOriginService) or from
 * a set, the pill otherwise. Concept gegenstand-weg D2.
 */
export function pathLevelFor(origin: NavOriginService): 'primary' | 'secondary' {
  const p = origin.previous()?.path ?? '';
  return p === '/hq' || p.startsWith('/codex/set') ? 'primary' : 'secondary';
}
