/**
 * Route contract for HQ, the personal area (ships + variants, FPS sets,
 * later supplies and ops). Codex pages link into HQ and back only through
 * these helpers, so the paths and query-param names live in one place.
 *
 * Query params owned here — none collides with the codex ones (`view`,
 * `config`, `shared`, `loadout`, `kind`):
 *   `v`    — on /codex/ship/:className: the personal variant (hangar config id) to show.
 *   `mine` — on /codex/:kind/:className: open the entity in "my copy" mode (flag, empty value).
 *   `einsatz` — on /hq#planen: open Planen on the route of this saved Einsatz.
 *   `list` — on /hq#planen: open the wish / Nachschub popup on that tab (`wish` | `nachschub`).
 */

export const HQ_ROOT = '/hq';
export const hqHangar = '/hq/hangar';
export const hqLocker = '/hq/locker';
export const hqOps = '/hq/ops';

/**
 * The five HQ pages of the beta landing (`/hq`): one route, five scroll stages.
 * Start is `/hq`, the others are fragments (`/hq#planen`). Order = scroll order.
 */
export const HQ_PAGES = ['start', 'bestand', 'jetzt', 'planen', 'statistik'] as const;
export type HqPageId = (typeof HQ_PAGES)[number];

/** A router link to one HQ page: `[routerLink]="l.commands" [fragment]="l.fragment"`. */
export interface HqPageLink {
  commands: string[];
  fragment: string | undefined;
  queryParams?: Record<string, string>;
}

/** Query param that opens the wish / Nachschub popup of Planen on one tab. */
export const HQ_LIST_PARAM = 'list';
export type HqListTab = 'wish' | 'nachschub';

/** The link that opens the wish / Nachschub popup on `tab` (`/hq?list=wish#planen`). */
export function hqListLink(tab: HqListTab): HqPageLink {
  return { commands: [HQ_ROOT], fragment: 'planen', queryParams: { [HQ_LIST_PARAM]: tab } };
}

/** The tab a `list` query value names; null for none / unknown. */
export function hqListTabOf(v: string | null | undefined): HqListTab | null {
  return v === 'wish' || v === 'nachschub' ? v : null;
}

export function hqPage(page: HqPageId): HqPageLink {
  return { commands: [HQ_ROOT], fragment: page === 'start' ? undefined : page };
}

/** The href of an HQ page (`/hq`, `/hq#planen`). */
export function hqPageHref(page: HqPageId): string {
  return page === 'start' ? HQ_ROOT : `${HQ_ROOT}#${page}`;
}

/** The href that opens exactly the route of one saved Einsatz on Planen. */
export function hqEinsatzHref(id: string): string {
  return `${HQ_ROOT}?${HQ_EINSATZ_PARAM}=${encodeURIComponent(id)}#planen`;
}

/** The page a URL fragment names; null for none / unknown (Start is "no fragment"). */
export function hqPageOfFragment(fragment: string | null | undefined): HqPageId | null {
  const f = (fragment ?? '').replace(/^#/, '');
  return (HQ_PAGES as readonly string[]).includes(f) ? (f as HqPageId) : null;
}

/** Query-param names of the HQ contract. */
export const HQ_EINSATZ_PARAM = 'einsatz';
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
