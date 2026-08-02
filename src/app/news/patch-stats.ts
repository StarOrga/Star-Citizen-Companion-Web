import type { PatchLineGroup, PatchNoteEntry } from './patch-notes';

/**
 * Patch-cadence KPIs (feedback 44e90e30, follow-up; reworked for 9c000427).
 *
 * The admin asked to see "wie aktuell die patch performance ist von CIG …
 * immer im Vergleich der aktuellen bzw. letzten ggü. dem all time Durchschnitt".
 * Everything here is derived from the patch notes the page already has — the
 * thread titles give the version and the ring, the publication dates give the
 * timing — so no extra request, no extra field in the edge function.
 *
 * What a date means here: RSI opens the thread when the build goes out, so the
 * publication date of a LIVE release-notes thread is the release date to within
 * hours. That is precise enough for "5 days faster than usual" and nowhere near
 * precise enough to quote to the minute — hence every value is whole days.
 *
 * ## Why the yardstick is the MEDIAN, not the mean (9c000427)
 *
 * "beim patch takt, bitte immer den median nehmen, nicht den durchschnitt, auch
 * beim ptu zu live patch."
 *
 * He is right, and it is not a matter of taste. Release intervals are a
 * textbook right-skewed distribution: most gaps cluster around the real rhythm,
 * and a handful are enormous — a delayed .0, a summer break, a feed that starts
 * mid-line. One 180-day outlier drags a mean of ~30 days up past 45 and the
 * panel then reports every normal patch as "15 days faster than average",
 * permanently. The median ignores how far the outliers sit and answers the
 * question actually being asked: what does a typical gap look like? With an even
 * sample count it averages the two middle values, so it still moves with the
 * data instead of snapping between two observations.
 *
 * ## Why "patch notes per 30 days" is gone
 *
 * "Die Grafik zu patch notes macht keinen sinn so." It counted THREADS, not
 * builds: one release routinely produces a LIVE note, three PTU waves and a
 * rolling hotfix thread, so the bar height tracked how chatty RSI's forum was
 * that month rather than how often anything shipped. It was also the only KPI
 * with no direction — "more posts" is neither good nor bad — so it had a chart
 * but no verdict. It is replaced by the sub-patch cadence below, which measures
 * the same period in builds.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

/** Every KPI is a duration in days, and for all of them shorter is better. */
export type PatchKpiKey = 'leadTime' | 'cadence' | 'subCadence';

export interface PatchKpiPoint {
  /** Version the measurement ends on — `4.9` for a line, `4.9.1` for a sub-patch. */
  label: string;
  value: number;
  /** End of the measurement (ISO). */
  at: string;
}

export interface PatchKpi {
  key: PatchKpiKey;
  /** Newest measurement: the last point of `points`. */
  latest: number;
  /** Median over every measurement — the all-time yardstick (see the header). */
  median: number;
  /** How many measurements the median rests on (an honest "n = 4" caveat). */
  samples: number;
  /** Chronological, oldest first. */
  points: PatchKpiPoint[];
}

function parsedTime(entry: PatchNoteEntry): number {
  return Date.parse(entry.item.publishedAt);
}

function wholeDays(ms: number): number {
  return Math.max(0, Math.round(ms / DAY_MS));
}

/**
 * Middle value of the sample, averaging the two middle ones on an even count.
 *
 * Sorts a copy — the caller's array is the chart's point order and must stay
 * chronological.
 */
export function median(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/** Assemble a KPI from a finished, chronologically sorted point list. */
function kpiFrom(key: PatchKpiKey, points: PatchKpiPoint[]): PatchKpi | null {
  if (points.length === 0) return null;
  const values = points.map((p) => p.value);
  return {
    key,
    latest: values[values.length - 1],
    median: median(values),
    samples: values.length,
    points,
  };
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
  points.sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
  return kpiFrom('leadTime', points);
}

/**
 * Days between two consecutive LIVE releases of a MAIN line (4.8 → 4.9). Needs
 * two releases to exist at all, so on a fresh feed this KPI simply isn't offered
 * rather than showing a zero.
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
  return kpiFrom('cadence', points);
}

/**
 * Days between two consecutive SUB-PATCH drops — "den patch takt nicht auf live
 * ebene sondern auf sub patch ebene im ptu und/oder live" (9c000427).
 *
 * The line-level cadence above measures 4.8 → 4.9, which for a yearly-ish major
 * rhythm yields four or five data points and says nothing about the weeks in
 * between. This one measures the drops inside those months: 4.9.0, 4.9.1,
 * 4.9.2, 4.10.0 …
 *
 * A "drop" is the FIRST publication of a distinct version, in ANY ring. Keying
 * on the version rather than on (version, ring) is what keeps the number honest:
 * a build appears as PTU first and as LIVE days later, and counting both would
 * insert the lead time into the series as if it were a cadence — the leadTime
 * KPI already owns that measurement. First-sighting also means the series is
 * mostly PTU-dated, which is the correct answer to "how often does something new
 * land", since that is the moment the build exists.
 */
function subCadenceKpi(groups: readonly PatchLineGroup[]): PatchKpi | null {
  /** version → earliest publication of that version anywhere. */
  const firstSeen = new Map<string, number>();
  for (const group of groups) {
    for (const entry of group.entries) {
      if (!entry.version) continue;
      const at = parsedTime(entry);
      if (!Number.isFinite(at)) continue;
      const known = firstSeen.get(entry.version);
      if (known === undefined || at < known) firstSeen.set(entry.version, at);
    }
  }

  const drops = [...firstSeen.entries()]
    .map(([version, at]) => ({ version, at }))
    .sort((a, b) => a.at - b.at);
  if (drops.length < 2) return null;

  const points: PatchKpiPoint[] = [];
  for (let i = 1; i < drops.length; i++) {
    points.push({
      label: drops[i].version,
      value: wholeDays(drops[i].at - drops[i - 1].at),
      at: new Date(drops[i].at).toISOString(),
    });
  }
  return kpiFrom('subCadence', points);
}

/**
 * The KPIs the rotator cycles through. A KPI whose data isn't there yet is left
 * out entirely — the panel shows what it can prove.
 */
export function computePatchStats(groups: readonly PatchLineGroup[]): PatchKpi[] {
  return [leadTimeKpi(groups), cadenceKpi(groups), subCadenceKpi(groups)]
    .filter((k): k is PatchKpi => k !== null);
}

/** Latest minus median, rounded to whole days — the delta the panel headlines. */
export function kpiDelta(kpi: PatchKpi): number {
  return Math.round(kpi.latest) - Math.round(kpi.median);
}

/** Bar height in percent of the tallest point, with a visible floor for zeros. */
export function pointPct(kpi: PatchKpi, point: PatchKpiPoint): number {
  const max = Math.max(...kpi.points.map((p) => p.value), 1);
  return Math.max(point.value > 0 ? 6 : 2, Math.round((point.value / max) * 100));
}
