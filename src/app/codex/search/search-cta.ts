// The ONE main action of a search row, and which standard icons a row gets.
// -----------------------------------------------------------------------------
// Pure. The table below IS the corrected CTA matrix of round 3 (`q3-matrix`,
// verified "ok" by the owner) — one row per context, one column per kind of
// row. Cells marked `*` need a feature that does not exist yet (own follow-up
// issues): they fall back to the neutral row's CTA of the same column, or to
// no CTA when that one is a `*` too. "Im Index" is gone; news, patches, gallery
// and app pages have no CTA and no icons.

import { UPCOMING_HIT_KIND, type PolyHitKind } from '../codex-poly-search';
import type { SearchContext } from '../../shell/fusion-bar/search-context';
import { hqSet, hqShip } from '../../hq/hq-routes';
import type { SearchTarget } from './codex-search-model';
import type { OwnRowType, RowOwnership, SearchCta, SearchCtaId, SearchRowIcons } from './search-result-model';

/** What the CTA needs to know about a row. */
export interface CtaRow {
  type: 'hit' | 'own' | 'patch' | 'gallery' | 'place';
  kind?: PolyHitKind | null;
  classNameSlug?: string | null;
  manufacturerCode?: string | null;
  ownership?: RowOwnership | null;
  /** Own-data rows: what it is, and the hangar ship / set id behind it. */
  ownKind?: OwnRowType;
  ownRefId?: string | null;
  /** The row's own anchor target (Bei RSI, Bezugsquelle). */
  target?: SearchTarget | null;
  /** The reader's flagship (Gegenüberstellung in a neutral context). */
  flagshipClassName?: string | null;
}

/** Cell codes: a CTA id, `N` = as neutral, `-` = none, `*` = needs a new feature. */
type Cell = SearchCtaId | 'N' | '-' | '*' | 'compareSame';
type Column = 'owned' | 'ship' | 'weaponComponent' | 'fps' | 'ammunition' | 'blueprint' | 'upcoming' | 'manufacturer' | 'mission';

export const CTA_COLUMNS: readonly Column[] = [
  'owned', 'ship', 'weaponComponent', 'fps', 'ammunition', 'blueprint', 'upcoming', 'manufacturer', 'mission',
];

export type CtaRowKey = 'neutral' | 'chipShip' | 'chipItem' | 'hqHangar' | 'hqStock' | 'hqPlan' | 'signedOut';

/** Round 3 `q3-matrix`, cell for cell. Order of cells = {@link CTA_COLUMNS}. */
export const CTA_MATRIX: Readonly<Record<CtaRowKey, readonly Cell[]>> = {
  neutral:   ['myLoadout', 'compareWith', '*', 'inSet', '*', 'materialToSupply', 'atRsi', 'allProducts', '*'],
  chipShip:  ['compareWith', 'compareWith', '*', 'N', 'N', 'N', 'N', 'N', 'N'],
  chipItem:  ['*', 'N', 'compareSame', 'compareSame', 'N', 'N', 'N', 'N', 'N'],
  hqHangar:  ['myLoadout', 'add', '*', 'inSet', 'N', 'N', 'atRsi', 'N', 'N'],
  hqStock:   ['myLoadout', 'add', 'whereStored', 'whereStored', 'whereStored', 'N', '-', 'N', 'N'],
  hqPlan:    ['planOps', '*', 'sourceOf', 'sourceOf', 'sourceOf', 'materialToSupply', 'N', 'N', '*'],
  signedOut: ['-', 'add', '*', 'N', 'N', 'N', 'atRsi', 'allProducts', 'N'],
};

const KINDS_WITH_COMPARE: ReadonlySet<PolyHitKind> = new Set<PolyHitKind>([
  'ship', 'weapon', 'component', 'item', 'ammunition', 'blueprint',
]);

