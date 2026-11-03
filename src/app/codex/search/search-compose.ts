// Composes the search result the fusion bar renders (lines A2, A3, A5, A10,
// B5-data, C1, C2, C9, C11, C12). Pure and framework-free.
// -----------------------------------------------------------------------------
// Inputs: the engine's ranked catalog groups (all kinds, NOT yet filtered), the
// reader's own data matches, patch and gallery matches, the active chips
// (route + section + parsed, minus the ones the reader removed) and the ranking
// signals. Output: SearchResult (search-result-model.ts).
//
//  - Chips FILTER: a hit that fails one is not "inside". A fast-exact hit
//    (name score >= prefix) outside the chips is kept in a dashed `outside`
//    group with a reason; the rest is only counted (`filteredOut`).
//  - The CONTEXT only ORDERS the groups (invisible) and says why in `reason`.
//    The HQ ownership chips (Bestand / Hangar / Sets, `ownFirst`) are ordering too:
//    the own group stands first, the catalog groups follow with the HQ CTAs.
//  - Every group lists up to `perGroup` rows; the UI shows the first three
//    (SEARCH_ROWS_SHOWN) on every page.
//  - Among hits with an equal name score: recently opened by the reader, then
//    owned, then often opened by others (signals) decide the order.

import {
  PolyHitKind,
  PolySearchHit,
  polyMatchScore,
} from '../codex-poly-search';
import { kindRank, type SearchContext } from '../../shell/fusion-bar/search-context';
import { CodexSearchGroup, SearchTarget, hitTarget, indexTarget } from './codex-search-model';
import { CtaRow, resolveCta, resolveIcons } from './search-cta';
import type { SearchFit } from './search-compat';
import { OwnSearchResult, ownMoreTarget } from './search-own';
import { withOptionCounts } from './search-query-parse';
import {
  NO_SIGNALS,
  RankSignals,
  signalOrder,
} from './search-signals';
import { GalleryMatch, PatchMatch, SourceResult, sourceMoreTarget } from './search-sources';
import {
  RowOwnership,
  SEARCH_ROWS_SHOWN,
  SearchChip,
  SearchGroupId,
  SearchReason,
  SearchResult,
  SearchResultGroup,
  SearchResultRow,
} from './search-result-model';

export interface ComposeInput {
  /** The searched text (without the words that became chips). */
  term: string;
  /** The engine's catalog groups, unfiltered. */
  groups: readonly CodexSearchGroup[];
  context: SearchContext;
  /** All active chips: context (route + section) and parsed ones. */
  chips: readonly SearchChip[];
  own?: OwnSearchResult | null;
  patches?: SourceResult<PatchMatch> | null;
  gallery?: SourceResult<GalleryMatch> | null;
  signals?: RankSignals;
  /** What the reader owns of a hit (for Mein Loadout / Wo gelagert?). */
  ownership?: (hit: PolySearchHit) => RowOwnership | null;
  /** The fit badge of a hit against the chip's ship (B5); null = no chip asks. */
  fit?: (hit: PolySearchHit) => SearchFit | null;
  signedIn: boolean;
  flagshipClassName?: string | null;
  didYouMean?: readonly string[];
  /** Value → count over the rows read WITHOUT size/grade chips; fills the chip menus. */
  facets?: { size: Record<string, number>; grade: Record<string, number> } | null;
}

/** The chip a hit fails, or null when it is inside every chip. */
export function failingChip(hit: PolySearchHit, chips: readonly SearchChip[]): SearchChip | null {
  for (const chip of chips) {
    const f = chip.filter;
    if (f.groups && !f.groups.includes(hit.kind)) return chip;
    if (f.size !== undefined && hit.size !== f.size) return chip;
    if (f.grade && (hit.grade ?? '').toUpperCase() !== f.grade) return chip;
  }
  return null;
}

/** True when a non-catalog group (own / patch / gallery) is allowed by the chips. */
function groupAllowed(id: SearchGroupId, chips: readonly SearchChip[]): boolean {
  return chips.every((c) => !c.filter.groups || c.filter.groups.includes(id));
}

const FAST_EXACT = 3;

