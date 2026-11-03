// "Zuletzt geöffnet" for the empty field (concept 2026-11-02, A6 + C9).
// -----------------------------------------------------------------------------
// The engine's signal store keeps kind + class only (ranking); the empty field
// needs a row it can draw without a request, so the bar keeps the opened rows
// themselves, local only (never sent anywhere). Pure; storage is passed in.

import type { SearchResultRow } from '../../codex/search/search-result-model';

export const RECENT_ROWS_KEY = 'sc.search.recentRows';
/** Rows kept; the empty field shows three. */
export const RECENT_ROWS_MAX = 6;
export const RECENT_ROWS_SHOWN = 3;

/** A stored row: hit or own data, without the context-dependent CTA and icons. */
export type StoredRow =
  | Omit<Extract<SearchResultRow, { type: 'hit' }>, 'cta' | 'icons'>
  | Omit<Extract<SearchResultRow, { type: 'own' }>, 'cta' | 'icons'>;

export function readRecentRows(storage: Storage | null): StoredRow[] {
  try {
    const raw = storage?.getItem(RECENT_ROWS_KEY);
    const list = raw ? (JSON.parse(raw) as unknown) : [];
    if (!Array.isArray(list)) return [];
    return list
      .filter((r): r is StoredRow => !!r && typeof r === 'object' && (r.type === 'hit' || r.type === 'own') && !!r.id && !!r.target)
      .slice(0, RECENT_ROWS_MAX);
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
  const next = [stored, ...list.filter((r) => r.id !== row.id)].slice(0, RECENT_ROWS_MAX);
  try {
    storage?.setItem(RECENT_ROWS_KEY, JSON.stringify(next));
  } catch {
    /* private mode: kept for this session only */
  }
  return next;
}
