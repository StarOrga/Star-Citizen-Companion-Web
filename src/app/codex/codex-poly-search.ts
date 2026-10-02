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

import type { CodexKind, CodexListRow, LocalizedText } from './codex.service';
import type { UpcomingShip } from './upcoming-ships.service';
import { normalizeSearch, recordScore } from './codex-search';

/**
 * Pseudo-kind for a ship RSI has ANNOUNCED but that the datamined game data
 * has no row for (the `rsi-upcoming-ships` diff). Deliberately NOT a member of
 * `CodexKind`: there is no `codex_upcoming` table, no detail route and no
 * `LIST_SELECT` entry, and widening CodexKind would silently punch holes in
 * every exhaustive `Record<CodexKind, …>` in the service.
 *
 * It exists here because the Archive Terminal is the one place a reader types
 * a ship name and expects an answer — "Arrastra" returning nothing while the
 * app demonstrably knows the ship (admin feedback 7b91c5ae) is a search-coverage
 * bug, not missing data.
 */
export const UPCOMING_HIT_KIND = 'upcoming';

/** What a poly hit can be: any datamined kind, plus the announced-ship marker. */
export type PolyHitKind = CodexKind | typeof UPCOMING_HIT_KIND;

/**
 * Visual scope of a hit, driving the result tint:
 *   equipment (cyan)  — physical, mountable/wieldable things you use in the verse
 *                       (ships, components, weapons, items/FPS gear, ammunition).
 *   meta (violet)     — reference/meta entities (manufacturers, blueprints).
 *   upcoming (amber)  — announced, not in the build: nothing to spec out yet.
 */
export type PolyScope = 'equipment' | 'meta' | 'upcoming';

export interface PolySearchHit {
  kind: PolyHitKind;
  classNameSlug: string;
  nameLocalized: string | null;
  manufacturerCode: string | null;
  /**
   * The manufacturer's full name straight from the row payload (extracted game
   * data), kept unresolved so the reader can pick the app language. Null when
   * the row carries no manufacturer record — `manufacturerCode` is then the
   * only thing we honestly know. See `manufacturerLabel` in codex.service.
   */
  manufacturerName: LocalizedText | null;
  size: number | null;
  grade: string | null;
  scope: PolyScope;
}

/** Kinds whose tint is the "meta" (violet) scope; everything else is cyan. */
const META_KINDS: ReadonlySet<PolyHitKind> = new Set<PolyHitKind>(['manufacturer', 'blueprint']);

/** Cyan vs violet vs amber scope for a kind — pure, so the tint is testable. */
export function scopeForKind(kind: PolyHitKind): PolyScope {
  if (kind === UPCOMING_HIT_KIND) return 'upcoming';
  return META_KINDS.has(kind) ? 'meta' : 'equipment';
}

// Cross-kind tiebreak order: which kind wins when match quality is equal. Ships
// first (the flagship entity of the game), then the mountables, then meta, and
// announced ships LAST — when a query matches both a hull you can fly today and
// one that only exists on a concept page, the flyable one leads. A stronger
// textual match still wins outright (that is what surfaces "Arrastra" first:
// nothing in the build matches it exactly).
const KIND_PRIORITY: readonly PolyHitKind[] = [
  'ship',
  'weapon',
  'component',
  'item',
  'ammunition',
  'manufacturer',
  'blueprint',
  UPCOMING_HIT_KIND,
];

function kindRank(kind: PolyHitKind): number {
  const i = KIND_PRIORITY.indexOf(kind);
  return i === -1 ? KIND_PRIORITY.length : i;
}

/** True for hits that come from the RSI announcement feed, not the build. */
export function isUpcomingHit(hit: Pick<PolySearchHit, 'kind'>): boolean {
  return hit.kind === UPCOMING_HIT_KIND;
}

/**
 * The category icon to draw for a hit. Announced ships have no icon of their
 * own — they ARE ships, so they borrow the ship glyph; the amber tint and the
 * "announced" badge carry the distinction.
 */
export function polyHitIconKind(hit: Pick<PolySearchHit, 'kind'>): CodexKind {
  return hit.kind === UPCOMING_HIT_KIND ? 'ship' : (hit.kind as CodexKind);
}

/**
 * The router link for a hit. Blueprints have their own detail route
 * (`/codex/blueprint/:className`); every other kind uses the generic
 * `/codex/:kind/:className` detail. Returned as a routerLink array.
 */
