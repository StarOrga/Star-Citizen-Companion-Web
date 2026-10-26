// The Fusion bar's search context — pure, framework-free.
// -----------------------------------------------------------------------------
// The bar runs the ONE Codex search (CodexSearchEngine) and only re-weights
// what it returns by where the reader stands (spec §5): never a hard filter,
// every group stays reachable, the context only decides the ORDER of the
// groups, how many rows each shows ("top x per group") and which app places
// come first. The context is shown as a chip inside the field; removing it
// (✕ or Backspace at the start of the field) searches neutrally.

import type { PolyHitKind } from '../../codex/codex-poly-search';
import { KIND_PRIORITY } from '../../codex/codex-poly-search';
import type { CodexSearchGroup, SearchTarget } from '../../codex/search/codex-search-model';
import { normalizeSearch } from '../../codex/codex-search';

/** Where the reader stands, as far as search weighting cares. */
export type SearchContextKey =
  | 'all'
  | 'verse'
  | 'gallery'
  | 'codex'
  | 'codexIndex'
  | 'ship'
  | 'codexDetail'
  | 'fps'
  | 'hq';

export interface SearchContext {
  key: SearchContextKey;
  /** i18n key of the chip label. */
  labelKey: string;
  /** Interpolation for the label (the Codex kind, …). */
  labelParams: Record<string, string> | null;
  /** Kinds in the order this context prefers them; the rest follow in KIND_PRIORITY order. */
  prefer: readonly PolyHitKind[];
  /** True when the app places group leads (gallery, HQ): their content is not in the Codex index. */
  placesFirst: boolean;
  /** Put the reader's own ships first inside the ship group (HQ → own hangar). */
  ownedFirst: boolean;
}

/** Rows a preferred group shows; every other group shows {@link CAP_OTHER}. */
export const CAP_PRIMARY = 5;
export const CAP_OTHER = 3;
/** "Companion fragen" is offered from this many words on (spec §5). */
export const COMPANION_MIN_WORDS = 4;

const NEUTRAL: SearchContext = {
  key: 'all',
  labelKey: 'fusionBar.ctx.all',
  labelParams: null,
  prefer: [],
  placesFirst: false,
  ownedFirst: false,
};

const INDEX_KINDS: readonly string[] = [
  'ship', 'weapon', 'component', 'item', 'ammunition', 'manufacturer', 'blueprint',
];

/** The context of a router URL (`/codex/index?kind=weapon`, `/hq/hangar`, …). */
export function searchContextOf(url: string): SearchContext {
  const [pathPart, query = ''] = url.split('#', 1)[0].split('?');
  const path = pathPart.replace(/\/+$/, '') || '/';
  const seg = path.split('/').filter(Boolean);
  const params = new URLSearchParams(query);

  if (seg[0] === 'verse') {
    if (seg[1] === 'gallery') return ctx('gallery', [], true);
    return ctx('verse', ['ship', 'upcoming'], false);
  }
  if (seg[0] === 'hq') return { ...ctx('hq', ['ship'], true), ownedFirst: true };
  if (seg[0] === 'codex') {
    if (seg.length === 1) return ctx('codex', ['ship'], false);
    if (seg[1] === 'index' || seg[1] === 'upcoming') {
      const k = seg[1] === 'upcoming' ? 'upcoming' : params.get('kind') ?? 'ship';
      const kind = (INDEX_KINDS.includes(k) || k === 'upcoming' ? k : 'ship') as PolyHitKind;
      return { ...ctx('codexIndex', [kind], false), labelParams: { kind } };
    }
    if (seg[1] === 'fps') return ctx('fps', ['weapon', 'item'], false);
    if (seg[1] === 'keybinds') return ctx('codex', ['ship'], false);
    if (seg[1] === 'ship' && seg[2]) return ctx('ship', ['component', 'weapon'], false);
    if (seg.length >= 3 && INDEX_KINDS.includes(seg[1])) {
      const kind = seg[1] as PolyHitKind;
      return { ...ctx('codexDetail', [kind], false), labelParams: { kind } };
    }
    return ctx('codex', ['ship'], false);
  }
  return NEUTRAL;
}

/** The neutral context (chip removed). */
export function neutralContext(): SearchContext {
  return NEUTRAL;
}

function ctx(key: SearchContextKey, prefer: readonly PolyHitKind[], placesFirst: boolean): SearchContext {
  return { key, labelKey: `fusionBar.ctx.${key}`, labelParams: null, prefer, placesFirst, ownedFirst: false };
}

/** Rank of a kind under a context: preferred kinds first, then KIND_PRIORITY. */
export function kindRank(kind: PolyHitKind, context: SearchContext): number {
  const p = context.prefer.indexOf(kind);
  if (p !== -1) return p;
  const k = KIND_PRIORITY.indexOf(kind);
  return context.prefer.length + (k === -1 ? KIND_PRIORITY.length : k);
}

/** One group as the bar shows it: capped per context, with its "all N" target. */
export interface WeightedGroup {
  group: CodexSearchGroup;
  /** Rows shown (≤ cap). */
  shown: CodexSearchGroup['hits'];
  /** "All N" target when the group holds more than it shows. */
  more: SearchTarget | null;
  primary: boolean;
}

/**
 * Re-weights the engine's groups: preferred kinds first (stable otherwise),
 * a preferred group shows {@link CAP_PRIMARY} rows, the others
 * {@link CAP_OTHER}; `owns` floats the reader's own ships up in the ship group
 * when the context asks for it. Nothing is dropped — a capped group keeps its
 * "all N" link.
 */
