// The Codex search — pure, framework-free parts.
// -----------------------------------------------------------------------------
// ONE Codex search runs behind Ctrl+K, the Codex landing terminal and the
// Codex search bar on every Codex page (CodexSearchEngine). This module owns
// what can be tested without Angular: grouping the ranked hits by kind, the
// "all N in the index" targets, display names and the recent-search store.

import type { Lang, LocalizedText } from '../codex.types';
import { cleanLocaleValue, humanizeClassName } from '../codex-format';
import {
  KIND_PRIORITY,
  PolyHitKind,
  PolySearchHit,
  UPCOMING_HIT_KIND,
  isUpcomingHit,
  polyHitLink,
  polyHitQueryParams,
} from '../codex-poly-search';
import { normalizeSearch } from '../codex-search';

/** A route target: a routerLink array plus its query params. */
export interface SearchTarget {
  link: string[];
  queryParams: Record<string, string> | null;
}

/** One kind's slice of a search. */
export interface CodexSearchGroup {
  kind: PolyHitKind;
  /** The best hits of this kind, at most the cap. */
  hits: PolySearchHit[];
  /** Every record of this kind that matched — at least `hits.length`. */
  total: number;
  /** "All N in the index" — only when the index holds more than shown. */
  more: SearchTarget | null;
}

/**
 * One entry of the result listbox. Hits, "all N" links, recent searches,
 * category shortcuts and the patch's new ships all share the arrow keys, so
 * they share one shape.
 */
export type SearchOption =
  | { type: 'hit'; id: string; hit: PolySearchHit; target: SearchTarget }
  | { type: 'more'; id: string; kind: PolyHitKind; total: number; target: SearchTarget }
  | { type: 'recent'; id: string; term: string; target: SearchTarget }
  | { type: 'category'; id: string; labelKey: string; target: SearchTarget }
  | { type: 'fresh'; id: string; hit: PolySearchHit; target: SearchTarget };

/** Recent searches kept in localStorage, newest first. */
export const RECENT_SEARCHES_KEY = 'sc.codex.recentSearches';
export const RECENT_SEARCHES_MAX = 8;

/**
 * The category shortcuts an empty search field offers. Real routes, so each
 * one is an anchor (middle click opens it in a new tab).
 */
export const SEARCH_CATEGORY_SHORTCUTS: readonly { labelKey: string; target: SearchTarget }[] = [
  { labelKey: 'codex.search.bar.category.ships', target: { link: ['/codex/index'], queryParams: { kind: 'ship' } } },
  { labelKey: 'codex.search.bar.category.components', target: { link: ['/codex/index'], queryParams: { kind: 'component' } } },
  {
    labelKey: 'codex.search.bar.category.shipWeapons',
    target: { link: ['/codex/index'], queryParams: { kind: 'weapon', weaponClass: 'Ship' } },
  },
  { labelKey: 'codex.search.bar.category.fps', target: { link: ['/codex/fps'], queryParams: null } },
  { labelKey: 'codex.search.bar.category.upcoming', target: { link: ['/codex/upcoming'], queryParams: null } },
  { labelKey: 'codex.search.bar.category.keybinds', target: { link: ['/codex/keybinds'], queryParams: null } },
];

/** Where a hit opens. */
export function hitTarget(hit: PolySearchHit): SearchTarget {
  return { link: polyHitLink(hit), queryParams: polyHitQueryParams(hit) };
}

/**
 * "All N in the index" for one kind and term. Announced ships live in their
 * own grid (`/codex/upcoming`), every datamined kind in the index.
 */
export function indexTarget(kind: PolyHitKind, term: string): SearchTarget {
  const q = term.trim();
  if (kind === UPCOMING_HIT_KIND) return { link: ['/codex/upcoming'], queryParams: q ? { q } : null };
  return { link: ['/codex/index'], queryParams: q ? { kind, q } : { kind } };
}

/** Group ranked hits by kind in KIND_PRIORITY order, at most `cap` per group. */
export function groupHits(
  term: string,
  hits: readonly PolySearchHit[],
  totals: Partial<Record<PolyHitKind, number>>,
  cap: number,
): CodexSearchGroup[] {
  const byKind = new Map<PolyHitKind, PolySearchHit[]>();
  for (const h of hits) {
    const list = byKind.get(h.kind) ?? [];
    list.push(h);
    byKind.set(h.kind, list);
  }
  const order = [...KIND_PRIORITY, ...[...byKind.keys()].filter((k) => !KIND_PRIORITY.includes(k))];
  const groups: CodexSearchGroup[] = [];
  for (const kind of order) {
    const all = byKind.get(kind);
    if (!all?.length) continue;
    const shown = all.slice(0, Math.max(1, cap));
    const total = Math.max(totals[kind] ?? all.length, all.length);
    groups.push({ kind, hits: shown, total, more: total > shown.length ? indexTarget(kind, term) : null });
  }
  return groups;
}