export function polyHitLink(hit: Pick<PolySearchHit, 'kind' | 'classNameSlug'>): string[] {
  if (hit.kind === 'blueprint') return ['/codex', 'blueprint', hit.classNameSlug];
  // Announced ships have no detail page — the honest destination is the
  // upcoming CATEGORY of the Codex index, which is where the card lives.
  if (hit.kind === UPCOMING_HIT_KIND) return ['/codex', 'upcoming'];
  return ['/codex', hit.kind, hit.classNameSlug];
}

/**
 * Router query params for a hit, or `null` when it needs none.
 *
 * `/codex/upcoming` renders ~60 cards, so landing there without a filter is
 * barely better than the empty result it replaced. `?q=<name>` seeds the
 * upcoming grid's own search box, so the reader arrives on the one card they
 * asked for — and can clear the box to browse the rest.
 */
export function polyHitQueryParams(
  hit: Pick<PolySearchHit, 'kind' | 'nameLocalized' | 'classNameSlug'>,
): Record<string, string> | null {
  if (hit.kind !== UPCOMING_HIT_KIND) return null;
  const q = (hit.nameLocalized ?? '').trim();
  return q ? { q } : null;
}

/**
 * Map an announced RSI ship to a poly hit.
 *
 * `classNameSlug` carries the feed's ship id — it is only ever a track key and
 * a fallback label here (the link ignores it), and the id is the one field the
 * feed guarantees to be unique. The manufacturer arrives as a single RSI string
 * with no localization, so it is mirrored into both language slots rather than
 * pretending a translation exists.
 */
export function toUpcomingHit(
  ship: Pick<UpcomingShip, 'id' | 'name' | 'manufacturer' | 'manufacturerCode'>,
): PolySearchHit {
  const mfr = ship.manufacturer?.trim() || '';
  return {
    kind: UPCOMING_HIT_KIND,
    classNameSlug: ship.id,
    nameLocalized: ship.name,
    manufacturerCode: ship.manufacturerCode,
    manufacturerName: mfr ? { de: mfr, en: mfr, key: '' } : null,
    size: null,
    grade: null,
    scope: 'upcoming',
  };
}

/** Map a generic list row + its kind to a scope-tagged poly hit. */
export function toPolyHit(kind: CodexKind, row: CodexListRow): PolySearchHit {
  return {
    kind,
    classNameSlug: row.classNameSlug,
    nameLocalized: row.nameLocalized,
    manufacturerCode: row.manufacturerCode,
    manufacturerName:
      (row.payload as { manufacturer?: { name?: LocalizedText } } | undefined)?.manufacturer
        ?.name ?? null,
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
  if (!query.trim()) return 1;
  // For announced ships the slug is an opaque feed id, not a class name — never
  // score against it, or a short query could "substring match" a random id.
  const ids = isUpcomingHit(hit) ? [] : [hit.classNameSlug];
  // Shared Codex dialect (codex-search): case, diacritics and separators never
  // matter, so "p4ar" scores the "P4-AR" exact match like "p4-ar" does. A ship
  // is named "<Maker> <Model>": "gladius" is an EXACT answer to "Aegis
  // Gladius", not a word match that six "Gladius … Livery" prefixes outrank
  // (Codex UX audit L02).
  const maker = hit.manufacturerName?.en ?? hit.manufacturerName?.de ?? null;
  const s = recordScore(query, [hit.nameLocalized, withoutMaker(hit.nameLocalized, maker)], ids);
  return s >= 3 ? s : s >= 1 ? 2 : 1;
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
    // Equal match, same kind: the shorter name is the base record ("P4-AR
    // Rifle" before 'P4-AR "Warhawk" Rifle'), alphabetical after that.
    if (na.length !== nb.length) return na.length - nb.length;
    return na.localeCompare(nb);
  });
}

/**
 * The name without a leading manufacturer word ("Aegis Gladius" → "Gladius"),
 * or null when the name does not start with the maker's first word.
 */
export function withoutMaker(name: string | null, maker: string | null): string | null {
  if (!name || !maker) return null;
  const first = normalizeSearch(maker).split(' ')[0];
  const n = normalizeSearch(name);
  if (!first || !n.startsWith(first + ' ')) return null;
  return name.trim().slice(name.trim().indexOf(' ') + 1);
}

/**
 * Drop hits that would render as the same card twice: same kind, same
 * name (e.g. four "Cutlass Black Ship Armor" records, two "Aegis Eclipse").
 * Keeps the first — the best-ranked — of each (Codex UX audit L03).
 */
export function dedupePolyHits(hits: readonly PolySearchHit[]): PolySearchHit[] {
  const seen = new Set<string>();
  return hits.filter((h) => {
    const key = `${h.kind}|${normalizeSearch(h.nameLocalized ?? h.classNameSlug)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
