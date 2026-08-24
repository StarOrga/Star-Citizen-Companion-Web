// Type-only: news.service imports the grouping helpers back, and an erased
// import keeps that pair from becoming a runtime cycle.
import type { VerseNewsItem } from './news.service';

/**
 * Patch-note grouping (feedback 44e90e30).
 *
 * RSI publishes a patch line as a stream of threads: the LIVE release notes, a
 * handful of PTU/Evocati waves before it, the point releases (4.8.1, 4.8.2) and
 * a rolling hotfix thread after it. Listed flat and by date they read as noise —
 * the admin asked for the newest MAIN line on top with its smaller patches
 * nested underneath.
 *
 * Everything here derives from the item's own title. Nothing is keyed off a list
 * of known versions: 4.10 became the newest line the day RSI posted it, without
 * a code change, and the same holds for 5.0.
 */

export type PatchStage = 'live' | 'ptu' | 'evocati';

/**
 * The channel a note belongs to — the second filter axis the admin asked for
 * ("nach version oder nach live hotfix ptu etc."), and the key the "newest per
 * channel" header is bucketed by.
 *
 * Every note gets EXACTLY ONE facet, so the chip counts add up to the total and
 * the header can promise "at most one per channel" without showing the same
 * thread twice. A hotfix thread reads `LIVE - Hotfix Central`, i.e. stage `live`
 * AND hotfix — hotfix wins, because that is the more specific fact and the one
 * you filter for. `other` catches the odd note that names neither ring.
 */
export type PatchFacet = 'live' | 'hotfix' | 'ptu' | 'evocati' | 'other';

/** Display order for the facet chips and the "newest per channel" header. */
export const PATCH_FACETS: readonly PatchFacet[] = ['live', 'hotfix', 'ptu', 'evocati', 'other'];

export interface PatchNoteEntry {
  item: VerseNewsItem;
  /** Full version as published, e.g. `4.9`, `4.8.2`, `4.6.0`. Empty when unparseable. */
  version: string;
  /** Numeric segments of `version` — the sort key; `[4, 10]` sorts ABOVE `[4, 9]`. */
  segments: number[];
  stage: PatchStage | null;
  hotfix: boolean;
  /** Single filter/grouping channel derived from `stage` + `hotfix` (see PatchFacet). */
  facet: PatchFacet;
}

export interface PatchLineGroup {
  /** Main patch line, i.e. the first two segments: `4.10`, `4.9`, `4.8`. */
  line: string;
  segments: number[];
  entries: PatchNoteEntry[];
  /** Newest publication date in the group — drives the "when" label on the header. */
  latestAt: string;
  /** True once the line has reached LIVE, i.e. it is (or was) the played build. */
  hasLive: boolean;
  /**
   * The newest line that has reached LIVE — the build you can play right now.
   * Exactly one group carries it. `hasLive` alone would badge all of 4.9 … 4.3
   * as "LIVE", which is true of their past and useless as information; the lines
   * above this one are still PTU, the ones below are history.
   */
  isCurrentLive: boolean;
}

/**
 * A dotted version with 2–3 segments of at most two digits each.
 *
 * The guards are what keep dates out: `(Updated 7.30.2026)` offers `7.30`, but
 * the `.2026` behind it fails `(?![\d.])`, and a restart inside the number is
 * blocked by the leading `[^\d.]` — so the whole token is rejected instead of
 * silently grouping a hotfix under patch line "7.30". Build numbers
 * (`12358556`) carry no dot and never match at all. Written as a leading group
 * rather than a lookbehind: lookbehind is still the newest bit of regex syntax
 * in browsers and this string is parsed at module load.
 */
const VERSION_TOKEN = /(?:^|[^\d.])(\d{1,2}(?:\.\d{1,2}){1,2})(?![\d.])/;
/** Preferred form: the version RSI writes right after "Alpha". */
const ALPHA_VERSION = /\balpha\s+v?(\d{1,2}(?:\.\d{1,2}){1,2})(?![\d.])/i;

