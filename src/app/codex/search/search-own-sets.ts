// "gemerkt" / "fehlt mir" as a LIST (concept gegenstand-weg A10).
// -----------------------------------------------------------------------------
// The two words are filters over the reader's own sets, not over whatever the catalog returned
// for a term: a catalog search is capped per kind, so "fehlt mir rakete" could miss a line that
// the cap cut off, and the word alone had nothing to filter at all. The set itself is the
// candidate pool here; the term only narrows it. Pure and framework-free.

import { PolyHitKind, PolySearchHit, UPCOMING_HIT_KIND, scopeForKind } from '../codex-poly-search';
import { humanizeClassName } from '../codex-format';
import { searchMatcher } from '../codex-search';
import { CodexSearchGroup } from './codex-search-model';
import type { SearchChip } from './search-result-model';

/** One entry of a set: what the reader wished, or what is open in Nachschub. */
export interface OwnSetEntry {
  kind: string;
  className: string;
  /** The reader-facing name when known; null falls back to the readable class name. */
  name: string | null;
  manufacturerCode?: string | null;
}

const KINDS: ReadonlySet<string> = new Set([
  'ship', 'weapon', 'component', 'item', 'blueprint', 'ammunition', 'manufacturer', UPCOMING_HIT_KIND,
]);

/** Which own set the chips ask for, if any. Wished wins when both are present. */
export function ownSetOf(chips: readonly SearchChip[]): 'wished' | 'needed' | null {
  if (chips.some((c) => c.filter.wished)) return 'wished';
  if (chips.some((c) => c.filter.needed)) return 'needed';
  return null;
}

/** An entry as the poly hit every result row is built from. */
export function entryHit(e: OwnSetEntry, nameOf?: (kind: string, className: string) => string | null): PolySearchHit {
  const kind = (KINDS.has(e.kind) ? e.kind : 'item') as PolyHitKind;
  return {
    kind,
    classNameSlug: e.className,
    nameLocalized: e.name || nameOf?.(e.kind, e.className) || humanizeClassName(e.className),
    manufacturerCode: e.manufacturerCode ?? null,
    manufacturerName: null,
    size: null,
    grade: null,
    scope: scopeForKind(kind),
  };
}

/**
 * The entries of a set as result groups (one per kind), narrowed by the term. An entry counts once
 * per class; an empty term keeps the whole set.
 */
export function ownSetGroups(
  entries: readonly OwnSetEntry[],
  term: string,
  nameOf?: (kind: string, className: string) => string | null,
): CodexSearchGroup[] {
  const match = searchMatcher(term);
  const seen = new Set<string>();
  const byKind = new Map<PolyHitKind, PolySearchHit[]>();
  for (const e of entries) {
    const key = `${e.kind}|${e.className.toLowerCase()}`;
    if (!e.className || seen.has(key)) continue;
    seen.add(key);
    const hit = entryHit(e, nameOf);
    if (match && !match(hit.nameLocalized, hit.classNameSlug)) continue;
    const list = byKind.get(hit.kind) ?? [];
    list.push(hit);
    byKind.set(hit.kind, list);
  }
  return [...byKind].map(([kind, hits]) => ({
    kind,
    hits,
    total: hits.length,
    count: hits.length,
    countIsFloor: false,
    folded: 0,
    foldedIsFloor: false,
    more: null,
  }));
}
