// Schnellzugriff (concept "Nachschub ins HQ", r4-d1-s1; formerly "Merkliste").
// -----------------------------------------------------------------------------
// Pure part: which page type the reader stands on, and how the rows of the panel
// are cut from the sources (recently opened, wishlist, the context Bestand section). No framework.

import type { SearchTarget } from '../../codex/search/codex-search-model';
import { polyHitLink, polyHitQueryParams } from '../../codex/codex-poly-search';
import { humanizeClassName } from '../../codex/codex-format';
import type { StoredRow } from '../fusion-bar/search-recent-rows';
import type { WishRow } from '../../hq/data/wishlist.store';

/** The page types the panel sorts by. `null` = a page of no type (the lists are not cut). */
export type MerkType = 'ship' | 'weapon' | 'component' | 'item' | 'blueprint' | 'news';

/** Rows shown per section: three recent (seven after "Mehr anzeigen"), the last three wished, the last three of the context. */
export const MERK_RECENT_SHOWN = 3;
export const MERK_RECENT_MAX = 7;
export const MERK_WISH_SHOWN = 3;
export const MERK_CONTEXT_SHOWN = 3;

/** Announced ships belong to the ship type. */
export function typeOfKind(kind: string): MerkType | null {
  if (kind === 'upcoming' || kind === 'ship') return 'ship';
  if (kind === 'weapon' || kind === 'component' || kind === 'item' || kind === 'blueprint') return kind;
  return null;
}

/**
 * The type of a router URL: Codex index/detail by kind, Verse news by news, a ship page in the HQ hangar by ship.
 * Anything else is untyped (HQ start and the other HQ pages, Verse, Social, ...): no context section there.
 */
export function merkTypeOf(url: string): MerkType | null {
  const [pathPart, query = ''] = url.split('#', 1)[0].split('?');
  const seg = pathPart.split('/').filter(Boolean);
  if (seg[0] === 'verse') return seg[1] === 'news' ? 'news' : null;
  if (seg[0] === 'hq') return seg[1] === 'hangar' ? 'ship' : null;
  if (seg[0] !== 'codex') return null;
  if (seg.length === 1) return 'ship';
  if (seg[1] === 'upcoming' || seg[1] === 'ship') return 'ship';
  if (seg[1] === 'fps') return 'weapon';
  if (seg[1] === 'index') return typeOfKind(new URLSearchParams(query).get('kind') ?? 'ship') ?? 'ship';
  return typeOfKind(seg[1]);
}

/** One row of the panel; `link` is always a real anchor target. */
export interface MerkRow {
  id: string;
  /** Path icon family key: the type the row belongs to. */
  type: MerkType;
  title: string;
  subtitle: string | null;
  /** i18n key of the subtitle (news channels); wins over `subtitle`. */
  subtitleKey?: string;
  /** Router target; external news articles use `href` instead. */
  target: SearchTarget | null;
  href: string | null;
  /** What the thumbnail draws: the entity kind and class name (absent: the kind icon of `type`). */
  kind?: string;
  className?: string;
  /** Quantity chip ("2x"); absent or 1 shows none for a recent row, always shown for wished / stocked rows. */
  qty?: number | null;
}

export function recentRowsOfType(rows: readonly StoredRow[], type: MerkType | null): MerkRow[] {
  const out: MerkRow[] = [];
  for (const r of rows) {
    if (r.type === 'hit') {
      const t = typeOfKind(r.hit.kind);
      if (!t || (type && t !== type)) continue;
      out.push({
        id: r.id,
        type: t,
        title: r.hit.nameLocalized || humanizeClassName(r.hit.classNameSlug),
        subtitle: r.hit.manufacturerCode ?? null,
        target: r.target,
        href: null,
        kind: r.hit.kind,
        className: r.hit.classNameSlug,
      });
    } else if (r.type === 'own') {
      const t = r.ownKind === 'ship' ? 'ship' : r.ownKind === 'item' ? 'item' : null;
      if (!t || (type && t !== type)) continue;
      out.push({ id: r.id, type: t, title: r.title, subtitle: r.ownName ?? r.subtitle, target: r.target, href: null });
    }
  }
  return out;
}

/**
 * A wished entry as a panel row. The title is the stored name, else the catalog name `nameOf`
 * resolved for the class, else the readable class name (never the raw "MISL_S01_IR_VNCL_Arrow").
 */
export function wishRowOfType(
  w: Pick<WishRow, 'kind' | 'className' | 'name' | 'manufacturer'> & { qty?: number },
  type: MerkType | null,
  nameOf?: (kind: string, className: string) => string | null,
): MerkRow | null {
  const t = typeOfKind(w.kind);
  if (!t || (type && t !== type)) return null;
  const target: SearchTarget = {
    link: polyHitLink({ kind: w.kind as never, classNameSlug: w.className }),
    queryParams: polyHitQueryParams({ kind: w.kind as never, nameLocalized: w.name, classNameSlug: w.className }),
  };
  return {
    id: `wish:${w.kind}:${w.className}`,
    type: t,
    title: w.name || nameOf?.(w.kind, w.className) || humanizeClassName(w.className),
    subtitle: w.kind === 'upcoming' ? null : w.manufacturer,
    target,
    href: null,
    kind: w.kind,
    className: w.className,
    qty: w.qty ?? null,
  };
}

/** The panel's tab is named after the type. */
export const MERK_TYPE_LABEL: Record<MerkType, string> = {
  ship: 'quick.type.ship',
  weapon: 'quick.type.weapon',
  component: 'quick.type.component',
  item: 'quick.type.item',
  blueprint: 'quick.type.blueprint',
  news: 'quick.type.news',
};
