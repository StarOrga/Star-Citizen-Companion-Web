import { normalizeSearch } from '../../codex/codex-search';
import { HQ_STOCK_STALE_DAYS } from '../data/hq-inventory.service';

/** The fields of an inventory row the stock page and popup read. */
export interface StockItem {
  location: string;
  name: string;
  class_name: string | null;
  qty: number;
  unit: 'pcs' | 'scu';
}

/** A place with the age of its snapshot. */
export interface StockPlace {
  location: string;
  takenAt: string;
}

/**
 * Category of a row, from the row alone. The reach is narrow on purpose: a row has a name, an
 * optional class name, a quantity and a unit, and nothing else.
 *  - `materials`: unit SCU (raw material and cargo are counted in SCU, pieces never are).
 *  - `weapons` / `armor`: only a piece whose class name carries a known token (`_Rifle`, `_Pistol`,
 *    `_Helmet`, `_Undersuit`, `_Core` …). Manual entries have no class name.
 *  - `other`: everything else, an honest bucket, not a guess. A piece without a class name is always here.
 */
export type StockCategory = 'materials' | 'weapons' | 'armor' | 'other';
export const STOCK_CATEGORIES: readonly StockCategory[] = ['materials', 'weapons', 'armor', 'other'];

const WEAPON_TOKENS = /(^|_)(pistol|rifle|smg|shotgun|sniper|lmg|launcher|gadget|knife|multitool|grenade|lasercannon|laserrepeater|ballisticcannon|ballisticgatling|missile)(_|\d|$)/i;
const ARMOR_TOKENS = /(^|_)(helmet|undersuit|armor|armour|core|arms|legs|backpack|torso)(_|\d|$)/i;

export function categoryOf(r: Pick<StockItem, 'class_name' | 'unit'>): StockCategory {
  if (r.unit === 'scu') return 'materials';
  const c = r.class_name ?? '';
  if (!c) return 'other';
  if (ARMOR_TOKENS.test(c)) return 'armor';
  if (WEAPON_TOKENS.test(c)) return 'weapons';
  return 'other';
}

export function isPlaceFree(location: string): boolean {
  return !location.trim();
}

export function isStale(takenAt: string, now: number = Date.now()): boolean {
  const t = Date.parse(takenAt);
  return Number.isFinite(t) && now - t >= HQ_STOCK_STALE_DAYS * 86_400_000;
}

export interface PlaceCount {
  location: string;
  count: number;
}

export interface StockOverview {
  items: number;
  places: number;
  /** The largest places by item count. */
  top: PlaceCount[];
  /** Items without a place. */
  free: number;
  /** Places whose stand is older than the stale limit, oldest first. */
  stale: StockPlace[];
  cats: { cat: StockCategory; count: number }[];
}

export function buildOverview(
  rows: readonly StockItem[],
  places: readonly StockPlace[],
  topN = 5,
  now: number = Date.now(),
): StockOverview {
  const counts = new Map<string, number>();
  let free = 0;
  for (const r of rows) {
    if (isPlaceFree(r.location)) free++;
    else counts.set(r.location, (counts.get(r.location) ?? 0) + 1);
  }
  const top = [...counts.entries()]
    .map(([location, count]) => ({ location, count }))
    .sort((a, b) => b.count - a.count || a.location.localeCompare(b.location))
    .slice(0, topN);
  const stale = places.filter((p) => isStale(p.takenAt, now)).sort((a, b) => a.takenAt.localeCompare(b.takenAt));
  const cats = STOCK_CATEGORIES.map((cat) => ({ cat, count: rows.filter((r) => categoryOf(r) === cat).length })).filter(
    (c) => c.count > 0,
  );
  return { items: rows.length, places: new Set(places.map((p) => p.location)).size || counts.size, top, free, stale, cats };
}

export type StockView = 'place' | 'name' | 'qty';

/** What the popup's filter chips and search box select. `place: ''` is the place-free group. */
export interface StockFilter {
  q: string;
  place: string | null;
  cat: StockCategory | null;
  stale: boolean;
}

export const NO_FILTER: StockFilter = { q: '', place: null, cat: null, stale: false };

export function filterStock(
  rows: readonly StockItem[],
  f: StockFilter,
  places: readonly StockPlace[],
  now: number = Date.now(),
): StockItem[] {
  const q = normalizeSearch(f.q.trim());
  const staleSet = f.stale ? new Set(places.filter((p) => isStale(p.takenAt, now)).map((p) => p.location)) : null;
  return rows.filter(
    (r) =>
      r.qty > 0 &&
      (f.place === null || r.location === f.place) &&
      (f.cat === null || categoryOf(r) === f.cat) &&
      (!staleSet || staleSet.has(r.location)) &&
      (!q || normalizeSearch(r.name).includes(q) || normalizeSearch(r.location).includes(q)),
  );
}

/** One line of the popup list; headers and rows share one flat list so rendering can be windowed. */
export type StockLine =
  | { kind: 'head'; key: string; title: string; count: number; location: string | null; free: boolean }
  | { kind: 'row'; key: string; row: StockItem; showPlace: boolean; showName: boolean };

/** Flat, ordered lines for a view. Place view: groups by place (place-free last); name view: one group per item name; qty view: rows by amount. */
export function stockLines(rows: readonly StockItem[], view: StockView): StockLine[] {
  const out: StockLine[] = [];
  const rowKey = (r: StockItem) => `${r.location}\u0000${r.name}`;
  if (view === 'qty') {
    for (const r of [...rows].sort((a, b) => b.qty - a.qty || a.name.localeCompare(b.name) || a.location.localeCompare(b.location))) {
      out.push({ kind: 'row', key: rowKey(r), row: r, showPlace: true, showName: true });
    }
    return out;
  }
  const by = new Map<string, StockItem[]>();
  for (const r of rows) {
    const k = view === 'place' ? r.location : `${r.name}\u0000${r.unit}`;
    by.set(k, [...(by.get(k) ?? []), r]);
  }
  const keys = [...by.keys()].sort((a, b) => {
    if (view === 'place') {
      // the place-free group ('') always last
      if (!a.trim() !== !b.trim()) return a.trim() ? -1 : 1;
      return a.localeCompare(b);
    }
    return a.localeCompare(b);
  });
  for (const k of keys) {
    const own = by.get(k) ?? [];
    own.sort((a, b) => (view === 'place' ? a.name.localeCompare(b.name) : b.qty - a.qty || a.location.localeCompare(b.location)));
    const first = own[0];
    out.push({
      kind: 'head',
      key: `h${k}`,
      title: view === 'place' ? k : first.name,
      count: own.length,
      location: view === 'place' ? k : null,
      free: view === 'place' && isPlaceFree(k),
    });
    for (const r of own) out.push({ kind: 'row', key: rowKey(r), row: r, showPlace: view === 'name', showName: view === 'place' });
  }
  return out;
}

/** Rows rendered per step while the list is scrolled (render windowing: all rows are in memory, the DOM grows on demand). */
export const STOCK_PAGE = 60;

export function nextWindow(shown: number, total: number, step = STOCK_PAGE): number {
  return Math.min(total, shown + step);
}
