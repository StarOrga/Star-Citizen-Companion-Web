import type { PatchLineGroup } from './patch-notes';
import { computePatchForecast, computePatchStats, liveReleaseAt } from './patch-stats';
import type { PatchKpiKey } from './patch-stats';
import { previousLiveAt, type StackCard } from './patch-stack';

/**
 * "Wann kommt der nächste?" as ONE cycle on ONE axis (2026-09-04 rethink,
 * iteration 4).
 *
 * The three cadence figures — days from the first test build to Live, days
 * between two Live releases, the sub-patch rhythm — used to be three bar
 * charts next to each other, and the owner's verdict was that they "stand
 * there unrelated". They are related: they are three stretches of the same
 * timeline. So this module lays the patch's cycle out on a single axis —
 *
 *   previous Live → first test build → Live → hotfix ticks → today → next Live
 *
 * — and expresses each figure as a SPAN on that axis with its median next to
 * it. The estimated part (today → next Live) is a separate, muted "expected"
 * bar behind the real one, per the owner's last note: "zwei Balken, einer mit
 * gedämpften Farben im Hintergrund etwas größer für die erwartete Situation,
 * der andere darüber mit aktiven Farben (reale Situation)".
 *
 * Pure: derives everything from the grouped notes, the KPI/forecast helpers
 * and the clock. Percentages are positions on the axis (0–100).
 */

export type CyclePointKey = 'prevLive' | 'firstTest' | 'live' | 'hotfix' | 'now' | 'nextLive';

export interface CyclePoint {
  key: CyclePointKey;
  /** Instant (ms). */
  at: number;
  /** 0–100 along the axis. */
  pct: number;
  /** True for the projected next-Live point. */
  estimated: boolean;
  /** Version the point belongs to (`4.9` for prevLive, `4.11` for nextLive). */
  version: string;
}

export interface CycleSpan {
  key: PatchKpiKey;
  fromPct: number;
  toPct: number;
  /** Measured length of this patch's span, whole days. */
  days: number;
  /** Median of the same measurement across the feed (the yardstick), or null. */
  medianDays: number | null;
  samples: number | null;
}

export interface PatchCycle {
  points: CyclePoint[];
  spans: CycleSpan[];
  /** The "real situation" bar: axis start → today (or the cycle end, if past). */
  real: { fromPct: number; toPct: number };
  /** The "expected situation" bar: today → estimated next Live; null when nothing is projected. */
  expected: { fromPct: number; toPct: number } | null;
  startMs: number;
  endMs: number;
  /** Days until the projected next Live; negative = overdue. Null without a projection. */
  daysToNext: number | null;
}

const DAY_MS = 24 * 60 * 60 * 1000;

function wholeDays(ms: number): number {
  return Math.max(0, Math.round(ms / DAY_MS));
}

function hotfixTimes(group: PatchLineGroup, after: number | null): number[] {
  const seen = new Set<number>();
  for (const entry of group.entries) {
    if (entry.facet !== 'hotfix') continue;
    const t = Date.parse(entry.item.publishedAt);
    if (!Number.isFinite(t)) continue;
    if (after !== null && t < after) continue;
    seen.add(Math.floor(t / DAY_MS)); // one tick per day — a hotfix thread is updated many times
  }
  return [...seen].map((d) => d * DAY_MS).sort((a, b) => a - b);
}

/** The next NEWER line that shipped — what supersedes a historical card. */
function nextLiveAfter(card: StackCard, groups: readonly PatchLineGroup[]): { at: number; version: string } | null {
  if (card.supersededAt === null) return null;
  const line = groups.find((g) => g.line && g.hasLive && liveReleaseAt(g) === card.supersededAt);
  return { at: card.supersededAt, version: line?.line ?? '' };
}

/**
 * Lay the card's cycle out. Returns null when the line has neither a test
 * build nor a release to anchor an axis on (a roadmap-only "next" whose
 * forecast is also missing).
 */
