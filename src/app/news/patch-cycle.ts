import type { PatchLineGroup } from './patch-notes';
import { computePatchStats, liveReleaseAt } from './patch-stats';
import { previousLiveAt, type StackCard } from './patch-stack';

/**
 * "Wann kommt der nächste?" as ONE cycle on ONE axis (2026-09-04 rethink,
 * iteration 4; anchor logic corrected 2026-09-05 after the PO + designer
 * review).
 *
 * The first cut hung "real" and "expected" one after the other on the axis —
 * two stretches of time, not two measurements of the same thing — and the
 * owner could not read how the real situation stood to the expected one.
 * The corrected picture: **both bars start at the same anchor and measure
 * the same stretch.**
 *
 *   anchor        = this patch's Live release (or, while it is still in a
 *                   test ring, its first test build)
 *   expected      = anchor + the median of that stretch across the feed
 *                   (muted, taller, behind) — ends at the "usual" marker
 *   real          = anchor → today, or → the actual event that ended the
 *                   stretch (active colour, thinner, in front)
 *   overshoot     = the part of real that runs past the usual marker — the
 *                   deviation, coloured as a warning; a finished stretch that
 *                   ended early leaves the expected bar sticking out instead
 *
 * The same construction is applied retrospectively to the test phase (first
 * test build → Live against the median lead time), so the axis also answers
 * "how did THIS patch compare to the usual rhythm". Hotfixes collapse to one
 * labelled marker with a count; their cadence lives in the folded charts.
 *
 * Pure: derives everything from the grouped notes, the KPI helpers and the
 * clock. Percentages are positions on the axis (0–100).
 */

export type CyclePointKey = 'prevLive' | 'firstTest' | 'leadUsual' | 'live' | 'hotfix' | 'now' | 'usual' | 'nextLive';

export interface CyclePoint {
  key: CyclePointKey;
  /** Instant (ms). */
  at: number;
  /** 0–100 along the axis. */
  pct: number;
  /** Version the point belongs to (`4.9` for prevLive, `4.11` for nextLive). */
  version: string;
  /** Hotfix marker only: how many hotfix threads it stands for. */
  count?: number;
}

/** One stretch measured twice: as it usually goes, and as it actually went / goes. */
export interface CycleStretch {
  key: 'leadTime' | 'cadence';
  /** Where both bars start (the anchor). */
  fromPct: number;
  /** Where the median says the stretch ends. */
  usualPct: number;
  /** Where the real stretch ends: today, or the actual event. */
  realPct: number;
  /** Real length so far / in total, whole days. */
  realDays: number;
  /** The usual length: median across the feed, and its sample count. */
  medianDays: number;
  samples: number;
  /** Real minus usual, whole days — positive = later than usual. */
  deltaDays: number;
  /** True once the stretch has actually ended (the event happened). */
  finished: boolean;
}

export interface PatchCycle {
  points: CyclePoint[];
  /** The retrospective test phase (first test build → Live), when both exist. */
  lead: CycleStretch | null;
  /** The main stretch from the anchor: Live → next Live, or first test → Live. */
  main: CycleStretch | null;
  /** The previous, finished Live → Live cycle that ended on this patch's Live (the fact line). */
  previousCycle: { days: number; medianDays: number; samples: number } | null;
  hotfixes: { count: number; lastAt: number } | null;
  startMs: number;
  endMs: number;
  /** Days until the usual next Live; negative = past it. Null for a finished cycle. */
  daysToNext: number | null;
}

const DAY_MS = 24 * 60 * 60 * 1000;

function wholeDays(ms: number): number {
  return Math.max(0, Math.round(ms / DAY_MS));
}

function hotfixFacts(group: PatchLineGroup | null, after: number | null): { count: number; lastAt: number } | null {
  if (!group) return null;
  let count = 0;
  let lastAt: number | null = null;
  for (const entry of group.entries) {
    if (entry.facet !== 'hotfix') continue;
    const t = Date.parse(entry.item.publishedAt);
    if (!Number.isFinite(t) || (after !== null && t < after)) continue;
    count++;
    if (lastAt === null || t > lastAt) lastAt = t;
  }
  return count > 0 && lastAt !== null ? { count, lastAt } : null;
}

/** The next NEWER line that shipped — what ended a superseded card's cycle. */
function successorOf(card: StackCard, groups: readonly PatchLineGroup[]): { at: number; version: string } | null {
  if (card.supersededAt === null) return null;
  const line = groups.find((g) => g.line && g.hasLive && liveReleaseAt(g) === card.supersededAt);
  return { at: card.supersededAt, version: line?.line ?? '' };
}

/**
 * Lay the card's cycle out. Returns null when the line has neither a test
 * build nor a release to anchor on (a roadmap-only "next").
 */