export function composeSearchResult(input: ComposeInput): SearchResult {
  const { context: ctx, chips, term, signedIn } = input;
  const signals = input.signals ?? NO_SIGNALS;
  const flagship = input.flagshipClassName ?? null;
  const ownFirst = chips.some((c) => c.filter.ownFirst);
  const ownSlugs = new Set(
    (input.own?.rows ?? []).filter((r) => r.ownKind === 'ship' && r.classNameSlug).map((r) => r.classNameSlug!.toLowerCase()),
  );

  const hitRow = (hit: PolySearchHit, outside: boolean): SearchResultRow => {
    const ownership = input.ownership?.(hit) ?? null;
    const target = hitTarget(hit);
    const row: CtaRow = {
      type: 'hit', kind: hit.kind, classNameSlug: hit.classNameSlug, manufacturerCode: hit.manufacturerCode,
      ownership, target, flagshipClassName: flagship,
    };
    return {
      type: 'hit',
      id: `hit-${hit.kind}-${hit.classNameSlug}`,
      hit, target, outside, owned: ownership, fit: input.fit?.(hit) ?? null,
      signal: {
        recent: signals.recentRank(hit.kind, hit.classNameSlug) !== -1,
        owned: signals.owns(hit.classNameSlug),
        popular: signals.popularity(hit.kind, hit.classNameSlug) > 0,
      },
      cta: resolveCta(ctx, row, signedIn),
      icons: resolveIcons(row),
    };
  };

  // ── catalog groups: filter by chips, order among equals by signals ────────
  let filteredOut = 0;
  const outsideHits: { hit: PolySearchHit; chip: SearchChip; score: number }[] = [];
  const catalog: SearchResultGroup[] = [];
  for (const g of input.groups) {
    const inside: PolySearchHit[] = [];
    let dropped = 0;
    for (const hit of g.hits) {
      const chip = failingChip(hit, chips);
      const duplicateOfOwn = !chip && ownFirst && hit.kind === 'ship' && ownSlugs.has(hit.classNameSlug.toLowerCase());
      if (duplicateOfOwn) {
        dropped++;
        continue;
      }
      if (!chip) {
        inside.push(hit);
        continue;
      }
      dropped++;
      const score = polyMatchScore(term, hit);
      if (score >= FAST_EXACT) outsideHits.push({ hit, chip, score });
      else filteredOut++;
    }
    if (inside.length === 0) continue;
    const ordered = inside
      .map((hit, i) => ({ hit, i, s: polyMatchScore(term, hit), k: signalOrder(signals, hit.kind, hit.classNameSlug) }))
      .sort((a, b) => b.s - a.s || a.k[0] - b.k[0] || a.k[1] - b.k[1] || a.k[2] - b.k[2] || a.i - b.i)
      .map((x) => x.hit);
    // A group a chip trimmed on the client cannot promise the index total.
    const total = dropped === 0 ? Math.max(g.total, ordered.length) : ordered.length;
    catalog.push({
      id: g.kind,
      kind: g.kind,
      reason: null,
      rows: ordered.map((h) => hitRow(h, false)),
      total,
      count: dropped === 0 ? Math.min(total, Math.max(g.count ?? ordered.length, ordered.length)) : ordered.length,
      expandable: Math.max(0, ordered.length - SEARCH_ROWS_SHOWN),
      moreTarget: total > SEARCH_ROWS_SHOWN ? indexMoreTarget(g.kind, term, chips) : null,
      outside: false,
    });
  }
  catalog.sort((a, b) => kindRank(a.kind as PolyHitKind, ctx) - kindRank(b.kind as PolyHitKind, ctx));

  // ── own data / patches / gallery ──────────────────────────────────────────
  const own = input.own;
  let ownGroup: SearchResultGroup | null = null;
  if (own && own.rows.length && groupAllowed('own', chips)) {
    ownGroup = {
      id: 'own', kind: null, reason: null, total: own.total,
      rows: own.rows.map((r): SearchResultRow => {
        const ref = r.ownKind === 'item' ? null : (r.target.link[r.target.link.length - 1] ?? null);
        const row: CtaRow = { type: 'own', ownKind: r.ownKind, ownRefId: ref, kind: null };
        return { ...r, cta: resolveCta(ctx, row, signedIn), icons: resolveIcons(row) };
      }),
      expandable: Math.max(0, own.rows.length - SEARCH_ROWS_SHOWN),
      moreTarget: own.total > SEARCH_ROWS_SHOWN ? ownMoreTarget(own.rows, term) : null,
      outside: false,
    };
  }
  let galleryGroup: SearchResultGroup | null = null;
  const gal = input.gallery;
  if (gal && gal.rows.length && groupAllowed('gallery', chips)) {
    galleryGroup = {
      id: 'gallery', kind: null, reason: null, total: gal.total,
      rows: gal.rows.map((r): SearchResultRow => ({ ...r, cta: null, icons: resolveIcons({ type: 'gallery' }) })),
      expandable: Math.max(0, gal.rows.length - SEARCH_ROWS_SHOWN),
      moreTarget: gal.total >= SEARCH_ROWS_SHOWN ? sourceMoreTarget('gallery', term) : null,
      outside: false,
    };
  }
  let patchGroup: SearchResultGroup | null = null;
  const pat = input.patches;
  if (pat && pat.rows.length && groupAllowed('patch', chips)) {
    patchGroup = {
      id: 'patch', kind: null, reason: null, total: pat.total,
      rows: pat.rows.map((r): SearchResultRow => ({ ...r, cta: null, icons: resolveIcons({ type: 'patch' }) })),
      expandable: Math.max(0, pat.rows.length - SEARCH_ROWS_SHOWN),
      moreTarget: pat.total > SEARCH_ROWS_SHOWN ? sourceMoreTarget('patch', term) : null,
      outside: false,
    };
  }

  // ── order (invisible) ─────────────────────────────────────────────────────
  const groups: SearchResultGroup[] = [...catalog];
  const inHq = ctx.key.startsWith('hq') || ctx.ownedFirst || ownFirst;
  if (ownGroup) groups.splice(inHq ? 0 : Math.min(1, groups.length), 0, ownGroup);
  if (galleryGroup) {
    if (ctx.key === 'gallery') groups.unshift(galleryGroup);
    else groups.push(galleryGroup);
  }
  if (patchGroup) groups.splice(ctx.key === 'verse' ? Math.min(1, groups.length) : groups.length, 0, patchGroup);

  // ── reasons (A5) ──────────────────────────────────────────────────────────
  groups.forEach((g, i) => {
    g.reason = groupReason(g, i, ctx);
  });

  // ── outside the chips (A10) ───────────────────────────────────────────────
  let outside: SearchResultGroup | null = null;
  if (outsideHits.length) {
    const sorted = [...outsideHits].sort((a, b) => b.score - a.score);
    const chip = sorted[0].chip;
    outside = {
      id: 'outside', kind: null,
      reason: { key: 'search.why.outside', params: { chip: chip.labelKey, ...(chip.labelParams ?? {}) } },
      rows: sorted.slice(0, SEARCH_ROWS_SHOWN).map((o) => hitRow(o.hit, true)),
      total: sorted.length,
      expandable: 0,
      moreTarget: null,
      outside: true,
    };
  }

  // ── chip menus: counts per value ──────────────────────────────────────────
  const kindTotals: Record<string, number> = {};
  for (const g of input.groups) kindTotals[g.kind] = g.total;
  const outChips = chips.map((c) => {
    if (!c.options) return c;
    if (c.filter.size !== undefined) return input.facets ? withOptionCounts(c, input.facets.size) : c;
    if (c.filter.grade !== undefined) return input.facets ? withOptionCounts(c, input.facets.grade) : c;
    if (c.filter.groups?.length === 1) return withOptionCounts(c, kindTotals);
    return c;
  });

  return {
    term,
    chips: outChips,
    groups,
    outside,
    didYouMean: [...(input.didYouMean ?? [])],
    empty: groups.length === 0 && !outside,
    filteredOut,
  };
}

function indexMoreTarget(kind: PolyHitKind, term: string, chips: readonly SearchChip[]): SearchTarget {
  const t = indexTarget(kind, term);
  const size = chips.find((c) => c.filter.size !== undefined)?.filter.size;
  const grade = chips.find((c) => c.filter.grade)?.filter.grade;
  if (size === undefined && !grade) return t;
  return { ...t, queryParams: { ...(t.queryParams ?? {}), ...(size !== undefined ? { size: String(size) } : {}), ...(grade ? { grade } : {}) } };
}

function groupReason(g: SearchResultGroup, index: number, ctx: SearchContext): SearchReason | null {
  const inHq = ctx.key.startsWith('hq') || ctx.ownedFirst;
  if (g.id === 'own') {
    if (index === 0 && inHq) return { key: 'search.why.ownHq', params: {} };
    return { key: 'search.why.own', params: null };
  }
  if (index !== 0) return null;
  if (g.id === 'gallery' && ctx.key === 'gallery') return { key: 'search.why.context', params: { ctx: ctx.labelKey } };
  if (g.kind && ctx.prefer.includes(g.kind)) return { key: 'search.why.context', params: { ctx: ctx.labelKey, kind: g.kind } };
  return null;
}
