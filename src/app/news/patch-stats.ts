import type { PatchLineGroup, PatchNoteEntry } from './patch-notes';

/**
 * Patch-cadence KPIs (feedback 44e90e30, follow-up).
 *
 * The admin asked to see "wie aktuell die patch performance ist von CIG …
 * immer im Vergleich der aktuellen bzw. letzten ggü. dem all time Durchschnitt".
 * Everything here is derived from the patch notes the page already has — the
 * thread titles give the version and the ring, the publication dates give the
 * timing — so no extra request, no extra field in the edge function.
 *
 * What a date means here: RSI opens the thread when the build goes out, so the
 * publication date of a LIVE release-notes thread is the release date to within
 * hours. That is precise enough for "5 days faster than average" and nowhere
 * near precise enough to quote to the minute — hence every value is whole days.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

/** Width of one volume bucket: a rolling 30 days, so no bar is a half-finished month. */
export const VOLUME_WINDOW_DAYS = 30;
/** How many of those buckets the volume chart shows (≈ one year). */
export const VOLUME_WINDOWS = 12;

export type PatchKpiKey = 'volume' | 'leadTime' | 'cadence';

export interface PatchKpiPoint {
  /** Patch line the point belongs to (`4.9`), or '' for the date-labelled volume buckets. */
  label: string;
  value: number;
  /** End of the measurement (ISO) — what the volume chart labels its bars with. */
  at: string;
}

export interface PatchKpi {
  key: PatchKpiKey;
  /** Newest measurement: the last point of `points`. */
  latest: number;
  /** Mean over every measurement — the all-time yardstick. */
  average: number;
  /** How many measurements the average rests on (an honest "n = 4" caveat). */
  samples: number;
  /** Chronological, oldest first. */
  points: PatchKpiPoint[];
  /** True when less is better (a shorter wait, a faster patch) — drives the colour. */
  lowerIsBetter: boolean;
  unit: 'days' | 'notes';
}

function parsedTime(entry: PatchNoteEntry): number {
  return Date.parse(entry.item.publishedAt);
}

function wholeDays(ms: number): number {
  return Math.max(0, Math.round(ms / DAY_MS));
}

