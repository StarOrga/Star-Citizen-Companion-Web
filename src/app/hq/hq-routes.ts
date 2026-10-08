/**
 * Route contract for HQ, the personal area (ships + variants, FPS sets,
 * later supplies and ops). Codex pages link into HQ and back only through
 * these helpers, so the paths and query-param names live in one place.
 *
 * Query params owned here — none collides with the codex ones (`view`,
 * `config`, `shared`, `loadout`, `kind`):
 *   `v`    — on /codex/ship/:className: the personal variant (hangar config id) to show.
 *   `mine` — on /codex/:kind/:className: open the entity in "my copy" mode (flag, empty value).
 */

export const HQ_ROOT = '/hq';
export const hqHangar = '/hq/hangar';
export const hqLocker = '/hq/spind';
export const hqOps = '/hq/einsaetze';

/** Query-param names of the HQ contract. */
export const HQ_VARIANT_PARAM = 'v';
export const HQ_MINE_PARAM = 'mine';

/** A router link: `[routerLink]="l.commands" [queryParams]="l.queryParams"`. */
export interface HqLink {
  commands: string[];
  queryParams: Record<string, string>;
}

/** One hangar ship in HQ. */
export const hqShip = (id: string): string[] => [hqHangar, id];

/** One FPS/role set in the locker. */
export const hqSet = (id: string): string[] => [hqLocker, id];

/** The codex ship page showing one of the user's own variants. */
export function personalShipLink(className: string, configId: string): HqLink {
  return { commands: ['/codex/ship', className], queryParams: { [HQ_VARIANT_PARAM]: configId } };
}

/** The codex page of an entity in "mine" mode. */
export function personalItemLink(kind: string, className: string): HqLink {
  return { commands: ['/codex', kind, className], queryParams: { [HQ_MINE_PARAM]: '' } };
}