export function weightGroups(
  groups: readonly CodexSearchGroup[],
  context: SearchContext,
  owns: (classNameSlug: string) => boolean = () => false,
  moreTarget: (g: CodexSearchGroup) => SearchTarget | null = (g) => g.more,
): WeightedGroup[] {
  const ordered = groups
    .map((g, i) => ({ g, i }))
    .sort((a, b) => kindRank(a.g.kind, context) - kindRank(b.g.kind, context) || a.i - b.i)
    .map(({ g }) => g);
  return ordered.map((g) => {
    const primary = context.prefer.includes(g.kind);
    const cap = primary || context.prefer.length === 0 ? CAP_PRIMARY : CAP_OTHER;
    let hits = g.hits;
    if (context.ownedFirst && g.kind === 'ship') {
      hits = hits
        .map((h, i) => ({ h, i, o: owns(h.classNameSlug) ? 0 : 1 }))
        .sort((a, b) => a.o - b.o || a.i - b.i)
        .map(({ h }) => h);
    }
    const shown = hits.slice(0, cap);
    const more = g.total > shown.length ? (moreTarget(g) ?? null) : null;
    return { group: g, shown, more, primary };
  });
}

/** Words in a term (whitespace-separated, punctuation-only tokens ignored). */
export function wordCount(term: string): number {
  return term
    .trim()
    .split(/\s+/)
    .filter((w) => /[\p{L}\p{N}]/u.test(w)).length;
}

/** True when the "Companion fragen" offer applies to `term`. */
export function offersCompanion(term: string): boolean {
  return wordCount(term) >= COMPANION_MIN_WORDS;
}

/** An app destination the search finds by name (pages the Codex index does not hold). */
export interface SearchPlace {
  id: string;
  labelKey: string;
  link: string[];
  queryParams: Record<string, string> | null;
  /** Extra search words (both languages), lower case. */
  keywords: readonly string[];
  /** Contexts this place leads in. */
  boost: readonly SearchContextKey[];
}

export const SEARCH_PLACES: readonly SearchPlace[] = [
  { id: 'news', labelKey: 'fusionBar.place.news', link: ['/verse', 'news'], queryParams: null, keywords: ['news', 'neuigkeiten', 'comm-link', 'video'], boost: ['verse'] },
  { id: 'patches', labelKey: 'fusionBar.place.patches', link: ['/verse', 'patches'], queryParams: null, keywords: ['patch', 'patches', 'update', 'ptu', 'live', 'stabil'], boost: ['verse'] },
  { id: 'gallery', labelKey: 'fusionBar.place.gallery', link: ['/verse', 'gallery'], queryParams: null, keywords: ['galerie', 'gallery', 'bilder', 'images', 'starscape', 'wallpaper', 'screenshot'], boost: ['gallery', 'verse'] },
  { id: 'hangar', labelKey: 'fusionBar.place.hangar', link: ['/hq', 'hangar'], queryParams: null, keywords: ['hangar', 'flotte', 'fleet', 'meine schiffe', 'my ships'], boost: ['hq'] },
  { id: 'spind', labelKey: 'fusionBar.place.spind', link: ['/hq', 'spind'], queryParams: null, keywords: ['spind', 'locker', 'rüstung', 'armor', 'loadout'], boost: ['hq', 'fps'] },
  { id: 'hq', labelKey: 'fusionBar.place.hq', link: ['/hq'], queryParams: null, keywords: ['hq', 'zuhause', 'home', 'übersicht'], boost: ['hq'] },
  { id: 'keybinds', labelKey: 'fusionBar.place.keybinds', link: ['/codex', 'keybinds'], queryParams: null, keywords: ['keybind', 'tasten', 'steuerung', 'controls', 'shortcut'], boost: ['codex'] },
  { id: 'upcoming', labelKey: 'fusionBar.place.upcoming', link: ['/codex', 'upcoming'], queryParams: null, keywords: ['upcoming', 'angekündigt', 'concept', 'reissbrett'], boost: ['codex', 'codexIndex'] },
  { id: 'settings', labelKey: 'fusionBar.place.settings', link: ['/settings'], queryParams: null, keywords: ['einstellungen', 'settings', 'konto', 'account', 'sprache', 'language'], boost: [] },
  { id: 'friends', labelKey: 'fusionBar.place.friends', link: ['/friends'], queryParams: null, keywords: ['freunde', 'friends', 'org'], boost: [] },
  { id: 'releaseNotes', labelKey: 'fusionBar.place.releaseNotes', link: ['/release-notes'], queryParams: null, keywords: ['release', 'changelog', 'neu', 'version'], boost: [] },
  { id: 'badge', labelKey: 'fusionBar.place.badge', link: ['/badge', 'kartograph'], queryParams: null, keywords: ['badge', 'kartograph', 'abzeichen'], boost: [] },
  { id: 'download', labelKey: 'fusionBar.place.download', link: ['/download'], queryParams: null, keywords: ['download', 'app', 'starscape', 'uploader', 'desktop'], boost: [] },
];

/**
 * Places matching `term` (by translated label or keyword, accent-insensitive),
 * boosted ones for this context first. An empty term matches nothing.
 */
export function matchPlaces(
  term: string,
  context: SearchContext,
  label: (p: SearchPlace) => string,
  max = 4,
): SearchPlace[] {
  const q = normalizeSearch(term.trim());
  if (!q) return [];
  const words = q.split(/\s+/).filter(Boolean);
  const hits = SEARCH_PLACES.filter((p) => {
    const hay = [normalizeSearch(label(p)), ...p.keywords.map((k) => normalizeSearch(k))].join(' ');
    return words.some((w) => w.length >= 2 && hay.includes(w));
  });
  return hits
    .map((p, i) => ({ p, i, b: p.boost.includes(context.key) ? 0 : 1 }))
    .sort((a, b) => a.b - b.b || a.i - b.i)
    .slice(0, max)
    .map(({ p }) => p);
}
