import type { HqLiveEventRow } from '../data/hq-db.types';
import { parsePreviousSnapshot } from '../data/hq-inventory.service';
import { type StockCategory, type StockItem, categoryOf } from './hq-stock-model';

/** One tile of the Inventar page: one thing over all places. */
export interface InvTile {
  /** Class name when there is one, else the folded name. */
  readonly key: string;
  readonly name: string;
  readonly className: string | null;
  readonly qty: number;
  readonly unit: 'pcs' | 'scu';
  /** Places it lies in, largest stack first. */
  readonly places: readonly string[];
  readonly cat: StockCategory;
}

export const identityOf = (r: Pick<StockItem, 'class_name' | 'name'>): string => (r.class_name || r.name).trim().toLowerCase();

/**
 * Inventory rows folded into tiles: one tile per thing, quantities added over all places (SCU and pieces of one
 * thing do not mix: the unit of the first row wins). Blueprint rows (the Sammlung) are not Inventar and are skipped
 * via `skipPlace`. Order: biggest category stack first is NOT wanted; the order of the rows (newest place first) holds.
 */
export function buildTiles(rows: readonly StockItem[], skipPlace?: string): InvTile[] {
  const out = new Map<string, { t: Omit<InvTile, 'places'>; places: Map<string, number> }>();
  for (const r of rows) {
    if (skipPlace && r.location === skipPlace) continue;
    if (r.qty <= 0) continue;
    const key = identityOf(r);
    let e = out.get(key);
    if (!e) {
      e = { t: { key, name: r.name, className: r.class_name, qty: 0, unit: r.unit, cat: categoryOf(r) }, places: new Map() };
      out.set(key, e);
    }
    e.t = { ...e.t, qty: e.t.qty + r.qty };
    if (r.location.trim()) e.places.set(r.location, (e.places.get(r.location) ?? 0) + r.qty);
  }
  return [...out.values()].map(({ t, places }) => ({
    ...t,
    places: [...places.entries()].sort((a, b) => b[1] - a[1]).map(([p]) => p),
  }));
}

/** The tiles a filter lets through: a category (null = all) and a free text over the name and class name. */
export function filterTiles(tiles: readonly InvTile[], cat: StockCategory | null, q: string): InvTile[] {
  const needle = q.trim().toLowerCase();
  return tiles.filter(
    (t) => (!cat || t.cat === cat) && (!needle || t.name.toLowerCase().includes(needle) || (t.className ?? '').toLowerCase().includes(needle)),
  );
}

/** Category counts for the filter chips. */
export function categoryCounts(tiles: readonly InvTile[]): Map<StockCategory, number> {
  const m = new Map<StockCategory, number>();
  for (const t of tiles) m.set(t.cat, (m.get(t.cat) ?? 0) + 1);
  return m;
}

export const USED_UP_WINDOW_MS = 48 * 3_600_000;

/** Something that was used up: the stock fell between two snapshots of a place. */
export interface UsedUp {
  readonly key: string;
  readonly name: string;
  readonly className: string | null;
  readonly qty: number;
  readonly unit: 'pcs' | 'scu';
  /** When the newest snapshot that showed the drop came in (ISO). */
  readonly at: string;
}

/**
 * "Kürzlich aufgebraucht": only what fell in the last 48 h. A replaced snapshot (`inventory.snapshot` event, `applied.previous`)
 * is the stock BEFORE; whatever of it is missing or lower now (at the same place) was used up. Summed per thing, newest first.
 * Rows without a replaced snapshot say nothing about consumption and are skipped.
 */
export function usedUpRecently(
  eventsNewestFirst: readonly Pick<HqLiveEventRow, 'type' | 'at' | 'applied' | 'undone'>[],
  current: readonly StockItem[],
  now: number,
): UsedUp[] {
  const have = new Map<string, number>();
  for (const r of current) {
    const k = `${r.location}\u0000${identityOf(r)}`;
    have.set(k, (have.get(k) ?? 0) + r.qty);
  }
  const out = new Map<string, UsedUp>();
  for (const ev of eventsNewestFirst) {
    if (ev.type !== 'inventory.snapshot' || ev.undone) continue;
    const at = Date.parse(ev.at);
    if (!Number.isFinite(at) || now - at > USED_UP_WINDOW_MS) continue;
    const prev = parsePreviousSnapshot((ev.applied as Record<string, unknown> | null)?.['previous']);
    if (!prev) continue;
    for (const it of prev.items) {
      const id = (it.class_name || it.name).trim().toLowerCase();
      const dropped = it.qty - (have.get(`${prev.location}\u0000${id}`) ?? 0);
      if (dropped <= 1e-9) continue;
      const cur = out.get(id);
      if (cur) out.set(id, { ...cur, qty: cur.qty + dropped });
      else out.set(id, { key: id, name: it.name, className: it.class_name, qty: dropped, unit: it.unit, at: ev.at });
    }
  }
  return [...out.values()].sort((a, b) => b.at.localeCompare(a.at));
}

/** One page of a list: 0-based page index clamped to the list, with the "from - to of total" numbers. */
export function pageOf<T>(list: readonly T[], page: number, size: number): { items: T[]; page: number; pages: number; from: number; to: number; total: number } {
  const n = Math.max(1, size);
  const pages = Math.max(1, Math.ceil(list.length / n));
  const p = Math.min(Math.max(0, page), pages - 1);
  const items = list.slice(p * n, p * n + n);
  return { items, page: p, pages, from: list.length ? p * n + 1 : 0, to: p * n + items.length, total: list.length };
}
