// The reader's own data as a search source (lines A2, C11, C12).
// -----------------------------------------------------------------------------
// Pure and client-side ONLY: hangar ships (type + own name), saved variants
// (config names), FPS/role sets and inventory items are matched in memory. The
// term never leaves the browser for this group and the data never enters the
// shared index or a request payload (#832 part 2). Signed-out readers get no
// rows because the sources are empty.

import type { HangarRoleLoadout, HangarShip, HangarShipConfig } from '../../hangar/hangar.types';
import { hqLocker, hqShip, hqSet, hqHangar } from '../../hq/hq-routes';
import { humanizeClassName } from '../codex-format';
import { recordScore, searchMatcher } from '../codex-search';
import type { SearchTarget } from './codex-search-model';
import type { OwnRowType, SearchResultRow } from './search-result-model';

export type OwnMatch = Omit<Extract<SearchResultRow, { type: 'own' }>, 'cta' | 'icons'>;

/** The inventory columns the search needs. */
export interface OwnInventoryItem {
  name: string;
  class_name: string | null;
  location: string;
  qty: number;
}

export interface OwnSources {
  ships: readonly HangarShip[];
  configs: readonly HangarShipConfig[];
  sets: readonly HangarRoleLoadout[];
  items: readonly OwnInventoryItem[];
}

export interface OwnSearchResult {
  /** Best matches first, at most `limit`. */
  rows: OwnMatch[];
  /** Every match — "Alle N im HQ öffnen". */
  total: number;
}

const KIND_ORDER: Record<OwnRowType, number> = { ship: 0, config: 1, set: 2, item: 3 };

/** Where "Alle N im HQ öffnen" leads for a set of own rows. */
export function ownMoreTarget(rows: readonly OwnMatch[], term: string): SearchTarget {
  const q = term.trim();
  const qp = q ? { q } : null;
  const first = rows[0]?.ownKind;
  if (first === 'set') return { link: [hqLocker], queryParams: qp };
  if (first === 'item') return { link: ['/hq'], queryParams: qp, fragment: 'inventar' };
  return { link: [hqHangar], queryParams: qp };
}

/**
 * Match the term against the reader's own data.
 *
 * @param nameOf Catalog name of a ship class ("Aegis Gladius"); defaults to the humanised class name.
 * @param all Without a term, list everything instead of nothing.
 */
export function searchOwn(
  term: string,
  src: OwnSources,
  opts: { limit?: number; nameOf?: (className: string) => string | null; kinds?: readonly OwnRowType[]; all?: boolean } = {},
): OwnSearchResult {
  // `all`: an empty term lists every record of the wanted kinds ("lager" alone is the whole Inventar).
  const match = searchMatcher(term) ?? (opts.all ? (): boolean => true : null);
  if (!match) return { rows: [], total: 0 };
  const limit = opts.limit ?? 5;
  const nameOf = (c: string): string => opts.nameOf?.(c) || humanizeClassName(c);
  const want = (k: OwnRowType): boolean => !opts.kinds || opts.kinds.includes(k);
  const found: { row: OwnMatch; score: number; i: number }[] = [];
  const add = (row: OwnMatch, names: (string | null)[], ids: (string | null)[] = []): void => {
    found.push({ row, score: recordScore(term, names, ids), i: found.length });
  };

  const owned = src.ships.filter((s) => s.status === 'owned');
  const shipsById = new Map(src.ships.map((s) => [s.id, s]));

  if (want('ship')) {
    for (const s of owned) {
      const type = nameOf(s.shipClassName);
      if (!match(s.customName, type, s.shipClassName)) continue;
      add(
        {
          type: 'own', id: `own-ship-${s.id}`, ownKind: 'ship', title: type, ownName: s.customName?.trim() || null,
          subtitle: null, classNameSlug: s.shipClassName, qty: null,
          target: { link: hqShip(s.id), queryParams: null },
        },
        [s.customName, type],
        [s.shipClassName],
      );
    }
  }
  if (want('config')) {
    for (const c of src.configs) {
      const ship = shipsById.get(c.hangarShipId);
      if (!ship || ship.status !== 'owned' || !match(c.name)) continue;
      add(
        {
          type: 'own', id: `own-config-${c.id}`, ownKind: 'config', title: nameOf(ship.shipClassName),
          ownName: c.name, subtitle: ship.customName?.trim() || null, classNameSlug: ship.shipClassName, qty: null,
          target: { link: hqShip(ship.id), queryParams: null },
        },
        [c.name],
      );
    }
  }
  if (want('set')) {
    for (const s of src.sets) {
      if (!match(s.name)) continue;
      add(
        {
          type: 'own', id: `own-set-${s.id}`, ownKind: 'set', title: s.name, ownName: null, subtitle: null,
          classNameSlug: null, qty: null, target: { link: hqSet(s.id), queryParams: null },
        },
        [s.name],
      );
    }
  }
  if (want('item')) {
    const seen = new Set<string>();
    for (const it of src.items) {
      if (!match(it.name, it.class_name)) continue;
      const key = `${it.name}|${it.location}`;
      if (seen.has(key)) continue;
      seen.add(key);
      add(
        {
          type: 'own', id: `own-item-${found.length}`, ownKind: 'item', title: it.name, ownName: null,
          subtitle: it.location || null, classNameSlug: it.class_name, qty: it.qty,
          target: { link: ['/hq'], queryParams: { q: it.name }, fragment: 'inventar' },
        },
        [it.name],
        [it.class_name],
      );
    }
  }
  found.sort((a, b) => b.score - a.score || KIND_ORDER[a.row.ownKind] - KIND_ORDER[b.row.ownKind] || a.i - b.i);
  return { rows: found.slice(0, limit).map((f) => f.row), total: found.length };
}
