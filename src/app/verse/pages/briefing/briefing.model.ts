import type { PatchLineGroup } from '../../../news/patch-notes';
import {
  NextPatchUnit,
  computeNextPatch,
  daysUntilNextPatch,
  liveReleaseAt,
  nextLineInTesting,
  nextPatchDistance,
} from '../../../news/patch-stats';
import type {
  VerseDigestItem,
  VerseDoor,
  VerseExplorerPatch,
  VerseItemKind,
  VersePatchStatus,
  VersePoint,
} from '../../data/verse.models';
import { FALLBACK_POINTS, STARS_PER_PATCH, buildTaskViews, litIndices, nextTask, starSlots } from '../../starmap/starmap.model';

const DAY_MS = 24 * 60 * 60 * 1000;

/** The centred status sentence: "4.10 live seit N Tagen   4.11 seit N Tagen fällig". */
export interface BriefingStatus {
  readonly live: { readonly line: string; readonly days: number | null };
  /** Null without an estimate (no feed yet, too few samples). */
  readonly next: { readonly line: string; readonly unit: NextPatchUnit; readonly n: number; readonly overdue: boolean } | null;
}

/** `4.10` → `4.11`: the line after a LIVE line when none is in testing yet. */
export function followingLine(line: string): string | null {
  const m = /^(\d+)\.(\d+)/.exec(line);
  return m ? `${m[1]}.${Number(m[2]) + 1}` : null;
}

/**
 * Same sources and math as the Verse status instrument (patch-note feed first,
 * the digest's patch block as the fallback), shaped for the briefing's
 * sentence: the next part names the line it is about.
 */
export function briefingStatus(
  groups: readonly PatchLineGroup[],
  digest: VersePatchStatus | null,
  now: number,
): BriefingStatus | null {
  const live = groups.find((g) => g.line && g.isCurrentLive) ?? null;
  if (live) {
    const liveAt = liveReleaseAt(live);
    const est = computeNextPatch(groups);
    const nextLine = nextLineInTesting(groups)?.line ?? followingLine(live.line);
    const dist = est ? nextPatchDistance(daysUntilNextPatch(est, now)) : null;
    return {
      live: { line: live.line, days: liveAt !== null ? Math.max(0, Math.floor((now - liveAt) / DAY_MS)) : null },
      next: dist && nextLine ? { line: nextLine, ...dist } : null,
    };
  }
  if (!digest) return null;
  const liveAt = digest.liveAt ? Date.parse(digest.liveAt) : NaN;
  return {
    live: { line: digest.line, days: Number.isFinite(liveAt) ? Math.max(0, Math.floor((now - liveAt) / DAY_MS)) : null },
    next: null,
  };
}

/** i18n key of the "next" half. */
export function nextStatusKey(next: NonNullable<BriefingStatus['next']>): string {
  if (next.unit === 'today') return 'verse.briefing.status.dueToday';
  return `verse.briefing.status.${next.overdue ? 'overdue' : 'due'}.${next.unit}${next.n === 1 ? 'One' : ''}`;
}

/** i18n key of the "live" half. */
export function liveStatusKey(days: number | null): string {
  if (days === null) return 'verse.briefing.status.liveNow';
  if (days === 0) return 'verse.briefing.status.liveToday';
  return days === 1 ? 'verse.briefing.status.liveOne' : 'verse.briefing.status.live';
}

/** Which digest kind feeds which moon's "new" line. */
export const DOOR_KIND: Readonly<Record<VerseDoor, VerseItemKind>> = { news: 'news', patches: 'patch', gallery: 'gallery' };

/** The newest top item behind a door — the concrete thing a moon announces. */
export function newestFor(door: VerseDoor, items: readonly VerseDigestItem[], seen: ReadonlySet<string>): VerseDigestItem | null {
  return items.find((i) => i.kind === DOOR_KIND[door] && !seen.has(i.key)) ?? null;
}

/** One glyph per character for the per-character fade; spaces stay breakable-free. */
export function splitChars(text: string): { readonly c: string; readonly i: number }[] {
  return Array.from(text).map((c, i) => ({ c: c === ' ' ? ' ' : c, i }));
}

/** Lit or not — the briefing shows no "next" star (that guidance lives on the star map). */
export type StarState = 'lit' | 'off';