/** The listbox options of a grouped result, in reading order. */
export function resultOptions(groups: readonly CodexSearchGroup[]): SearchOption[] {
  const out: SearchOption[] = [];
  for (const g of groups) {
    g.hits.forEach((hit, i) =>
      out.push({ type: 'hit', id: `${g.kind}-${i}`, hit, target: hitTarget(hit) }),
    );
    if (g.more) out.push({ type: 'more', id: `${g.kind}-more`, kind: g.kind, total: g.total, target: g.more });
  }
  return out;
}

/** The listbox options of an empty field: recent searches, new ships, categories. */
export function suggestionOptions(recent: readonly string[], fresh: readonly PolySearchHit[]): SearchOption[] {
  const out: SearchOption[] = [];
  recent.forEach((term, i) =>
    out.push({ type: 'recent', id: `recent-${i}`, term, target: { link: ['/codex'], queryParams: { q: term } } }),
  );
  fresh.forEach((hit, i) => out.push({ type: 'fresh', id: `fresh-${i}`, hit, target: hitTarget(hit) }));
  SEARCH_CATEGORY_SHORTCUTS.forEach((c, i) =>
    out.push({ type: 'category', id: `cat-${i}`, labelKey: c.labelKey, target: c.target }),
  );
  return out;
}

/** A target as a URL string — for Ctrl+Enter (new tab) and plain hrefs. */
export function targetUrl(t: SearchTarget): string {
  const path = t.link.join('/').replace(/\/{2,}/g, '/');
  const qs = t.queryParams ? new URLSearchParams(t.queryParams).toString() : '';
  return qs ? `${path}?${qs}` : path;
}

/**
 * The hit's title in the app language: the payload's `{ de, en }` name, then
 * the English column, then the humanised class name — never the raw class
 * name ("AEGS_Gladius_Thruster_Main").
 */
export function hitTitle(hit: PolySearchHit, lang: Lang): string {
  const own = hit.name ? cleanLocaleValue(pick(hit.name, lang)) : '';
  return own || cleanLocaleValue(hit.nameLocalized) || humanizeClassName(hit.classNameSlug);
}

/** The manufacturer spelled out, its code as the honest fallback. */
export function hitManufacturer(hit: PolySearchHit, lang: Lang): string | null {
  return (hit.manufacturerName ? pick(hit.manufacturerName, lang) : '') || hit.manufacturerCode || null;
}

/** Liveries are items of attach type `Paints`. */
export function isLivery(hit: PolySearchHit): boolean {
  return (hit.attachType ?? '').toLowerCase() === 'paints';
}

/** The compare-tray kind of a hit, or null — announced ships have no stats. */
export function pinKindOf(hit: PolySearchHit): Exclude<PolyHitKind, typeof UPCOMING_HIT_KIND> | null {
  return isUpcomingHit(hit) ? null : (hit.kind as Exclude<PolyHitKind, typeof UPCOMING_HIT_KIND>);
}

function pick(t: LocalizedText, lang: Lang): string {
  return (lang === 'de' ? t.de || t.en : t.en || t.de) ?? '';
}

/** Read the recent searches; any storage failure reads as "none". */
export function readRecentSearches(storage: Storage | null): string[] {
  try {
    const raw = storage?.getItem(RECENT_SEARCHES_KEY);
    const list = raw ? (JSON.parse(raw) as unknown) : [];
    return Array.isArray(list)
      ? list.filter((t): t is string => typeof t === 'string' && !!t.trim()).slice(0, RECENT_SEARCHES_MAX)
      : [];
  } catch {
    return [];
  }
}

/** Put `term` first (case/diacritics-insensitive dedupe), cap, persist best-effort. */
export function pushRecentSearch(storage: Storage | null, list: readonly string[], term: string): string[] {
  const t = term.trim();
  if (!t) return [...list];
  const key = normalizeSearch(t);
  const next = [t, ...list.filter((x) => normalizeSearch(x) !== key)].slice(0, RECENT_SEARCHES_MAX);
  try {
    storage?.setItem(RECENT_SEARCHES_KEY, JSON.stringify(next));
  } catch {
    /* private mode / quota: the list still holds for this session */
  }
  return next;
}

/** Forget every recent search. */
export function clearRecentSearches(storage: Storage | null): void {
  try {
    storage?.removeItem(RECENT_SEARCHES_KEY);
  } catch {
    /* nothing to do */
  }
}
