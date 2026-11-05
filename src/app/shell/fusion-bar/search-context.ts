// The Fusion bar's search context — pure, framework-free.
// -----------------------------------------------------------------------------
// The bar runs the ONE Codex search (CodexSearchEngine) and only re-weights
// what it returns by where the reader stands (spec §5): never a hard filter,
// every group stays reachable, the context only decides the ORDER of the
// groups and which app places come first. Concept 2026-11-02 (C1/C2): the
// context ALSO filters, visibly, through chips (SearchContext.chips) that come
// only automatically: from the route and from the page section the search was
// opened from (the URL #anchor or an explicit section id). The order stays
// invisible. Chips are always shown; removing one (x or Backspace at the start
// of the field) searches without that filter; there is no hideContext. Every
// group shows 3 rows on every page (SEARCH_ROWS_SHOWN): the context never
// changes the row count, only the order.

import type { PolyHitKind } from '../../codex/codex-poly-search';
import { KIND_PRIORITY } from '../../codex/codex-poly-search';
import type { CodexSearchGroup, SearchTarget } from '../../codex/search/codex-search-model';
import { normalizeSearch } from '../../codex/codex-search';
import type { HqPageId } from '../../hq/hq-routes';
import type { SearchChip, SearchGroupId } from '../../codex/search/search-result-model';

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
  | 'hq'
  | 'hqPlan'
  | 'hqNow'
  | 'hqStock'
  | 'hqStats';

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
  /**
   * Kinds this page is NOT about (HQ pages are configured by exclusion, concept D12). Never a
   * hard filter: an excluded group sorts last and shows one row ({@link CAP_EXCLUDED}) with its
   * "all N" link, so every group stays reachable.
   */
  exclude: readonly PolyHitKind[];
  /** Kinds that rank after the neutral ones but before the excluded (still the normal row cap). */
  deprioritize: readonly PolyHitKind[];
  /** Visible filter chips of the route and of the page section (C1/C2); parsed chips come from the text. */
  chips: SearchChip[];
}

/** Rows a preferred group shows; every other group shows {@link CAP_OTHER}. */
export const CAP_PRIMARY = 5;
export const CAP_OTHER = 3;
/** Rows an excluded group keeps (collapsed to its lead hit + the "all N" link). */
export const CAP_EXCLUDED = 1;

const NEUTRAL: SearchContext = {
  key: 'all',
  labelKey: 'fusionBar.ctx.all',
  labelParams: null,
  prefer: [],
  placesFirst: false,
  ownedFirst: false,
  exclude: [],
  deprioritize: [],
  chips: [],
};

const INDEX_KINDS: readonly string[] = [
  'ship', 'weapon', 'component', 'item', 'ammunition', 'manufacturer', 'blueprint',
];

/** The context of a router URL (`/codex/index?kind=weapon`, `/hq/hangar`, …). */
export function searchContextOf(
  url: string,
  hqPage: HqPageId | null = null,
  section: string | null = null,
): SearchContext {
  const hashAt = url.indexOf('#');
  const hash = hashAt === -1 ? '' : url.slice(hashAt + 1);
  const base = routeContext(url.split('#', 1)[0], hqPage);
  // The section the search was opened from: an explicit id wins over the URL #anchor.
  const chip = sectionChip(section ?? hash);
  if (!chip || base.chips.some((c) => c.id.split(':')[1] === chip.id.split(':')[1])) return base;
  return { ...base, chips: [...base.chips, chip] };
}