/** Hit kinds that carry the three icons (B9). */
const EQUIPMENT: ReadonlySet<PolyHitKind> = new Set<PolyHitKind>(['weapon', 'component', 'item', 'ammunition']);

function columnOf(row: CtaRow): Column | null {
  switch (row.kind) {
    case 'ship': return 'ship';
    case 'weapon':
    case 'component': return 'weaponComponent';
    case 'item': return 'fps';
    case 'ammunition': return 'ammunition';
    case 'blueprint': return 'blueprint';
    case UPCOMING_HIT_KIND: return 'upcoming';
    case 'manufacturer': return 'manufacturer';
    default: return null;
  }
}

/** The HQ ship an owned row leads to (Mein Loadout), or null. */
function loadoutShipId(row: CtaRow): string | null {
  if (row.type === 'own') return row.ownKind === 'ship' || row.ownKind === 'config' ? (row.ownRefId ?? null) : null;
  return row.ownership?.shipId ?? row.ownership?.equippedOnShipId ?? null;
}

/** Which row of the matrix applies in this context. */
export function ctaRowKey(ctx: SearchContext, signedIn: boolean): CtaRowKey {
  if (!signedIn) return 'signedOut';
  const compat = ctx.chips.find((c) => c.filter.compatWith)?.filter.compatWith;
  if (compat) return compat.kind === 'ship' ? 'chipShip' : 'chipItem';
  switch (ctx.key) {
    case 'hq': return 'hqHangar';
    case 'hqStock': return 'hqStock';
    case 'hqPlan': return 'hqPlan';
    default: return 'neutral'; // incl. HQ Jetzt / Statistik / Schiff im HQ / Set / FPS-Liste (new contexts)
  }
}

/** Kinds a Codex list page (kind K) offers "Vergleichen" for, or null on other pages. */
function listKindOf(ctx: SearchContext): PolyHitKind | null {
  if (ctx.key !== 'codexIndex') return null;
  const k = ctx.labelParams?.['kind'] as PolyHitKind | undefined;
  return k && KINDS_WITH_COMPARE.has(k) ? k : null;
}

const NO_ICONS: SearchRowIcons = { wishlist: false, lager: false, nachschub: false };

function cta(id: SearchCtaId, type: 'link' | 'action', target: SearchTarget | null, needsSignIn = false): SearchCta {
  return { id, labelKey: `search.cta.${id}`, type, target, needsSignIn };
}

function build(id: SearchCtaId, row: CtaRow, ctx: SearchContext, signedIn: boolean): SearchCta | null {
  switch (id) {
    case 'myLoadout': {
      const ship = loadoutShipId(row);
      return ship ? cta('myLoadout', 'link', { link: hqShip(ship), queryParams: null }) : null;
    }
    case 'compare':
      return cta('compare', 'action', null);
    case 'compareWith': {
      // Neutral: against the reader's flagship — no flagship, nothing to compare with.
      const hasChip = ctx.chips.some((c) => c.filter.compatWith);
      return hasChip || row.flagshipClassName ? cta('compareWith', 'action', null) : null;
    }
    case 'inSet': {
      const set = row.ownership?.inSetIds[0];
      return set ? cta('inSet', 'link', { link: hqSet(set), queryParams: null }) : cta('inSet', 'action', null, !signedIn);
    }
    case 'materialToSupply':
      return cta('materialToSupply', 'action', null, !signedIn);
    case 'atRsi':
      return cta('atRsi', 'link', row.target ?? { link: ['/codex', 'upcoming'], queryParams: null });
    case 'allProducts': {
      const code = row.manufacturerCode ?? row.classNameSlug ?? null;
      return cta('allProducts', 'link', { link: ['/codex', 'index'], queryParams: code ? { kind: 'ship', mfr: code } : { kind: 'ship' } });
    }
    case 'add':
      return cta('add', 'action', null, !signedIn);
    case 'whereStored':
      return cta('whereStored', 'link', { link: ['/hq'], queryParams: null, fragment: 'bestand' });
    case 'planOps':
      return cta('planOps', 'link', { link: ['/hq', 'ops'], queryParams: null });
    case 'sourceOf':
      return cta('sourceOf', 'link', row.target ?? null);
    case 'openSet':
      return row.ownRefId ? cta('openSet', 'link', { link: hqSet(row.ownRefId), queryParams: null }) : null;
    default:
      return null;
  }
}

