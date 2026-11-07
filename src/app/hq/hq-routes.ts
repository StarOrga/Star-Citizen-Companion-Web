/**
 * Route contract for HQ, the personal area (ships + variants, FPS sets,
 * later supplies and ops). Codex pages link into HQ and back only through
 * these helpers, so the paths and query-param names live in one place.
 *
 * Query params owned here — none collides with the codex ones (`view`,
 * `config`, `shared`, `loadout`, `kind`):
 *   `v`    — on /codex/ship/:className (shell beta off) and on /hq/hangar/:id: the personal variant (hangar config id) to show.
 *   `mine` — on /codex/:kind/:className (shell beta off): open the entity in "my copy" mode (flag, empty value).
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
export const HQ_PAGES = ['start', 'inventar', 'jetzt', 'planen', 'statistik'] as const;
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

/**
 * HQ Bestand (page `inventar`) deep links - the contract for the header quick access ("Gesamtes Inventar") and the Codex
 * search ("Inventar" node): `/hq?bestand=inventar&cat=weapons&focus=<className>#inventar`.
 *   `bestand` - the tab: `inventar` (default) | `hangar` | `sammlung`
 *   `cat`     - Inventar filter, a stock category (`weapons` | `armor` | `materials` | `other`); carried from the page type
 *   `focus`   - a class name (or name) to bring on screen and mark in that tab
 */
export const HQ_STOCK_TAB_PARAM = 'bestand';
export const HQ_STOCK_CAT_PARAM = 'cat';
export const HQ_STOCK_FOCUS_PARAM = 'focus';
export const HQ_STOCK_TABS = ['inventar', 'hangar', 'sammlung'] as const;
export type HqStockTab = (typeof HQ_STOCK_TABS)[number];

export function hqStockTabOf(v: string | null | undefined): HqStockTab | null {
  return (HQ_STOCK_TABS as readonly string[]).includes(v ?? '') ? (v as HqStockTab) : null;
}

/** The link to HQ Bestand: `[routerLink]="l.commands" [fragment]="l.fragment" [queryParams]="l.queryParams"`. */
export function hqStockLink(opts: { tab?: HqStockTab; cat?: string | null; focus?: string | null } = {}): HqPageLink {
  const q: Record<string, string> = {};
  if (opts.tab) q[HQ_STOCK_TAB_PARAM] = opts.tab;
  if (opts.cat) q[HQ_STOCK_CAT_PARAM] = opts.cat;
  if (opts.focus) q[HQ_STOCK_FOCUS_PARAM] = opts.focus;
  return { commands: [HQ_ROOT], fragment: 'inventar', queryParams: q };
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

/** Fragments that older links carry for a page that has since been renamed (`#bestand` is Inventar). */
const HQ_FRAGMENT_ALIASES: Readonly<Record<string, HqPageId>> = { bestand: 'inventar' };

/** The page a URL fragment names; null for none / unknown (Start is "no fragment"). Old aliases still resolve. */
export function hqPageOfFragment(fragment: string | null | undefined): HqPageId | null {
  const f = (fragment ?? '').replace(/^#/, '');
  if (Object.prototype.hasOwnProperty.call(HQ_FRAGMENT_ALIASES, f)) return HQ_FRAGMENT_ALIASES[f];
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

/**
 * The HQ page of one of the reader's own ships (shell beta): the Codex ship view in place under
 * HQ ▸ Hangar, showing variant `configId` (`?v=`) or the active one when omitted.
 */
export function hqShipLink(hangarShipId: string, configId?: string | null): HqLink {
  return { commands: [hqHangar, hangarShipId], queryParams: configId ? { [HQ_VARIANT_PARAM]: configId } : {} };
}

/**
 * The page of one of the reader's own ships. Without the shell beta: the personal Codex view of its
 * active (else first) variant, or the ship's Codex page when it has none. With it (`hq`): the ship's
 * HQ page, which `/hq/hangar/:id` renders in place.
 */
export function ownShipLink(
  ship: { id: string; shipClassName: string },
  configs: readonly { id: string; isActive: boolean }[],
  hq = false,
): HqLink {
  const cfg = configs.find((c) => c.isActive) ?? configs[0];
  if (hq) return hqShipLink(ship.id, cfg?.id);
  return cfg ? personalShipLink(ship.shipClassName, cfg.id) : personalItemLink('ship', ship.shipClassName);
}

/** One variant of one of the reader's ships: its HQ page under the shell beta, else the personal Codex view. */
export function ownVariantLink(
  ship: { id: string; shipClassName: string },
  configId: string,
  hq = false,
): HqLink {
  return hq ? hqShipLink(ship.id, configId) : personalShipLink(ship.shipClassName, configId);
}

/**
 * Entry of the `/hq/hangar/:id` page for callers that hold nothing but a hangar ship id. Without the
 * shell beta that route redirects to the ship's personal Codex view (old bookmarks), with it the route
 * renders the ship. Callers with the ship itself use {@link ownShipLink}.
 */
export const hangarRedirectLink = (id: string): string[] => [hqHangar, id];

/** One FPS/role set in the locker. */
export const hqSet = (id: string): string[] => [hqLocker, id];

/** The codex ship page showing one of the user's own variants. */
export function personalShipLink(className: string, configId: string): HqLink {
  return { commands: ['/codex/ship', className], queryParams: { [HQ_VARIANT_PARAM]: configId } };
}

/** The codex page of an entity in "mine" mode; under the shell beta (`plain`) Codex has no such mode, so the plain page. */
export function personalItemLink(kind: string, className: string, plain = false): HqLink {
  return { commands: ['/codex', kind, className], queryParams: plain ? {} : { [HQ_MINE_PARAM]: '' } };
}