export function buildPatchCycle(
  card: StackCard,
  groups: readonly PatchLineGroup[],
  nowMs: number,
): PatchCycle | null {
  const prevLive = previousLiveAt(card, groups);
  const firstTest = card.firstTestAt;
  const live = card.liveAt;
  if (live === null && firstTest === null) return null;

  const kpis = computePatchStats(groups);
  const leadKpi = kpis.find((k) => k.key === 'leadTime') ?? null;
  const cadenceKpi = kpis.find((k) => k.key === 'cadence') ?? null;
  const successor = successorOf(card, groups);

  // ── The main stretch, anchored ────────────────────────────────────────
  // Live line / superseded line: Live → next Live against the cadence median.
  // Line still in testing: first test → Live against the lead-time median.
  let anchor: number;
  let mainKey: 'cadence' | 'leadTime';
  let median: number | null;
  let samples: number | null;
  let realEnd: number;
  let finished: boolean;
  if (live !== null) {
    anchor = live;
    mainKey = 'cadence';
    median = cadenceKpi?.median ?? null;
    samples = cadenceKpi?.samples ?? null;
    finished = successor !== null;
    realEnd = successor ? successor.at : nowMs;
  } else {
    anchor = firstTest as number;
    mainKey = 'leadTime';
    median = leadKpi?.median ?? null;
    samples = leadKpi?.samples ?? null;
    finished = false;
    realEnd = nowMs;
  }
  const usualEnd = median !== null ? anchor + median * DAY_MS : null;

  // ── Axis range ────────────────────────────────────────────────────────
  const anchors = [prevLive, firstTest, live].filter((t): t is number => t !== null);
  const startMs = Math.min(...anchors);
  const endMs = Math.max(realEnd, usualEnd ?? realEnd, live ?? realEnd);
  const span = Math.max(endMs - startMs, DAY_MS);
  const pct = (t: number) => Math.round(((t - startMs) / span) * 1000) / 10;

  const points: CyclePoint[] = [];
  if (prevLive !== null) {
    const prevLine = groups.find((g) => g.line && liveReleaseAt(g) === prevLive)?.line ?? '';
    points.push({ key: 'prevLive', at: prevLive, pct: pct(prevLive), version: prevLine });
  }
  if (firstTest !== null) points.push({ key: 'firstTest', at: firstTest, pct: pct(firstTest), version: card.line });
  if (live !== null) points.push({ key: 'live', at: live, pct: pct(live), version: card.line });
  const hotfixes = hotfixFacts(card.group, live);
  if (hotfixes && live !== null && hotfixes.lastAt > live) {
    points.push({ key: 'hotfix', at: hotfixes.lastAt, pct: pct(hotfixes.lastAt), version: card.line, count: hotfixes.count });
  }
  if (!finished && nowMs >= startMs && nowMs <= endMs) points.push({ key: 'now', at: nowMs, pct: pct(nowMs), version: '' });
  if (usualEnd !== null && !finished) points.push({ key: 'usual', at: usualEnd, pct: pct(usualEnd), version: '' });
  if (successor) points.push({ key: 'nextLive', at: successor.at, pct: pct(successor.at), version: successor.version });

  const main: CycleStretch | null =
    median !== null && samples !== null
      ? {
          key: mainKey,
          fromPct: pct(anchor),
          usualPct: pct(usualEnd as number),
          realPct: pct(realEnd),
          realDays: wholeDays(realEnd - anchor),
          medianDays: median,
          samples,
          deltaDays: wholeDays(realEnd - anchor) - Math.round(median),
          finished,
        }
      : null;

  // ── The retrospective test phase of a shipped line ────────────────────
  let lead: CycleStretch | null = null;
  if (firstTest !== null && live !== null && firstTest <= live && leadKpi) {
    lead = {
      key: 'leadTime',
      fromPct: pct(firstTest),
      usualPct: pct(Math.min(firstTest + leadKpi.median * DAY_MS, endMs)),
      realPct: pct(live),
      realDays: wholeDays(live - firstTest),
      medianDays: leadKpi.median,
      samples: leadKpi.samples,
      deltaDays: wholeDays(live - firstTest) - Math.round(leadKpi.median),
      finished: true,
    };
  }

  // The usual end of the test phase — the marker the overshoot is measured from.
  if (lead) {
    const at = (firstTest as number) + lead.medianDays * DAY_MS;
    if (at <= endMs) points.push({ key: 'leadUsual', at, pct: pct(at), version: card.line });
  }
  points.sort((a, b) => a.at - b.at);

  const previousCycle =
    prevLive !== null && live !== null && cadenceKpi
      ? { days: wholeDays(live - prevLive), medianDays: cadenceKpi.median, samples: cadenceKpi.samples }
      : null;

  const daysToNext = !finished && usualEnd !== null ? Math.round((usualEnd - nowMs) / DAY_MS) : null;

  return { points, lead, main, previousCycle, hotfixes, startMs, endMs, daysToNext };
}