/**
 * The one main CTA of a row in a context, or null.
 *
 * Order: no-CTA rows (news / patch / gallery / page) → the reader's own data
 * (fixed: loadout, set, Lager) → "Vergleichen" on a Codex list page for rows of
 * that list's kind → the matrix row of the context × the column of the row's
 * kind (the Besitz column when the row is a ship / loadout of the reader's) →
 * `*` and unresolvable cells fall back to the neutral row.
 */
export function resolveCta(ctx: SearchContext, row: CtaRow, signedIn: boolean): SearchCta | null {
  if (row.type === 'patch' || row.type === 'gallery' || row.type === 'place') return null;

  if (row.type === 'own') {
    if (row.ownKind === 'set') return build('openSet', row, ctx, signedIn);
    if (row.ownKind === 'item') return build('whereStored', row, ctx, signedIn);
    return build('myLoadout', row, ctx, signedIn);
  }

  const column = columnOf(row);
  if (!column) return null;

  const listKind = listKindOf(ctx);
  if (listKind && row.kind === listKind && row.kind !== UPCOMING_HIT_KIND && row.kind !== 'manufacturer') {
    return build('compare', row, ctx, signedIn);
  }

  const key = ctaRowKey(ctx, signedIn);
  const owned = loadoutShipId(row) !== null;
  const idx = CTA_COLUMNS.indexOf(owned ? 'owned' : column);
  const neutralIdx = CTA_COLUMNS.indexOf(column);

  const chipItemKind = ctx.chips.find((c) => c.filter.compatWith)?.filter.compatWith?.kind;
  const own = (cell: Cell): SearchCta | null | 'neutral' => {
    if (cell === '-') return null;
    if (cell === '*' || cell === 'N') return 'neutral';
    if (cell === 'compareSame') return chipItemKind && chipItemKind === row.kind ? build('compareWith', row, ctx, signedIn) : 'neutral';
    return build(cell, row, ctx, signedIn);
  };

  let result = own(CTA_MATRIX[key][idx]);
  // Besitz cell without a usable result: the row's kind column answers instead.
  if (result === null && owned && CTA_MATRIX[key][idx] !== '-') result = own(CTA_MATRIX[key][neutralIdx]);
  if (result !== 'neutral') return result;

  const neutral = own(CTA_MATRIX.neutral[owned && CTA_MATRIX.neutral[idx] !== '*' ? idx : neutralIdx]);
  return neutral === 'neutral' ? null : neutral;
}

/**
 * Which of the three standard icons (Wunschliste · Lager · Nachschub) a row
 * gets. Only equipment, ships and blueprints have them; a blueprint gets the
 * Wunschliste only; `lager` on a ship means "In den Hangar"; an announced ship
 * can be wished for, not stored. Hidden, never greyed out. News, patches,
 * gallery, pages, manufacturers and the reader's own data have none.
 */
export function resolveIcons(row: Pick<CtaRow, 'type' | 'kind'>): SearchRowIcons {
  if (row.type !== 'hit' || !row.kind) return NO_ICONS;
  if (row.kind === 'ship') return { wishlist: true, lager: true, nachschub: true };
  if (row.kind === UPCOMING_HIT_KIND) return { wishlist: true, lager: false, nachschub: false };
  if (row.kind === 'blueprint') return { wishlist: true, lager: false, nachschub: false };
  if (EQUIPMENT.has(row.kind)) return { wishlist: true, lager: true, nachschub: true };
  return NO_ICONS;
}
