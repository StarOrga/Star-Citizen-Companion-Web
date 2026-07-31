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

export interface PatchNoteEntry {
  item: VerseNewsItem;
  /** Full version as published, e.g. `4.9`, `4.8.2`, `4.6.0`. Empty when unparseable. */
  version: string;
  /** Numeric segments of `version` — the sort key; `[4, 10]` sorts ABOVE `[4, 9]`. */
  segments: number[];
  stage: PatchStage | null;
  hotfix: boolean;
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

function toEntry(item: VerseNewsItem): PatchNoteEntry {
  const version = parsePatchVersion(item.title);
  return {
    item,
    version,
    segments: versionSegments(version),
    stage: parsePatchStage(item.title),
    hotfix: isHotfixTitle(item.title),
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
    const latestAt = entries.reduce(
      (acc, e) => (Date.parse(e.item.publishedAt) > Date.parse(acc) ? e.item.publishedAt : acc),
      entries[0].item.publishedAt,
    );
    groups.push({
      line,
      segments: versionSegments(line),
      entries,
      latestAt,
      hasLive: entries.some((e) => e.stage === 'live'),
    });
  }

  // Unversioned entries can't take part in a numeric ordering — park them last
  // instead of letting an empty segment list win the comparison.
  groups.sort((a, b) => {
    if (!a.line !== !b.line) return a.line ? -1 : 1;
    return compareVersionsDesc(a.segments, b.segments);
  });
  return groups;
}
