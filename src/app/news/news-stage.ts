import type { VerseNewsItem } from './news.service';
import type { PatchLineGroup } from './patch-notes';
import { computePatchForecast } from './patch-stats';

/**
 * The Verse News entry — "Bühne · Befund · Strom" (design Ⓐ of the 2026-08-20
 * rethink, `.claude/rethink/2026-08-20-verse-news-entry/`).
 *
 * The page used to define its one composed element as "first item of the Today
 * bucket". Measured in production on 2026-08-20 that bucket did not exist, so
 * the hero did not render at all and the page opened on a filter bar above a
 * near-empty video rail. The fix is structural rather than cosmetic: the stage
 * is picked by SCORE over the whole editorial pool, so there is no bucket left
 * that can be empty.
 *
 * Everything in this module is pure and takes `now` explicitly — the specs pin
 * the scoring and the overdue arithmetic against fixed clocks.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

/** Channels that make up the editorial stream. Patch notes have their own page. */
export const STREAM_CHANNELS: readonly VerseNewsItem['channel'][] = ['comm-link', 'spectrum', 'youtube'];

/**
 * How far back an item can still win the stage on freshness alone. Beyond the
 * window every candidate scores 0 and the tie-break (newest first) decides —
 * which is exactly the quiet-day behaviour we want: the stage stays filled, it
 * just shows the newest thing that exists.
 */
export const STAGE_WINDOW_DAYS = 30;

/**
 * Editorial weight per channel. A video is the most "eventful" thing the feed
 * carries and a Comm-Link feature outranks a Spectrum service post — but the
 * spread is deliberately narrow (0.9 … 1.1), so recency still dominates and a
 * three-week-old video cannot outrank today's article.
 */
const CHANNEL_WEIGHT: Partial<Record<VerseNewsItem['channel'], number>> = {
  youtube: 1.1,
  'comm-link': 1,
  spectrum: 0.9,
};

/** An item can only carry the stage if it brings artwork big enough to fill it. */
export function stageEligible(item: VerseNewsItem): boolean {
  return !!(item.thumbnail || (item.images && item.images.length > 0));
}

/** Linear recency falloff across the window, clamped to [0, 1]. */
function recency(item: VerseNewsItem, now: number): number {
  const ageDays = (now - Date.parse(item.publishedAt)) / DAY_MS;
  if (!Number.isFinite(ageDays)) return 0;
  return Math.max(0, 1 - ageDays / STAGE_WINDOW_DAYS);
}

/** Score = channel weight × recency. Ties are broken by publication date. */
export function stageScore(item: VerseNewsItem, now: number): number {
  return (CHANNEL_WEIGHT[item.channel] ?? 0) * recency(item, now);
}

/**
 * The one item on the stage, or `null` when the feed carries no usable artwork
 * at all (a state the page renders as a composed empty stage rather than a gap).
 *
 * Note what is NOT here: any reference to a time bucket, a filter, or "today".
 * The pick is a total order over the whole pool, so it resolves on every day the
 * feed has a single image-carrying item — which is the entire point.
 */
export function pickStage(news: readonly VerseNewsItem[], now: number): VerseNewsItem | null {
  let best: VerseNewsItem | null = null;
  let bestScore = -1;
  for (const item of news) {
    if (!STREAM_CHANNELS.includes(item.channel) || !stageEligible(item)) continue;
    const score = stageScore(item, now);
    if (
      score > bestScore ||
      (score === bestScore && best !== null && Date.parse(item.publishedAt) > Date.parse(best.publishedAt))
    ) {
      best = item;
      bestScore = score;
    }
  }
  return best;
}

/**
 * The stream: every editorial item except the one on the stage, newest first.
 * Flat on purpose — the Today/This week/Older bands are what tied the hero to an
 * empty bucket, and relative timestamps carry the same information without a
 * section that can render empty.
 */
export function buildStream(
  news: readonly VerseNewsItem[],
  stage: VerseNewsItem | null,
): VerseNewsItem[] {
  return news
    .filter((n) => STREAM_CHANNELS.includes(n.channel) && n.id !== stage?.id)
    .sort((a, b) => Date.parse(b.publishedAt) - Date.parse(a.publishedAt));
}

/** What the verdict card states, in one object. */
export interface BuildVerdict {
  /** The line you can play right now, e.g. `4.9`. Empty when unknown. */
  liveLine: string;
  /** The line currently in a test ring above `liveLine`, e.g. `4.10`. Empty when none. */
  testLine: string;
  /** Predicted date of the next LIVE patch (ISO), or null when not derivable. */
  nextLiveAt: string | null;
  /** Whole days until `nextLiveAt`; negative means overdue by that many days. */
  daysUntilLive: number | null;
  /** Median interval the estimate rests on. */
  medianDays: number | null;
  /** Sample count behind the median — the honest caveat, never dropped. */
  samples: number | null;
}

/**
 * Reduce the whole patch apparatus to the one sentence the landing page owes
 * the reader: which build is live, and when the next one is due.
 *
 * This is a re-presentation of logic that already existed — `isCurrentLive`
 * from `groupPatchNotes` and the `live` row of `computePatchForecast` — not new
 * data work. The rotating carousel, the two filter axes and the full history
 * moved to `/news/patches` unchanged.
 */
export function buildVerdict(groups: readonly PatchLineGroup[], now: number): BuildVerdict {
  const live = groups.find((g) => g.isCurrentLive);
  // The newest line above the live one that has not shipped yet — that is the
  // build in testing. Groups are already sorted newest line first.
  const test = groups.find((g) => !g.hasLive);
  const row = computePatchForecast(groups).find((r) => r.key === 'live') ?? null;
  const at = row ? Date.parse(row.at) : NaN;
  return {
    liveLine: live?.line ?? '',
    testLine: test?.line ?? '',
    nextLiveAt: row?.at ?? null,
    daysUntilLive: Number.isFinite(at) ? Math.round((at - now) / DAY_MS) : null,
    medianDays: row?.medianDays ?? null,
    samples: row?.samples ?? null,
  };
}
