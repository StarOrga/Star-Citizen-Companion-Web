import { normalizeSearch } from '../../codex/codex-search';
import type { MapPlace } from '../plan/map/hq-map.types';
import { PlaceTier, placeDistance, placeOfName, placeTier } from '../plan/map/hq-places';

export type StockSort = 'nearest' | 'most';
export type StockUnit = 'pcs' | 'scu';

/** The fields of an inventory row the finder reads. */
export interface StockRow {
  location: string;
  name: string;
  qty: number;
  unit: StockUnit;
}

export interface StockHit {
  location: string;
  qty: number;
  tier: PlaceTier;
  /** How much to take here for the wanted amount; 0 = not needed for it (not highlighted). */
  take: number;
}

/** One item (names never mix: "Helm A" and "Helm B" do not add up to one amount). */
export interface StockGroup {
  name: string;
  unit: StockUnit;
  total: number;
  /** The wanted amount, 0 when none was asked for. */
  want: number;
  /** Places with `take` > 0. */
  stops: number;
  covered: boolean;
  hits: StockHit[];
}

export interface StockQuery {
  term: string;
  unit: StockUnit;
  /** 0 or less: only list, nothing to cover. */
  want: number;
  here: MapPlace | null;
  sort: StockSort;
}

/**
 * Where an item lies. Rows of the asked unit whose name matches (an exact name beats partial ones),
 * one group per item, sorted by distance from `here` or by amount. For a wanted amount: the first
 * place that holds all of it alone; if none does, places in sort order until the amount is reached.
 * Pure.
 */
export function findStock(rows: readonly StockRow[], q: StockQuery): StockGroup[] {
  const term = normalizeSearch(q.term.trim());
  if (!term) return [];
  const inUnit = rows.filter((r) => r.unit === q.unit && r.qty > 0);
  const exact = inUnit.filter((r) => normalizeSearch(r.name) === term);
  const matched = exact.length ? exact : inUnit.filter((r) => normalizeSearch(r.name).includes(term));

  const byName = new Map<string, StockRow[]>();
  for (const r of matched) byName.set(r.name, [...(byName.get(r.name) ?? []), r]);

  return [...byName.entries()]
    .map(([name, own]) => toGroup(name, own, q))
    .sort((a, b) => b.total - a.total || a.name.localeCompare(b.name));
}

/** Distinct item names of the reader's stock that fit the term, most stock first. */
export function stockNames(rows: readonly StockRow[], term: string, unit: StockUnit, max = 8): string[] {
  const t = normalizeSearch(term.trim());
  const totals = new Map<string, number>();
  for (const r of rows) {
    if (r.unit !== unit || (t && !normalizeSearch(r.name).includes(t))) continue;
    totals.set(r.name, (totals.get(r.name) ?? 0) + r.qty);
  }
  return [...totals.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, max)
    .map(([name]) => name);
}

function toGroup(name: string, own: readonly StockRow[], q: StockQuery): StockGroup {
  const located = own.map((r) => {
    const at = placeOfName(r.location);
    return { row: r, dist: placeDistance(q.here, at), tier: placeTier(q.here, at) };
  });
  located.sort((a, b) =>
    q.sort === 'nearest'
      ? a.dist - b.dist || b.row.qty - a.row.qty || a.row.location.localeCompare(b.row.location)
      : b.row.qty - a.row.qty || a.dist - b.dist || a.row.location.localeCompare(b.row.location),
  );
  const want = q.want > 0 ? q.want : 0;
  const takes = planTakes(located.map((l) => l.row.qty), want);
  const hits = located.map((l, i) => ({ location: l.row.location, qty: l.row.qty, tier: l.tier, take: takes[i] }));
  const total = own.reduce((n, r) => n + r.qty, 0);
  return {
    name,
    unit: q.unit,
    total,
    want,
    stops: takes.filter((t) => t > 0).length,
    covered: want > 0 && total >= want,
    hits,
  };
}

function planTakes(qtys: readonly number[], want: number): number[] {
  if (want <= 0) return qtys.map(() => 0);
  const alone = qtys.findIndex((q) => q >= want);
  if (alone >= 0) return qtys.map((_, i) => (i === alone ? want : 0));
  let left = want;
  return qtys.map((q) => {
    const take = Math.min(q, left);
    left -= take;
    return take;
  });
}
