// "Zuletzt geöffnet" for the empty field (concept 2026-11-02, A6 + C9).
// -----------------------------------------------------------------------------
// The engine's signal store keeps kind + class only (ranking); the empty field
// needs a row it can draw without a request, so the bar keeps the opened rows
// themselves, local only (never sent anywhere). Pure; storage is passed in.

import type { SearchResultRow } from '../../codex/search/search-result-model';

export const RECENT_ROWS_KEY = 'sc.search.recentRows';
/** Rows kept (the empty search field shows three; the Schnellzugriff cuts them by page type and shows up to seven). */
export const RECENT_ROWS_MAX = 12;
export const RECENT_ROWS_SHOWN = 3;

/** A stored row: hit or own data, without the context-dependent CTA and icons. */
export type StoredRow =
  | Omit<Extract<SearchResultRow, { type: 'hit' }>, 'cta' | 'icons'>
  | Omit<Extract<SearchResultRow, { type: 'own' }>, 'cta' | 'icons'>;

const fold = (v: string) => v.toLowerCase().replace(/[^a-z0-9]/g, '');

/**
 * What a row opens, for the "same thing twice" check: a ship found in the catalog (`hit-ship-<class>`) and the same
 * ship from the Hangar (`own-ship-<id>`) are one entry in "Zuletzt geöffnet". Own data without a catalog class
 * (a loadout, a set) is its own thing and keys on its id.
 */
export function recentRowKey(r: StoredRow): string {
  if (r.type === 'hit') return `${r.hit.kind}:${fold(r.hit.classNameSlug)}`;
  if (r.ownKind === 'ship' && r.classNameSlug) return `ship:${fold(r.classNameSlug)}`;
  return r.id;
}

/** The list without a second row for the same class; the first (newest) one stays. */
export function dedupeRecentRows<T extends StoredRow>(list: readonly T[]): T[] {
  const seen = new Set<string>();
  return list.filter((r) => {
    const k = recentRowKey(r);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

export function readRecentRows(storage: Storage | null): StoredRow[] {
  try {
    const raw = storage?.getItem(RECENT_ROWS_KEY);
    const list = raw ? (JSON.parse(raw) as unknown) : [];
    if (!Array.isArray(list)) return [];
    return dedupeRecentRows(
      list.filter((r): r is StoredRow => !!r && typeof r === 'object' && (r.type === 'hit' || r.type === 'own') && !!r.id && !!r.target),
    ).slice(0, RECENT_ROWS_MAX);
  } catch {
    return [];
  }
}

/** Put a row first (deduplicated by id), keep {@link RECENT_ROWS_MAX}. Patch / gallery rows are not kept. */
export function pushRecentRow(storage: Storage | null, list: readonly StoredRow[], row: SearchResultRow): StoredRow[] {
  if (row.type !== 'hit' && row.type !== 'own') return [...list];
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { cta, icons, ...rest } = row;
  const stored = (row.type === 'hit' ? { ...rest, outside: false, fit: null } : rest) as StoredRow;
  return rememberRow(storage, list, stored);
}

/** Put an already-stored row first and write the list; the page the reader opened writes the same shape the search does. */
export function rememberRow(storage: Storage | null, list: readonly StoredRow[], stored: StoredRow): StoredRow[] {
  const key = recentRowKey(stored);
  const next = [stored, ...list.filter((r) => r.id !== stored.id && recentRowKey(r) !== key)].slice(0, RECENT_ROWS_MAX);
  try {
    storage?.setItem(RECENT_ROWS_KEY, JSON.stringify(next));
  } catch {
    /* private mode: kept for this session only */
  }
  return next;
}
