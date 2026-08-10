// Poly-entity Codex search — pure ranking + scope helpers.
// -----------------------------------------------------------------------------
// The Codex landing's "Archive Terminal" searches EVERY kind, not ships only.
// CodexService.searchAll() fans the existing pg_trgm `.or(ilike)` list query out
// across all kinds and merges the rows into PolySearchHits; this module owns the
// pure, framework-free parts (scope tint, cross-kind ranking, permalink target)
// so they can be unit-tested without a Supabase client.
//
// `import type` only — no runtime import of codex.service, so there is no import
// cycle (codex.service imports the runtime helpers below).

import type { CodexKind, CodexListRow } from './codex.service';

/**
 * Visual scope of a hit, driving the result tint:
 *   equipment (cyan)  — physical, mountable/wieldable things you use in the verse
 *                       (ships, components, weapons, items/FPS gear, ammunition).
 *   meta (violet)     — reference/meta entities (manufacturers, blueprints).
 */
export type PolyScope = 'equipment' | 'meta';

export interface PolySearchHit {
  kind: CodexKind;
  classNameSlug: string;
  nameLocalized: string | null;
  manufacturerCode: string | null;
  size: number | null;
  grade: string | null;
  scope: PolyScope;
}

/** Kinds whose tint is the "meta" (violet) scope; everything else is cyan. */
const META_KINDS: ReadonlySet<CodexKind> = new Set<CodexKind>(['manufacturer', 'blueprint']);

/** Cyan vs violet scope for a kind — pure, so the tint is testable. */
export function scopeForKind(kind: CodexKind): PolyScope {
  return META_KINDS.has(kind) ? 'meta' : 'equipment';
}

// Cross-kind tiebreak order: which kind wins when match quality is equal. Ships
// first (the flagship entity of the game), then the mountables, then meta.
const KIND_PRIORITY: readonly CodexKind[] = [
  'ship',
  'weapon',
  'component',
  'item',
  'ammunition',
  'manufacturer',
  'blueprint',
];

function kindRank(kind: CodexKind): number {
  const i = KIND_PRIORITY.indexOf(kind);
  return i === -1 ? KIND_PRIORITY.length : i;
}

/**
 * The router link for a hit. Blueprints have their own detail route
 * (`/codex/blueprint/:className`); every other kind uses the generic
 * `/codex/:kind/:className` detail. Returned as a routerLink array.
 */
export function polyHitLink(hit: Pick<PolySearchHit, 'kind' | 'classNameSlug'>): string[] {
  if (hit.kind === 'blueprint') return ['/codex', 'blueprint', hit.classNameSlug];
  return ['/codex', hit.kind, hit.classNameSlug];
}

/** Map a generic list row + its kind to a scope-tagged poly hit. */
export function toPolyHit(kind: CodexKind, row: CodexListRow): PolySearchHit {
  return {
    kind,
    classNameSlug: row.classNameSlug,
    nameLocalized: row.nameLocalized,
    manufacturerCode: row.manufacturerCode,
    size: row.size,
    grade: row.grade,
    scope: scopeForKind(kind),
  };
}

/**
 * Match-quality score for one hit against the query. Higher = better.
 *   4 exact (name or className equals the query)
 *   3 prefix (name or className starts with the query)
 *   2 substring (name or className contains the query)
 *   1 no textual hit (still returned by the trigram query — fuzzy match)
 */
export function polyMatchScore(query: string, hit: PolySearchHit): number {
  const q = query.trim().toLowerCase();
  if (!q) return 1;
  const fields = [hit.nameLocalized, hit.classNameSlug]
    .filter((f): f is string => !!f)
    .map((f) => f.toLowerCase());
  let best = 1;
  for (const f of fields) {
    if (f === q) return 4; // exact can't be beaten — short-circuit
    if (f.startsWith(q)) best = Math.max(best, 3);
    else if (f.includes(q)) best = Math.max(best, 2);
  }
  return best;
}

/**
 * Rank cross-kind hits: match quality desc, then kind priority, then localized
 * name (className as the fallback). Pure + stable — the whole point is a
 * deterministic merge the component can render without re-sorting.
 */
export function rankPolyHits(query: string, hits: PolySearchHit[]): PolySearchHit[] {
  return [...hits].sort((a, b) => {
    const sa = polyMatchScore(query, a);
    const sb = polyMatchScore(query, b);
    if (sa !== sb) return sb - sa;
    const ka = kindRank(a.kind);
    const kb = kindRank(b.kind);
    if (ka !== kb) return ka - kb;
    const na = (a.nameLocalized ?? a.classNameSlug).toLowerCase();
    const nb = (b.nameLocalized ?? b.classNameSlug).toLowerCase();
    return na.localeCompare(nb);
  });
}
