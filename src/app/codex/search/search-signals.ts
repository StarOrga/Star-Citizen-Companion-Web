// Ranking signals of the search (line C9) — pure parts.
// -----------------------------------------------------------------------------
// Three signals break ties between hits whose NAME matches equally well; they
// never lift a weaker name match over a better one:
//   1. recently opened by this reader (localStorage, newest first, cap 50),
//   2. ownership (light, on every page),
//   3. what others open often (server count, `search_popularity`).

import { normalizeSearch } from '../codex-search';

export const RECENT_OPENED_KEY = 'sc.search.recentOpened';
export const RECENT_OPENED_MAX = 50;

export interface OpenedRef {
  kind: string;
  className: string;
}

const refKey = (kind: string, className: string): string => `${kind}|${className.trim().toLowerCase()}`;

/** Read the recently opened entities (newest first); any storage failure reads as "none". */
export function readRecentOpened(storage: Storage | null): OpenedRef[] {
  try {
    const raw = storage?.getItem(RECENT_OPENED_KEY);
    const list = raw ? (JSON.parse(raw) as unknown) : [];
    if (!Array.isArray(list)) return [];
    return list
      .filter((r): r is OpenedRef => !!r && typeof r.kind === 'string' && typeof r.className === 'string')
      .slice(0, RECENT_OPENED_MAX);
  } catch {
    return [];
  }
}

/** Put the entity first (deduped), cap at 50, persist best-effort. */
export function pushRecentOpened(
  storage: Storage | null,
  list: readonly OpenedRef[],
  kind: string,
  className: string,
): OpenedRef[] {
  if (!kind || !className.trim()) return [...list];
  const key = refKey(kind, className);
  const next = [{ kind, className }, ...list.filter((r) => refKey(r.kind, r.className) !== key)].slice(0, RECENT_OPENED_MAX);
  try {
    storage?.setItem(RECENT_OPENED_KEY, JSON.stringify(next));
  } catch {
    /* private mode / quota: the list still holds for this session */
  }
  return next;
}

/** Position in the recent list (0 = newest), or -1. */
export function recentRank(list: readonly OpenedRef[], kind: string, className: string): number {
  const key = refKey(kind, className);
  return list.findIndex((r) => refKey(r.kind, r.className) === key);
}

/** The server popularity rows as a lookup. */
export function popularityMap(rows: readonly { entity_kind: string; class_name: string; hits: number }[] | null | undefined): Map<string, number> {
  const m = new Map<string, number>();
  for (const r of rows ?? []) {
    if (r && typeof r.entity_kind === 'string' && typeof r.class_name === 'string') {
      m.set(refKey(r.entity_kind, r.class_name), Number(r.hits) || 0);
    }
  }
  return m;
}

export function popularityOf(map: ReadonlyMap<string, number>, kind: string, className: string): number {
  return map.get(refKey(kind, className)) ?? 0;
}

/** The signals the composer reads — injectable so the composition stays pure. */
export interface RankSignals {
  recentRank(kind: string, className: string): number;
  owns(className: string): boolean;
  popularity(kind: string, className: string): number;
}

export const NO_SIGNALS: RankSignals = { recentRank: () => -1, owns: () => false, popularity: () => 0 };

/**
 * Sort key among equal name matches: recent first (newest first), then owned,
 * then the more often opened. Lower sorts first.
 */
export function signalOrder(s: RankSignals, kind: string, className: string): [number, number, number] {
  const r = s.recentRank(kind, className);
  return [r === -1 ? RECENT_OPENED_MAX : r, s.owns(className) ? 0 : 1, -s.popularity(kind, className)];
}

/** A normalized term for the miss log: one entry per spelling-insensitive term. */
export function missKey(term: string): string {
  return normalizeSearch(term).replace(/\*/g, '');
}