/** Version string out of a patch-note title, or '' when there is none. */
export function parsePatchVersion(title: string): string {
  return ALPHA_VERSION.exec(title)?.[1] ?? VERSION_TOKEN.exec(title)?.[1] ?? '';
}

/** `'4.10'` → `[4, 10]`. Numbers, never strings — '4.10' < '4.9' lexically. */
export function versionSegments(version: string): number[] {
  return version ? version.split('.').map((s) => Number(s)) : [];
}

/** Main patch line of a version: the first two segments. `4.8.2` → `4.8`. */
export function patchLineOf(version: string): string {
  return versionSegments(version).slice(0, 2).join('.');
}

/** Segment-wise numeric compare, newest first. A missing segment counts as 0 (4.9 = 4.9.0). */
export function compareVersionsDesc(a: number[], b: number[]): number {
  const len = Math.max(a.length, b.length);
  for (let i = 0; i < len; i++) {
    const diff = (b[i] ?? 0) - (a[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

/**
 * Which ring the notes belong to. Evocati wins over PTU because those titles say
 * both ("[Evo NDA] … PTU Patch Notes") and the NDA ring is the more specific fact.
 */
export function parsePatchStage(title: string): PatchStage | null {
  const t = title.toLowerCase();
  if (/\bevo\b|\bevocati\b|\betf\b/.test(t)) return 'evocati';
  if (/\bptu\b/.test(t)) return 'ptu';
  if (/\blive\b/.test(t)) return 'live';
  return null;
}

export function isHotfixTitle(title: string): boolean {
  return /hotfix/i.test(title);
}

/** The one channel a note is filed under — hotfix beats the ring it patches. */
export function patchFacetOf(stage: PatchStage | null, hotfix: boolean): PatchFacet {
  if (hotfix) return 'hotfix';
  return stage ?? 'other';
}

function toEntry(item: VerseNewsItem): PatchNoteEntry {
  const version = parsePatchVersion(item.title);
  const stage = parsePatchStage(item.title);
  const hotfix = isHotfixTitle(item.title);
  return {
    item,
    version,
    segments: versionSegments(version),
    stage,
    hotfix,
    facet: patchFacetOf(stage, hotfix),
  };
}

/**
 * Group patch-note items by main line, newest line first, newest entry first
 * inside a line.
 *
 * Items whose title carries no parseable version are NOT dropped — they land in
 * a trailing group with an empty `line`, because the ask was to see everything.
 */
export function groupPatchNotes(news: readonly VerseNewsItem[]): PatchLineGroup[] {
  const byLine = new Map<string, PatchNoteEntry[]>();
  for (const item of news) {
    if (item.channel !== 'patch') continue;
    const entry = toEntry(item);
    const line = patchLineOf(entry.version);
    const bucket = byLine.get(line);
    if (bucket) bucket.push(entry);
    else byLine.set(line, [entry]);
  }

  const groups: PatchLineGroup[] = [];
  for (const [line, entries] of byLine) {
    entries.sort((a, b) => {
      const byDate = Date.parse(b.item.publishedAt) - Date.parse(a.item.publishedAt);
      if (Number.isFinite(byDate) && byDate !== 0) return byDate;
      return compareVersionsDesc(a.segments, b.segments);
    });
    const latestAt = newestAt(entries);
    groups.push({
      line,
      segments: versionSegments(line),
      entries,
      latestAt,
      hasLive: entries.some((e) => e.stage === 'live'),
      isCurrentLive: false,
    });
  }

  // Unversioned entries can't take part in a numeric ordering — park them last
  // instead of letting an empty segment list win the comparison.
  groups.sort((a, b) => {
    if (!a.line !== !b.line) return a.line ? -1 : 1;
    return compareVersionsDesc(a.segments, b.segments);
  });
  const current = groups.find((g) => g.line && g.hasLive);
  if (current) current.isCurrentLive = true;
  return groups;
}

/** Newest publication date in a set of entries. */
function newestAt(entries: readonly PatchNoteEntry[]): string {
  return entries.reduce(
    (acc, e) => (Date.parse(e.item.publishedAt) > Date.parse(acc) ? e.item.publishedAt : acc),
    entries[0].item.publishedAt,
  );
}

/**
 * The two filter axes of the patch section. An EMPTY set means "no restriction
 * on this axis" — the same convention the channel chips above the stream use, so
 * "Alle" is simply the empty selection rather than a magic member.
 */
export interface PatchFilter {
  /** Main patch lines to keep (`4.10`, `4.9`, … `''` = the unversioned group). */
  lines: ReadonlySet<string>;
  facets: ReadonlySet<PatchFacet>;
}

export const EMPTY_PATCH_FILTER: PatchFilter = { lines: new Set(), facets: new Set() };

/**
 * Narrow the grouped patch notes to the current selection.
 *
 * Groups that lose all their entries disappear, and `latestAt` is re-derived
 * from what is left — but `hasLive` / `isCurrentLive` are carried over
 * UNCHANGED: which build you can play is a fact about the game, not about the
 * filter, so hiding the LIVE notes must not silently un-badge 4.9.
 */
export function filterPatchLines(
  groups: readonly PatchLineGroup[],
  filter: PatchFilter,
): PatchLineGroup[] {
  const { lines, facets } = filter;
  if (lines.size === 0 && facets.size === 0) return groups as PatchLineGroup[];
  const out: PatchLineGroup[] = [];
  for (const group of groups) {
    if (lines.size > 0 && !lines.has(group.line)) continue;
    const entries = facets.size === 0 ? group.entries : group.entries.filter((e) => facets.has(e.facet));
    if (entries.length === 0) continue;
    out.push({ ...group, entries, latestAt: newestAt(entries) });
  }
  return out;
}

/**
 * Narrow the grouped patch notes to a free-text query (feedback 961ab0a5).
 *
 * A third axis on top of the two chip filters, and deliberately a separate
 * pass: the chips answer "which patch line / which ring", the query answers
 * "where is the thing I remember reading". Composed rather than merged so each
 * axis keeps its own meaning and the reader can drop either one.
 *
 * `haystackOf` is injected rather than read off the entry, because what a note
 * is searchable BY grows over time: today it is the title plus the bullet
 * points of whichever notes have been loaded, and a note whose contents are not
 * loaded yet is still findable by its title. Keeping that out of here means
 * this function has no opinion about loading, and the same rules apply whether
 * a note's outline is in memory or not.
 *
 * `hasLive` / `isCurrentLive` are carried over UNCHANGED, exactly as in
 * `filterPatchLines`: which build you can play is a fact about the game, not
 * about the search box.
 */
export function filterPatchLinesByQuery(
  groups: readonly PatchLineGroup[],
  tokens: readonly string[],
  haystackOf: (entry: PatchNoteEntry) => string,
  matches: (haystack: string, tokens: readonly string[]) => boolean,
): PatchLineGroup[] {
  if (tokens.length === 0) return groups as PatchLineGroup[];
  const out: PatchLineGroup[] = [];
  for (const group of groups) {
    // A line whose own name matches ("4.10") keeps all of its notes — that is
    // what someone typing a version number is asking for.
    const lineHit = !!group.line && matches(group.line, tokens);
    const entries = lineHit ? group.entries : group.entries.filter((e) => matches(haystackOf(e), tokens));
    if (entries.length === 0) continue;
    out.push({ ...group, entries, latestAt: newestAt(entries) });
  }
  return out;
}

/** How many notes each facet holds — drives the chip counts. */
export function facetCounts(groups: readonly PatchLineGroup[]): Map<PatchFacet, number> {
  const counts = new Map<PatchFacet, number>();
  for (const group of groups) {
    for (const entry of group.entries) {
      counts.set(entry.facet, (counts.get(entry.facet) ?? 0) + 1);
    }
  }
  return counts;
}

/** One "newest note" per channel — the at-a-glance header above the history. */
export interface PatchHighlight {
  facet: PatchFacet;
  entry: PatchNoteEntry;
  /** Main patch line the entry belongs to, so the card can name it. */
  line: string;
}

/**
 * The newest note per channel, at most one each (44e90e30 follow-up: "maximal 1
 * pro live, ptu etc. auf dem ersten Blick").
 *
 * Facets partition the notes, so no thread can show up twice — the rolling
 * hotfix thread is the hotfix card, never also the LIVE card. Ordered by
 * PATCH_FACETS (live, hotfix, ptu, evocati, other), NOT by date: the row is a
 * status board, and a board whose columns swap places whenever RSI posts is
 * unreadable.
 */
export function latestPerFacet(groups: readonly PatchLineGroup[]): PatchHighlight[] {
  const best = new Map<PatchFacet, PatchHighlight>();
  for (const group of groups) {
    for (const entry of group.entries) {
      const current = best.get(entry.facet);
      const t = Date.parse(entry.item.publishedAt);
      if (!current || t > Date.parse(current.entry.item.publishedAt)) {
        best.set(entry.facet, { facet: entry.facet, entry, line: group.line });
      }
    }
  }
  return PATCH_FACETS.map((f) => best.get(f)).filter((h): h is PatchHighlight => !!h);
}

// ─────────────────────────────────────────────────────────────────────────────
// Build waves (2026-08-20 rethink)
//
// RSI publishes one note per internal build wave, so a single announcement
// arrives as a run of near-identical rows: measured in production on
// 2026-08-20 the open 4.10 line held TWENTY of them — "[All Waves] Star Citizen
// Alpha 4.10 PTU Patch Notes 12479687", "… 12473311", "… 12464883" — differing
// only by a build number, and that run alone rendered 1,215 px of the page.
//
// It is one event in twenty waves, not twenty pieces of content, so it collapses
// to ONE row that says how many waves it holds. Nothing is dropped: the group
// expands to the full list on demand.
//
// The rule keys on facet + version rather than on the title, deliberately —
// the wave marker itself changes mid-run ("[Wave 1]" → "[All Waves]"), so any
// title-normalising heuristic splits exactly the run it is meant to fold.
// ─────────────────────────────────────────────────────────────────────────────

/** Shortest run that is worth folding. Two rows are cheaper left alone. */
export const WAVE_MIN = 3;

/** Either a single note, or a folded run of build waves for one version+facet. */
export interface PatchWaveGroup {
  /** Stable key for `@for` tracking: facet, version and the first entry's id. */
  key: string;
  facet: PatchFacet;
  version: string;
  entries: PatchNoteEntry[];
  /** True once the run is long enough to be folded (`entries.length >= WAVE_MIN`). */
  folded: boolean;
}

/**
 * Fold consecutive same-version, same-facet notes into wave groups.
 *
 * Only CONSECUTIVE entries fold: the list is already newest-first, so a run is
 * exactly the stretch of waves that belongs to one announcement. A later,
 * unrelated note of the same facet that arrives after something else stays its
 * own row rather than being teleported into an older group.
 */
export function groupWaves(entries: readonly PatchNoteEntry[]): PatchWaveGroup[] {
  const out: PatchWaveGroup[] = [];
  for (const entry of entries) {
    const last = out[out.length - 1];
    if (last && last.facet === entry.facet && last.version === entry.version) {
      last.entries.push(entry);
      last.folded = last.entries.length >= WAVE_MIN;
      continue;
    }
    out.push({
      key: `${entry.facet}|${entry.version}|${entry.item.id}`,
      facet: entry.facet,
      version: entry.version,
      entries: [entry],
      folded: false,
    });
  }
  return out;
}