function routeContext(urlNoHash: string, hqPage: HqPageId | null): SearchContext {
  const [pathPart, query = ''] = urlNoHash.split('?');
  const path = pathPart.replace(/\/+$/, '') || '/';
  const seg = path.split('/').filter(Boolean);
  const params = new URLSearchParams(query);

  if (seg[0] === 'verse') {
    if (seg[1] === 'gallery') return { ...ctx('gallery', [], true), chips: [routeChip('gallery', ['gallery'])] };
    return ctx('verse', ['ship', 'upcoming'], false);
  }
  if (seg[0] === 'hq') return hqContext(seg.length === 1 ? hqPage : null, seg[1] ?? null);
  if (seg[0] === 'codex') {
    if (seg.length === 1) return ctx('codex', ['ship'], false);
    if (seg[1] === 'index' || seg[1] === 'upcoming') {
      const k = seg[1] === 'upcoming' ? 'upcoming' : params.get('kind') ?? 'ship';
      const kind = (INDEX_KINDS.includes(k) || k === 'upcoming' ? k : 'ship') as PolyHitKind;
      return { ...ctx('codexIndex', [kind], false), labelParams: { kind }, chips: [kindChip(kind)] };
    }
    if (seg[1] === 'fps') return { ...ctx('fps', ['weapon', 'item'], false), chips: [routeChip('fps', ['weapon', 'item'])] };
    if (seg[1] === 'keybinds') return ctx('codex', ['ship'], false);
    if (seg[1] === 'ship' && seg[2]) {
      return { ...ctx('ship', ['component', 'weapon'], false), chips: [compatChip('ship', seg[2])] };
    }
    if (seg.length >= 3 && INDEX_KINDS.includes(seg[1])) {
      const kind = seg[1] as PolyHitKind;
      const compat = kind === 'weapon' || kind === 'component' || kind === 'item' ? [compatChip(kind, seg[2])] : [];
      return { ...ctx('codexDetail', [kind], false), labelParams: { kind }, chips: compat };
    }
    return ctx('codex', ['ship'], false);
  }
  return NEUTRAL;
}

/**
 * The context of an HQ page. Start and the sub routes (hangar, locker) keep the plain HQ
 * context; each landing page is configured by what it is NOT about (exclusion, D12) and which
 * kinds it leans towards. The mission and shop groups of the plan (§4.4) join these lists with
 * their PolyHitKind once the Codex index holds them.
 */
export function hqContext(page: HqPageId | null, sub: string | null = null): SearchContext {
  const base: SearchContext = { ...ctx('hq', ['ship'], true), ownedFirst: true };
  if (!page && sub === 'hangar') base.chips = [sectionChipById('hangar', 'route')!];
  if (!page && sub === 'locker') base.chips = [sectionChipById('sets', 'route')!];
  switch (page) {
    case 'planen':
      return { ...base, key: 'hqPlan', labelKey: 'fusionBar.ctx.hqPlan', prefer: ['item', 'blueprint', 'ship'], deprioritize: ['upcoming', 'manufacturer'] };
    case 'jetzt':
      return { ...base, key: 'hqNow', labelKey: 'fusionBar.ctx.hqNow', prefer: ['ship'], exclude: ['upcoming', 'manufacturer', 'ammunition'] };
    case 'bestand':
      return { ...base, chips: [sectionChipById('stock', 'route')!], key: 'hqStock', labelKey: 'fusionBar.ctx.hqStock', prefer: ['ship', 'item'], deprioritize: ['component', 'weapon'], exclude: ['upcoming', 'manufacturer'] };
    case 'statistik':
      return { ...base, key: 'hqStats', labelKey: 'fusionBar.ctx.hqStats', prefer: ['ship'], exclude: ['upcoming', 'manufacturer', 'ammunition', 'component', 'weapon', 'item', 'blueprint'] };
    default:
      return base;
  }
}

/** The neutral context (chip removed). */
export function neutralContext(): SearchContext {
  return NEUTRAL;
}

function ctx(key: SearchContextKey, prefer: readonly PolyHitKind[], placesFirst: boolean): SearchContext {
  return { key, labelKey: `fusionBar.ctx.${key}`, labelParams: null, prefer, placesFirst, ownedFirst: false, exclude: [], deprioritize: [], chips: [] };
}