export interface SkyStar {
  readonly i: number;
  readonly x: number;
  readonly y: number;
  readonly state: StarState;
  /** Stagger for the gentle breathing of lit stars. */
  readonly phase: number;
}

/** `open`: at least one end is not lit yet — the figure is incomplete there (dashed). */
export interface SkyLine {
  readonly x1: number;
  readonly y1: number;
  readonly x2: number;
  readonly y2: number;
  readonly state: 'lit' | 'open';
}

export interface SkyFigure {
  readonly stars: readonly SkyStar[];
  readonly lines: readonly SkyLine[];
}

/**
 * Which outline points the star map lights for this patch: the done tasks
 * replayed along the outline (`starSlots`), so the briefing and
 * `/verse/explorer` light the same stars. Null without explorer state.
 */
export function explorerLit(patch: VerseExplorerPatch | null | undefined): ReadonlySet<number> | null {
  if (!patch) return null;
  const tasks = buildTaskViews(patch);
  const slots = starSlots(patch.constellation?.points, tasks, nextTask(tasks));
  return new Set(slots.filter((s) => s.state === 'done').map((s) => s.index));
}

/**
 * The current patch's constellation for the star-map link: lit stars where
 * the star map lights them (`lit`, see {@link explorerLit}); without explorer
 * state the symmetric order by `starCount`. Edges solid between two lit
 * stars, dashed wherever an end is still open. Coordinates in a 0..100 box.
 */
export function skyFigure(
  points: readonly VersePoint[] | null | undefined,
  starCount: number,
  lit: ReadonlySet<number> | null = null,
): SkyFigure {
  const pts = points && points.length === STARS_PER_PATCH ? points : FALLBACK_POINTS;
  const n = Math.max(0, Math.min(STARS_PER_PATCH, starCount));
  const on = lit ?? litIndices(pts, n);
  const stars = pts.map((p, i): SkyStar => ({
    i,
    x: p[0] * 100,
    y: p[1] * 100,
    state: on.has(i) ? 'lit' : 'off',
    phase: (i * 1.7) % 5,
  }));
  const lines = stars.map((a, k): SkyLine => {
    const b = stars[(k + 1) % stars.length];
    return { x1: a.x, y1: a.y, x2: b.x, y2: b.y, state: a.state === 'lit' && b.state === 'lit' ? 'lit' : 'open' };
  });
  return { stars, lines };
}

/** Normalised title for the hero dedupe. */
function titleKey(item: VerseDigestItem): string {
  return `${item.kind}|${item.title.trim().toLowerCase().replace(/\s+/g, ' ')}`;
}

/**
 * The hero's stories: the top items in rank order with a usable link, each
 * story at most once — an item counts as already shown when its key, its
 * kind + title, or its resolved link repeats. Further items fill the gaps.
 */
export function uniqueStories<T>(
  items: readonly VerseDigestItem[],
  linkOf: (item: VerseDigestItem) => T | null,
  linkKey: (link: T) => string,
  max: number,
): { item: VerseDigestItem; link: T }[] {
  const keys = new Set<string>();
  const titles = new Set<string>();
  const links = new Set<string>();
  const out: { item: VerseDigestItem; link: T }[] = [];
  for (const item of items) {
    if (out.length >= max) break;
    const link = linkOf(item);
    if (!link) continue;
    const t = titleKey(item);
    const l = linkKey(link);
    if (keys.has(item.key) || titles.has(t) || links.has(l)) continue;
    keys.add(item.key);
    titles.add(t);
    links.add(l);
    out.push({ item, link });
  }
  return out;
}

/** Session flag: the full entrance plays once per browser session, a short one afterwards. */
export const INTRO_FLAG = 'sc.verse.introPlayed';

export type IntroMode = 'full' | 'short';

export function claimIntro(storage: Pick<Storage, 'getItem' | 'setItem'> | null = safeSession()): IntroMode {
  try {
    if (!storage) return 'full';
    if (storage.getItem(INTRO_FLAG)) return 'short';
    storage.setItem(INTRO_FLAG, '1');
    return 'full';
  } catch {
    return 'full';
  }
}

function safeSession(): Storage | null {
  try {
    return typeof sessionStorage === 'undefined' ? null : sessionStorage;
  } catch {
    return null;
  }
}
