import { compareVersionsDesc, versionSegments } from './patch-notes';
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
 * Keep only the points whose measurement lands on or after `cutoffMs`.
 *
 * `null` means "no window" — the all-time view. Every point is dated by the END
 * of its interval (`at`), so a cadence point survives as long as its NEWER
 * release is inside the window, even when the older one predates it: the number
 * "63 days from 4.8 to 4.9" belongs to the day 4.9 shipped.
 *
 * Deliberately STRICT — no minimum-count fallback (the admin's call). A rare KPI
 * like the major-line cadence, which sees one release a quarter, can therefore
 * be pruned to a single point or vanish entirely inside a six-month window; that
 * is the honest picture, and flipping the panel to "all time" brings it back.
 */
function withinWindow(points: PatchKpiPoint[], cutoffMs: number | null): PatchKpiPoint[] {
  if (cutoffMs === null) return points;
  return points.filter((p) => Date.parse(p.at) >= cutoffMs);
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
function leadTimeKpi(groups: readonly PatchLineGroup[], cutoffMs: number | null): PatchKpi | null {
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
  return kpiFrom('leadTime', withinWindow(points, cutoffMs));
}

/**
 * Days between two consecutive LIVE releases of a MAIN line (4.8 → 4.9). Needs
 * two releases to exist at all, so on a fresh feed this KPI simply isn't offered
 * rather than showing a zero.
 */
function cadenceKpi(groups: readonly PatchLineGroup[], cutoffMs: number | null): PatchKpi | null {
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
  return kpiFrom('cadence', withinWindow(points, cutoffMs));
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
function subCadenceKpi(groups: readonly PatchLineGroup[], cutoffMs: number | null): PatchKpi | null {
  const drops = firstSightings(groups, () => true);
  if (drops.length < 2) return null;
  return kpiFrom('subCadence', withinWindow(sightingIntervals(drops), cutoffMs));
}

/**
 * The KPIs the rotator cycles through. A KPI whose data isn't there yet is left
 * out entirely — the panel shows what it can prove.
 *
 * `cutoffMs` narrows every KPI to the measurements on or after that instant —
 * the six-months-vs-all-time toggle the carousel carries (see withinWindow).
 * `null` (the default) is the all-time view, which keeps the existing callers
 * and every test unchanged.
 */
export function computePatchStats(
  groups: readonly PatchLineGroup[],
  cutoffMs: number | null = null,
): PatchKpi[] {
  return [leadTimeKpi(groups, cutoffMs), cadenceKpi(groups, cutoffMs), subCadenceKpi(groups, cutoffMs)]
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

// ─────────────────────────────────────────────────────────────────────────────
// Forecast — the fourth panel: when the median says the next PTU, LIVE patch and
// sub-patch are due.
//
// Everything here is an EXTRAPOLATION, not a promise: "the last event, plus the
// median gap between such events". RSI publishes no schedule, so a median cadence
// is the most honest estimate the feed supports. A predicted date already in the
// past is surfaced as overdue rather than hidden — CIG running late IS a signal.
//
// Like the KPIs, the forecast honours the carousel's window: pass the same
// `cutoffMs` and the estimate rests on the recent rhythm ("6 months") or the
// whole history ("all time"). A prediction whose median has no samples in the
// window is dropped, exactly as its chart would be.
// ─────────────────────────────────────────────────────────────────────────────

/** ptu / live: the pipeline steps; subPatch / ptuSubPatch: the point releases. */
export type PatchForecastKey = 'ptu' | 'live' | 'subPatch' | 'ptuSubPatch';

export interface PatchForecastRow {
  key: PatchForecastKey;
  /** Predicted date (ISO). The panel renders it and derives "in ~N days" live. */
  at: string;
  /** Median interval the estimate rests on, whole-ish days (an even sample gives x.5). */
  medianDays: number;
  /** How many intervals fed that median — the honest "n =" caveat. */
  samples: number;
  /** Version/line the estimate hangs off, e.g. `4.10` — for the label. */
  basis: string;
}

interface Sighting {
  version: string;
  at: number;
}

/** Whether an entry belongs to a test ring (PTU or Evocati). */
function isTestStage(entry: PatchNoteEntry): boolean {
  return entry.stage === 'ptu' || entry.stage === 'evocati';
}

/**
 * Earliest instant each distinct version satisfies `pred`, ascending by time.
 * The backbone of every cadence: keying on the VERSION means a build that shows
 * up as PTU and again as LIVE counts once, at its first appearance.
 */
function firstSightings(
  groups: readonly PatchLineGroup[],
  pred: (entry: PatchNoteEntry) => boolean,
): Sighting[] {
  const first = new Map<string, number>();
  for (const group of groups) {
    for (const entry of group.entries) {
      if (!entry.version || !pred(entry)) continue;
      const at = parsedTime(entry);
      if (!Number.isFinite(at)) continue;
      const known = first.get(entry.version);
      if (known === undefined || at < known) first.set(entry.version, at);
    }
  }
  return [...first.entries()]
    .map(([version, at]) => ({ version, at }))
    .sort((a, b) => a.at - b.at);
}

/** Consecutive gaps of a sighting series, as chart-style points (label = later version). */
function sightingIntervals(sightings: readonly Sighting[]): PatchKpiPoint[] {
  const points: PatchKpiPoint[] = [];
  for (let i = 1; i < sightings.length; i++) {
    points.push({
      label: sightings[i].version,
      value: wholeDays(sightings[i].at - sightings[i - 1].at),
      at: new Date(sightings[i].at).toISOString(),
    });
  }
  return points;
}

/**
 * The build working its way through the test rings right now: a version seen in
 * PTU/Evocati, never seen LIVE, and NEWER than everything that has shipped.
 *
 * The "newer than the live frontier" guard is what keeps a long feed honest. A
 * historical version whose LIVE note never parsed (or never existed) looks
 * "test-but-not-live" forever; picking the earliest such straggler would date
 * the next release off a build from two years ago. Anchoring on the highest
 * shipped version and keeping only test builds above it throws those out, and
 * among what remains the LOWEST version is the immediate next release — the one
 * whose lead time actually estimates the next LIVE date. `null` when nothing is
 * ahead of LIVE, which is what silences the PTU-sub row.
 */
function openPtuBuild(groups: readonly PatchLineGroup[]): Sighting | null {
  const live = new Set<string>();
  for (const group of groups) {
    for (const entry of group.entries) {
      if (entry.stage === 'live' && entry.version) live.add(entry.version);
    }
  }
  // The highest version that has actually shipped (a<b ⇒ compareVersionsDesc<0).
  let frontier: number[] | null = null;
  for (const version of live) {
    const seg = versionSegments(version);
    if (frontier === null || compareVersionsDesc(seg, frontier) < 0) frontier = seg;
  }

  const ahead = firstSightings(groups, isTestStage).filter((s) => {
    if (live.has(s.version)) return false;
    return frontier === null || compareVersionsDesc(versionSegments(s.version), frontier) < 0;
  });
  if (ahead.length === 0) return null;

  // The immediate next release is the lowest version above the frontier.
  return ahead.reduce((lowest, s) =>
    compareVersionsDesc(versionSegments(s.version), versionSegments(lowest.version)) > 0 ? s : lowest,
  );
}

/** Project a series' in-window median gap past its last sighting into a row. */
function project(
  key: PatchForecastKey,
  series: readonly Sighting[],
  cutoffMs: number | null,
): PatchForecastRow | null {
  if (series.length < 2) return null;
  const points = withinWindow(sightingIntervals(series), cutoffMs);
  if (points.length === 0) return null;
  const m = median(points.map((p) => p.value));
  const last = series[series.length - 1];
  return {
    key,
    at: new Date(last.at + m * DAY_MS).toISOString(),
    medianDays: m,
    samples: points.length,
    basis: last.version,
  };
}

/**
 * The forecast rows, in a fixed order (ptu, live, subPatch, ptuSubPatch) so the
 * panel never reshuffles under the reader. A row it cannot compute — no median
 * in the window, or no open PTU for the PTU-sub row — is simply omitted.
 */
export function computePatchForecast(
  groups: readonly PatchLineGroup[],
  cutoffMs: number | null = null,
): PatchForecastRow[] {
  const rows: (PatchForecastRow | null)[] = [];
  const open = openPtuBuild(groups);

  // 1. Next PTU — the next time a new version enters a test ring.
  rows.push(project('ptu', firstSightings(groups, isTestStage), cutoffMs));

  // 2. Next LIVE patch — the build in the PTU now, carried to release by the
  //    median lead time; failing an open build, the next line release by the
  //    median line cadence.
  const lead = leadTimeKpi(groups, cutoffMs);
  if (open && lead) {
    rows.push({
      key: 'live',
      at: new Date(open.at + lead.median * DAY_MS).toISOString(),
      medianDays: lead.median,
      samples: lead.samples,
      basis: open.version,
    });
  } else {
    const cadence = cadenceKpi(groups, cutoffMs);
    const lineLives = firstSightings(groups, (e) => e.stage === 'live');
    const last = lineLives[lineLives.length - 1];
    rows.push(
      cadence && last
        ? {
            key: 'live',
            at: new Date(last.at + cadence.median * DAY_MS).toISOString(),
            medianDays: cadence.median,
            samples: cadence.samples,
            basis: last.version,
          }
        : null,
    );
  }

  // 3. Next sub-patch (LIVE) — the next version to reach players, by the median
  //    gap between LIVE releases.
  rows.push(project('subPatch', firstSightings(groups, (e) => e.stage === 'live'), cutoffMs));

  // 4. Next PTU sub-patch — the next test drop, but ONLY while a PTU is open
  //    ("kein ptu → kein ptu subpatch").
  if (open) {
    rows.push(project('ptuSubPatch', firstSightings(groups, () => true), cutoffMs));
  }

  return rows.filter((r): r is PatchForecastRow => r !== null);
}