function mean(values: readonly number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

/**
 * When a line went LIVE: its EARLIEST live release note. Later live posts on the
 * same line are re-releases and point patches; the first one is the day the
 * build reached players, which is what a cadence is measured between.
 */
export function liveReleaseAt(group: PatchLineGroup): number | null {
  const times = group.entries
    .filter((e) => e.facet === 'live')
    .map(parsedTime)
    .filter((t) => Number.isFinite(t));
  return times.length ? Math.min(...times) : null;
}

/** When a line first hit a test ring (Evocati or PTU) — the start of the lead time. */
export function firstTestAt(group: PatchLineGroup): number | null {
  const times = group.entries
    .filter((e) => e.facet === 'ptu' || e.facet === 'evocati')
    .map(parsedTime)
    .filter((t) => Number.isFinite(t));
  return times.length ? Math.min(...times) : null;
}

/**
 * Days from the first test build of a line to its LIVE release. The number the
 * admin named ("time von ptu zu live"), and the one that says most about how
 * long CIG currently sits on a build before shipping it.
 */
function leadTimeKpi(groups: readonly PatchLineGroup[]): PatchKpi | null {
  const points: PatchKpiPoint[] = [];
  for (const group of groups) {
    if (!group.line) continue;
    const live = liveReleaseAt(group);
    const test = firstTestAt(group);
    // A test thread posted after the release is a re-test, not a lead time.
    if (live === null || test === null || test > live) continue;
    points.push({ label: group.line, value: wholeDays(live - test), at: new Date(live).toISOString() });
  }
  if (points.length === 0) return null;
  points.sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
  const values = points.map((p) => p.value);
  return {
    key: 'leadTime',
    latest: values[values.length - 1],
    average: mean(values),
    samples: values.length,
    points,
    lowerIsBetter: true,
    unit: 'days',
  };
}

/**
 * Days between two consecutive LIVE releases. Needs two releases to exist at
 * all, so on a fresh feed this KPI simply isn't offered rather than showing a
 * zero.
 */
function cadenceKpi(groups: readonly PatchLineGroup[]): PatchKpi | null {
  const releases = groups
    .filter((g) => g.line)
    .map((g) => ({ line: g.line, at: liveReleaseAt(g) }))
    .filter((r): r is { line: string; at: number } => r.at !== null)
    .sort((a, b) => a.at - b.at);
  if (releases.length < 2) return null;

  const points: PatchKpiPoint[] = [];
  for (let i = 1; i < releases.length; i++) {
    points.push({
      label: releases[i].line,
      value: wholeDays(releases[i].at - releases[i - 1].at),
      at: new Date(releases[i].at).toISOString(),
    });
  }
  const values = points.map((p) => p.value);
  return {
    key: 'cadence',
    latest: values[values.length - 1],
    average: mean(values),
    samples: values.length,
    points,
    lowerIsBetter: true,
    unit: 'days',
  };
}

/**
 * Patch notes published per rolling 30 days — "patches über den Verlauf".
 *
 * Rolling windows, not calendar months: on the 3rd of a month a calendar bar
 * would read "1 patch note" and the panel would claim CIG had gone quiet. The
 * average is the rate over the WHOLE data span, not just the twelve windows on
 * screen, so "current vs. all time" stays true even once the feed reaches
 * further back than a year.
 */
function volumeKpi(groups: readonly PatchLineGroup[], now: number): PatchKpi | null {
  const times = groups
    .flatMap((g) => g.entries)
    .map(parsedTime)
    .filter((t) => Number.isFinite(t) && t <= now);
  if (times.length === 0) return null;

  const points: PatchKpiPoint[] = [];
  for (let i = VOLUME_WINDOWS - 1; i >= 0; i--) {
    const end = now - i * VOLUME_WINDOW_DAYS * DAY_MS;
    const start = end - VOLUME_WINDOW_DAYS * DAY_MS;
    points.push({
      label: '',
      value: times.filter((t) => t > start && t <= end).length,
      at: new Date(end).toISOString(),
    });
  }

  // Full span, floored at one window so a young feed reports its own rate
  // instead of dividing by a fraction and inventing a huge average.
  const oldest = Math.min(...times);
  const windows = Math.max(1, (now - oldest) / (VOLUME_WINDOW_DAYS * DAY_MS));
  return {
    key: 'volume',
    latest: points[points.length - 1].value,
    average: times.length / windows,
    samples: Math.max(1, Math.round(windows)),
    points,
    lowerIsBetter: false,
    unit: 'notes',
  };
}

/**
 * The KPIs the rotator cycles through, in the order the admin listed them
 * ("patches über den Verlauf, time von PTU zu LIVE etc."). A KPI whose data
 * isn't there yet is left out entirely — the panel shows what it can prove.
 */
export function computePatchStats(
  groups: readonly PatchLineGroup[],
  now: number = Date.now(),
): PatchKpi[] {
  return [volumeKpi(groups, now), leadTimeKpi(groups), cadenceKpi(groups)]
    .filter((k): k is PatchKpi => k !== null);
}

/** Latest minus average, rounded to whole units — the delta the panel headlines. */
export function kpiDelta(kpi: PatchKpi): number {
  return Math.round(kpi.latest) - Math.round(kpi.average);
}

/** Bar height in percent of the tallest point, with a visible floor for zeros. */
export function pointPct(kpi: PatchKpi, point: PatchKpiPoint): number {
  const max = Math.max(...kpi.points.map((p) => p.value), 1);
  return Math.max(point.value > 0 ? 6 : 2, Math.round((point.value / max) * 100));
}