// ── chips ────────────────────────────────────────────────────────────────────

/** Kinds the "Typ" chip can switch between on the Codex index. */
const KIND_OPTIONS: readonly PolyHitKind[] = ['ship', 'weapon', 'component', 'item', 'ammunition', 'manufacturer', 'blueprint', 'upcoming'];

function kindChip(kind: PolyHitKind): SearchChip {
  return {
    id: 'route:kind',
    source: 'route',
    labelKey: 'search.chip.kind',
    labelParams: { kind },
    filter: { groups: [kind] },
    options: KIND_OPTIONS.map((k) => ({ value: k, labelKey: 'search.chip.kind', labelParams: { kind: k }, count: null })),
    switchable: true,
  };
}

function routeChip(name: string, groups: SearchGroupId[]): SearchChip {
  return { id: `route:${name}`, source: 'route', labelKey: `search.chip.page.${name}`, labelParams: null, filter: { groups }, switchable: false };
}

/** "Passt auf X": the page names a ship / weapon / item. No filter; rows are checked against it (B5). */
function compatChip(kind: 'ship' | 'weapon' | 'component' | 'item', className: string): SearchChip {
  return {
    id: `route:compat:${kind}`,
    source: 'route',
    labelKey: `search.chip.compat.${kind}`,
    labelParams: { name: className },
    filter: { compatWith: { kind, className } },
    switchable: false,
  };
}

interface SectionDef {
  /** Ids / URL anchors that name this section (normalized, German and English). */
  ids: readonly string[];
  /** Hard group filter; absent for the HQ ownership sections, which only put the own group first. */
  groups?: SearchGroupId[];
  ownKinds?: SearchChip['filter']['ownKinds'];
  ownFirst?: boolean;
}

/**
 * Page sections that show ONE kind of data: only these make a chip. Other
 * anchors (stability, notes, ...) add nothing.
 */
const SECTIONS: Readonly<Record<string, SectionDef>> = {
  weapons: { ids: ['bewaffnung', 'weapons', 'waffen', 'hardpoints'], groups: ['weapon'] },
  components: { ids: ['komponenten', 'components'], groups: ['component'] },
  stock: { ids: ['bestand', 'stock', 'lager', 'inventory'], ownKinds: ['item'], ownFirst: true },
  hangar: { ids: ['hangar', 'flotte', 'fleet'], ownKinds: ['ship', 'config'], ownFirst: true },
  sets: { ids: ['sets', 'spind', 'locker', 'loadouts'], ownKinds: ['set'], ownFirst: true },
};

function sectionChipById(id: string, source: 'route' | 'section'): SearchChip | null {
  const d = SECTIONS[id];
  if (!d) return null;
  return {
    id: `${source}:${id}`,
    source,
    labelKey: `search.chip.section.${id}`,
    labelParams: null,
    filter: { ...(d.groups ? { groups: d.groups } : {}), ...(d.ownKinds ? { ownKinds: d.ownKinds } : {}), ...(d.ownFirst ? { ownFirst: true } : {}) },
    switchable: false,
  };
}