export function buildPatchCycle(
  card: StackCard,
  groups: readonly PatchLineGroup[],
  nowMs: number,
): PatchCycle | null {
  const group = card.group;
  const prevLive = previousLiveAt(card, groups);
  const firstTest = card.firstTestAt;
  const live = card.liveAt;
  const kpis = computePatchStats(groups);
  const kpi = (key: PatchKpiKey) => kpis.find((k) => k.key === key) ?? null;

  // Where the cycle ends: for the live line the projected next release, for a
  // superseded line the actual one that replaced it, for a build in testing
  // its own projected release.
  let next: { at: number; version: string; estimated: boolean } | null = null;
  const superseded = nextLiveAfter(card, groups);
  if (superseded) {
    next = { ...superseded, estimated: false };
  } else {
    const row = computePatchForecast(groups).find((r) => r.key === 'live') ?? null;
    if (row) {
      const at = Date.parse(row.at);
      if (Number.isFinite(at)) next = { at, version: card.status === 'live' ? '' : card.line, estimated: true };
    }
  }

  const anchors = [prevLive, firstTest, live].filter((t): t is number => t !== null);
  if (anchors.length === 0 && next === null) return null;

  const startMs = Math.min(...(anchors.length ? anchors : [nowMs]), nowMs);
  const endMs = Math.max(nowMs, next?.at ?? nowMs, live ?? nowMs);
  const span = Math.max(endMs - startMs, DAY_MS);
  const pct = (t: number) => Math.round(((t - startMs) / span) * 1000) / 10;

  const points: CyclePoint[] = [];
  if (prevLive !== null) {
    const prevLine = groups.find((g) => g.line && liveReleaseAt(g) === prevLive)?.line ?? '';
    points.push({ key: 'prevLive', at: prevLive, pct: pct(prevLive), estimated: false, version: prevLine });
  }
  if (firstTest !== null) points.push({ key: 'firstTest', at: firstTest, pct: pct(firstTest), estimated: false, version: card.line });
  if (live !== null) points.push({ key: 'live', at: live, pct: pct(live), estimated: false, version: card.line });
  if (group && live !== null) {
    for (const t of hotfixTimes(group, live)) {
      if (t > live) points.push({ key: 'hotfix', at: t, pct: pct(t), estimated: false, version: card.line });
    }
  }
  if (nowMs >= startMs && nowMs <= endMs) points.push({ key: 'now', at: nowMs, pct: pct(nowMs), estimated: false, version: '' });
  if (next) points.push({ key: 'nextLive', at: next.at, pct: pct(next.at), estimated: next.estimated, version: next.version });

  const spans: CycleSpan[] = [];
  if (firstTest !== null && live !== null && firstTest <= live) {
    const k = kpi('leadTime');
    spans.push({ key: 'leadTime', fromPct: pct(firstTest), toPct: pct(live), days: wholeDays(live - firstTest), medianDays: k?.median ?? null, samples: k?.samples ?? null });
  }
  if (prevLive !== null && live !== null && prevLive <= live) {
    const k = kpi('cadence');
    spans.push({ key: 'cadence', fromPct: pct(prevLive), toPct: pct(live), days: wholeDays(live - prevLive), medianDays: k?.median ?? null, samples: k?.samples ?? null });
  }
  const hot = points.filter((p) => p.key === 'hotfix');
  if (live !== null && hot.length > 0) {
    const k = kpi('subCadence');
    const lastHot = hot[hot.length - 1].at;
    spans.push({ key: 'subCadence', fromPct: pct(live), toPct: pct(lastHot), days: wholeDays(lastHot - live), medianDays: k?.median ?? null, samples: k?.samples ?? null });
  }

  const realTo = Math.min(nowMs, endMs);
  const real = { fromPct: pct(startMs), toPct: pct(realTo) };
  const expected =
    next && next.estimated && next.at > nowMs ? { fromPct: pct(Math.max(live ?? startMs, startMs)), toPct: pct(next.at) } : null;
  const daysToNext = next && next.estimated ? Math.round((next.at - nowMs) / DAY_MS) : null;

  return { points, spans, real, expected, startMs, endMs, daysToNext };
}