/** The chip of a page section / URL anchor, or null when it is no data section. */
export function sectionChip(section: string | null | undefined): SearchChip | null {
  const key = normalizeSearch((section ?? '').replace(/^#/, ''));
  if (!key) return null;
  const id = Object.keys(SECTIONS).find((k) => SECTIONS[k].ids.includes(key));
  return id ? sectionChipById(id, 'section') : null;
}

/**
 * Rank of a kind under a context: preferred kinds first, then KIND_PRIORITY; deprioritized kinds
 * after all neutral ones, excluded kinds last.
 */
export function kindRank(kind: PolyHitKind, context: SearchContext): number {
  const p = context.prefer.indexOf(kind);
  if (p !== -1) return p;
  const k = KIND_PRIORITY.indexOf(kind);
  const base = context.prefer.length + (k === -1 ? KIND_PRIORITY.length : k);
  const span = context.prefer.length + KIND_PRIORITY.length + 1;
  if (context.exclude.includes(kind)) return base + 2 * span;
  if (context.deprioritize.includes(kind)) return base + span;
  return base;
}

/** One group as the bar shows it: capped per context, with its "all N" target. */
export interface WeightedGroup {
  group: CodexSearchGroup;
  /** Rows shown (≤ cap). */
  shown: CodexSearchGroup['hits'];
  /** "All N" target when the group holds more than it shows. */
  more: SearchTarget | null;
  primary: boolean;
  /** Excluded by the page: one lead row, the rest behind "all N". */
  collapsed: boolean;
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
    const collapsed = !primary && context.exclude.includes(g.kind);
    const cap = collapsed ? CAP_EXCLUDED : primary || context.prefer.length === 0 ? CAP_PRIMARY : CAP_OTHER;
    let hits = g.hits;
    if (context.ownedFirst && g.kind === 'ship') {
      hits = hits
        .map((h, i) => ({ h, i, o: owns(h.classNameSlug) ? 0 : 1 }))
        .sort((a, b) => a.o - b.o || a.i - b.i)
        .map(({ h }) => h);
    }
    const shown = hits.slice(0, cap);
    const more = g.total > shown.length ? (moreTarget(g) ?? null) : null;
    return { group: g, shown, more, primary, collapsed };
  });
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
  { id: 'spind', labelKey: 'fusionBar.place.spind', link: ['/hq', 'locker'], queryParams: null, keywords: ['spind', 'locker', 'rüstung', 'armor', 'loadout'], boost: ['hq', 'fps'] },
  { id: 'hq', labelKey: 'fusionBar.place.hq', link: ['/hq'], queryParams: null, keywords: ['hq', 'zuhause', 'home', 'übersicht'], boost: ['hq'] },
  { id: 'keybinds', labelKey: 'fusionBar.place.keybinds', link: ['/codex', 'keybinds'], queryParams: null, keywords: ['keybind', 'tasten', 'steuerung', 'controls', 'shortcut'], boost: ['codex'] },
  { id: 'upcoming', labelKey: 'fusionBar.place.upcoming', link: ['/codex', 'upcoming'], queryParams: null, keywords: ['upcoming', 'angekündigt', 'concept', 'reissbrett'], boost: ['codex', 'codexIndex'] },
  { id: 'ops', labelKey: 'fusionBar.place.ops', link: ['/hq', 'ops'], queryParams: null, keywords: ['einsätze', 'einsatz', 'ops', 'mission', 'missionen', 'planung'], boost: ['hq'] },
  { id: 'extension', labelKey: 'fusionBar.place.extension', link: ['/apps', 'extension'], queryParams: null, keywords: ['erweiterung', 'extension', 'browser', 'chrome', 'edge', 'import'], boost: [] },
  { id: 'settings', labelKey: 'fusionBar.place.settings', link: ['/settings'], queryParams: null, keywords: ['einstellungen', 'settings', 'konto', 'account', 'sprache', 'language'], boost: [] },
  { id: 'social', labelKey: 'fusionBar.place.social', link: ['/social'], queryParams: null, keywords: ['social', 'freunde', 'friends'], boost: [] },
  { id: 'releaseNotes', labelKey: 'fusionBar.place.releaseNotes', link: ['/release-notes'], queryParams: null, keywords: ['release', 'changelog', 'neu', 'version'], boost: [] },
  { id: 'badge', labelKey: 'fusionBar.place.badge', link: ['/badge', 'kartograph'], queryParams: null, keywords: ['badge', 'kartograph', 'abzeichen'], boost: [] },
  { id: 'download', labelKey: 'fusionBar.place.download', link: ['/apps', 'starscape'], queryParams: null, keywords: ['download', 'app', 'starscape', 'uploader', 'desktop'], boost: [] },
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
