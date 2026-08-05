import { VerseNewsItem } from './news.service';
import { groupPatchNotes } from './patch-notes';
import {
  computePatchForecast,
  computePatchStats,
  firstTestAt,
  kpiDelta,
  liveReleaseAt,
  median,
  pointPct,
} from './patch-stats';

const DAY = 24 * 60 * 60 * 1000;

function patch(id: string, title: string, publishedAt: string): VerseNewsItem {
  return {
    id,
    title,
    url: `https://robertsspaceindustries.com/spectrum/community/SC/forum/190048/thread/${id}`,
    publishedAt,
    channel: 'patch',
    source: 'patch-notes',
  };
}

// Four patch lines with the shape RSI actually publishes: a test wave (some of
// them Evocati), the LIVE release notes, and a rolling hotfix thread after it.
const FEED: VerseNewsItem[] = [
  patch('p47-ptu', '[All Waves] Star Citizen Alpha 4.7 PTU Patch Notes 11700000', '2026-03-20T00:00:00.000Z'),
  patch('p47-live', 'Star Citizen Alpha 4.7 LIVE Release Notes', '2026-04-01T00:00:00.000Z'),
  patch('p48-ptu', '[All Waves] Star Citizen Alpha 4.8 PTU Patch Notes 11900000', '2026-05-01T00:00:00.000Z'),
  patch('p48-live', 'Star Citizen Alpha 4.8 LIVE Release Notes', '2026-05-13T00:00:00.000Z'),
  patch('p49-evo', '[Evo NDA] Star Citizen Alpha 4.9 PTU Patch Notes 12107679', '2026-06-20T00:00:00.000Z'),
  patch('p49-ptu', '[All Waves] Star Citizen Alpha 4.9 PTU RC1 Patch Notes 12218630', '2026-07-01T00:00:00.000Z'),
  patch('p49-live', 'Star Citizen Alpha 4.9 LIVE Release Notes', '2026-07-15T00:00:00.000Z'),
  patch('p49-hot', 'Star Citizen Alpha 4.9 LIVE - Hotfix Central (Updated 7.30.2026)', '2026-07-16T00:00:00.000Z'),
  patch('p410-ptu', '[Wave 1] Star Citizen Alpha 4.10 PTU Patch Notes 12358556', '2026-07-30T00:00:00.000Z'),
];

const GROUPS = groupPatchNotes(FEED);

describe('median — the yardstick the admin asked for (9c000427)', () => {
  it('takes the middle value on an odd sample', () => {
    expect(median([5, 1, 3])).toBe(3);
  });

  it('averages the two middle values on an even sample', () => {
    expect(median([1, 3, 5, 9])).toBe(4);
  });

  it('shrugs off the outlier a mean would chase', () => {
    // A delayed release: the mean is 51, the median stays on the real rhythm.
    const gaps = [28, 30, 32, 30, 180];
    const mean = gaps.reduce((a, b) => a + b, 0) / gaps.length;
    expect(median(gaps)).toBe(30);
    expect(mean).toBeGreaterThan(50);
  });

  it('does not reorder the caller array — the points stay chronological', () => {
    const values = [9, 1, 5];
    median(values);
    expect(values).toEqual([9, 1, 5]);
  });

  it('reports zero rather than NaN for an empty sample', () => {
    expect(median([])).toBe(0);
  });
});

describe('liveReleaseAt / firstTestAt — the two dates every duration KPI rests on', () => {
  it('dates a line by its FIRST live note, not by a later re-post', () => {
    const line49 = GROUPS.find((g) => g.line === '4.9')!;
    expect(liveReleaseAt(line49)).toBe(Date.parse('2026-07-15T00:00:00.000Z'));
  });

  it('does not mistake the rolling hotfix thread for the release', () => {
    const line49 = GROUPS.find((g) => g.line === '4.9')!;
    // The hotfix thread is newer AND says LIVE — it must not become the release date.
    expect(liveReleaseAt(line49)).toBeLessThan(Date.parse('2026-07-16T00:00:00.000Z'));
  });

  it('starts the lead time at the Evocati wave, which is the first test build', () => {
    const line49 = GROUPS.find((g) => g.line === '4.9')!;
    expect(firstTestAt(line49)).toBe(Date.parse('2026-06-20T00:00:00.000Z'));
  });

  it('reports no release for a line that has only reached PTU', () => {
    const line410 = GROUPS.find((g) => g.line === '4.10')!;
    expect(liveReleaseAt(line410)).toBeNull();
    expect(firstTestAt(line410)).not.toBeNull();
  });
});

describe('computePatchStats — three durations, each against its median', () => {
  const kpis = computePatchStats(GROUPS);

  it('offers lead time, line cadence and sub-patch cadence, in that order', () => {
    expect(kpis.map((k) => k.key)).toEqual(['leadTime', 'cadence', 'subCadence']);
  });

  it('measures the patch cadence between consecutive live releases', () => {
    const cadence = kpis.find((k) => k.key === 'cadence')!;
    // 4.7 → 4.8 is 42 days, 4.8 → 4.9 is 63.
    expect(cadence.points.map((p) => p.label)).toEqual(['4.8', '4.9']);
    expect(cadence.points.map((p) => p.value)).toEqual([42, 63]);
    expect(cadence.latest).toBe(63);
    expect(cadence.median).toBe(52.5);
    expect(cadence.samples).toBe(2);
  });

  it('measures PTU → LIVE per line against the median, not the mean', () => {
    const lead = kpis.find((k) => k.key === 'leadTime')!;
    expect(lead.points.map((p) => p.label)).toEqual(['4.7', '4.8', '4.9']);
    expect(lead.points.map((p) => p.value)).toEqual([12, 12, 25]);
    expect(lead.latest).toBe(25);
    // The mean would be 49/3 ≈ 16.3; the 25-day outlier must not move the yardstick.
    expect(lead.median).toBe(12);
  });

  it('measures the sub-patch cadence from each version\'s FIRST sighting', () => {
    const sub = kpis.find((k) => k.key === 'subCadence')!;
    // 4.7 (Mar 20) → 4.8 (May 1) → 4.9 (Jun 20) → 4.10 (Jul 30), all PTU-dated.
    expect(sub.points.map((p) => p.label)).toEqual(['4.8', '4.9', '4.10']);
    expect(sub.points.map((p) => p.value)).toEqual([42, 50, 40]);
    expect(sub.latest).toBe(40);
    expect(sub.median).toBe(42);
  });

  it('counts a point release as its own drop and never as a lead time', () => {
    // 4.9.0 / 4.9.1 / 4.9.2 — each 21 days apart at first sighting. The LIVE
    // note of 4.9.1 is the SAME version as its PTU wave, so it must not open a
    // second interval (that gap is the lead time, which leadTime already owns).
    const points = groupPatchNotes([
      patch('a', '[Wave 1] Star Citizen Alpha 4.9.0 PTU Patch Notes', '2026-06-01T00:00:00.000Z'),
      patch('b', 'Star Citizen Alpha 4.9.0 LIVE Release Notes', '2026-06-15T00:00:00.000Z'),
      patch('c', '[Wave 1] Star Citizen Alpha 4.9.1 PTU Patch Notes', '2026-06-22T00:00:00.000Z'),
      patch('d', 'Star Citizen Alpha 4.9.1 LIVE Release Notes', '2026-06-29T00:00:00.000Z'),
      patch('e', 'Star Citizen Alpha 4.9.2 LIVE Release Notes', '2026-07-13T00:00:00.000Z'),
    ]);
    const sub = computePatchStats(points).find((k) => k.key === 'subCadence')!;
    expect(sub.points.map((p) => p.label)).toEqual(['4.9.1', '4.9.2']);
    expect(sub.points.map((p) => p.value)).toEqual([21, 21]);
    expect(sub.median).toBe(21);
  });

  it('leaves out a KPI it cannot prove instead of showing a zero', () => {
    const ptuOnly = groupPatchNotes([
      patch('a', '[Wave 1] Star Citizen Alpha 4.10 PTU Patch Notes 12358556', '2026-07-30T00:00:00.000Z'),
    ]);
    // One note, one version: no release, no lead time and nothing to space apart.
    expect(computePatchStats(ptuOnly)).toEqual([]);
  });

  it('needs two releases before it claims a line cadence', () => {
    const oneLine = groupPatchNotes([
      patch('a', '[Wave 1] Star Citizen Alpha 4.9 PTU Patch Notes', '2026-07-01T00:00:00.000Z'),
      patch('b', 'Star Citizen Alpha 4.9 LIVE Release Notes', '2026-07-15T00:00:00.000Z'),
    ]);
    // Both notes are version 4.9, so there is no second drop either.
    expect(computePatchStats(oneLine).map((k) => k.key)).toEqual(['leadTime']);
  });

  it('returns nothing at all when there are no patch notes', () => {
    expect(computePatchStats([])).toEqual([]);
  });

  it('ignores a test thread posted after the release — that is a re-test, not a lead time', () => {
    const backwards = groupPatchNotes([
      patch('live', 'Star Citizen Alpha 4.9 LIVE Release Notes', '2026-07-01T00:00:00.000Z'),
      patch('ptu', '[Wave 1] Star Citizen Alpha 4.9 PTU Patch Notes', '2026-07-20T00:00:00.000Z'),
    ]);
    expect(computePatchStats(backwards).some((k) => k.key === 'leadTime')).toBe(false);
  });
});

describe('computePatchStats — the six-month window (strict, the admin\'s call)', () => {
  // June 1st sits between the spring releases and the summer ones, so it prunes
  // each KPI to a known, checkable remainder.
  const cutoff = Date.parse('2026-06-01T00:00:00.000Z');

  it('is unchanged from all-time when the cutoff is null', () => {
    expect(computePatchStats(GROUPS, null)).toEqual(computePatchStats(GROUPS));
  });

  it('keeps only the measurements dated on or after the cutoff', () => {
    const kpis = computePatchStats(GROUPS, cutoff);
    const cadence = kpis.find((k) => k.key === 'cadence')!;
    // 4.8 released May 13 (dropped), 4.9 released Jul 15 (kept) → one lonely point.
    expect(cadence.points.map((p) => p.label)).toEqual(['4.9']);
    expect(cadence.samples).toBe(1);
    expect(cadence.median).toBe(63);

    const sub = kpis.find((k) => k.key === 'subCadence')!;
    // 4.9 (Jun 20) and 4.10 (Jul 30) survive; the 4.8 drop (May 1) does not.
    expect(sub.points.map((p) => p.label)).toEqual(['4.9', '4.10']);
    expect(sub.median).toBe(45);
  });

  it('drops a KPI entirely when the window empties it — no fallback', () => {
    // Nothing shipped after this instant, so every duration KPI is pruned to nil.
    const future = Date.parse('2027-01-01T00:00:00.000Z');
    expect(computePatchStats(GROUPS, future)).toEqual([]);
  });
});

describe('computePatchForecast — the fourth panel', () => {
  it('predicts PTU, LIVE, sub-patch and (PTU open) the PTU sub-patch', () => {
    const rows = computePatchForecast(GROUPS);
    expect(rows.map((r) => r.key)).toEqual(['ptu', 'live', 'subPatch', 'ptuSubPatch']);
  });

  it('dates the next PTU from the last test entry plus the median test gap', () => {
    const ptu = computePatchForecast(GROUPS).find((r) => r.key === 'ptu')!;
    // Test entries 42/50/40 days apart → median 42, hung off 4.10 (Jul 30).
    expect(ptu.basis).toBe('4.10');
    expect(ptu.medianDays).toBe(42);
    expect(ptu.samples).toBe(3);
    expect(Date.parse(ptu.at)).toBe(Date.parse('2026-07-30T00:00:00.000Z') + 42 * DAY);
  });

  it('carries the OPEN PTU build to LIVE by the median lead time, not the cadence', () => {
    const live = computePatchForecast(GROUPS).find((r) => r.key === 'live')!;
    // 4.10 is in the PTU (no LIVE note); lead times 12/12/25 → median 12.
    expect(live.basis).toBe('4.10');
    expect(live.medianDays).toBe(12);
    expect(Date.parse(live.at)).toBe(Date.parse('2026-07-30T00:00:00.000Z') + 12 * DAY);
  });

  it('falls back to the line cadence for LIVE and drops the PTU-sub row when no PTU is open', () => {
    const noPtu = groupPatchNotes([
      patch('a', '[Wave 1] Star Citizen Alpha 4.8 PTU Patch Notes', '2026-05-01T00:00:00.000Z'),
      patch('b', 'Star Citizen Alpha 4.8 LIVE Release Notes', '2026-05-13T00:00:00.000Z'),
      patch('c', '[Wave 1] Star Citizen Alpha 4.9 PTU Patch Notes', '2026-07-01T00:00:00.000Z'),
      patch('d', 'Star Citizen Alpha 4.9 LIVE Release Notes', '2026-07-15T00:00:00.000Z'),
    ]);
    const rows = computePatchForecast(noPtu);
    // Everything reached LIVE → no open build → no "PTU sub-patch" line.
    expect(rows.some((r) => r.key === 'ptuSubPatch')).toBe(false);
    const live = rows.find((r) => r.key === 'live')!;
    // One cadence interval, 4.8 → 4.9 = 63 days, off the 4.9 release (Jul 15).
    expect(live.basis).toBe('4.9');
    expect(live.medianDays).toBe(63);
    expect(Date.parse(live.at)).toBe(Date.parse('2026-07-15T00:00:00.000Z') + 63 * DAY);
  });

  it('separates the sub-patch rows once real point releases exist', () => {
    const withSubs = groupPatchNotes([
      patch('a', 'Star Citizen Alpha 4.9.0 LIVE Release Notes', '2026-06-01T00:00:00.000Z'),
      patch('b', 'Star Citizen Alpha 4.9.1 LIVE Release Notes', '2026-06-15T00:00:00.000Z'),
      patch('c', '[Wave 1] Star Citizen Alpha 4.9.2 PTU Patch Notes', '2026-06-25T00:00:00.000Z'),
    ]);
    const rows = computePatchForecast(withSubs);
    const subLive = rows.find((r) => r.key === 'subPatch')!;
    // Only 4.9.0 and 4.9.1 reached LIVE, 14 days apart → next LIVE sub off 4.9.1.
    expect(subLive.basis).toBe('4.9.1');
    expect(subLive.medianDays).toBe(14);
    // 4.9.2 sits in the PTU, so the PTU-sub row is present and dates off it.
    const ptuSub = rows.find((r) => r.key === 'ptuSubPatch')!;
    expect(ptuSub.basis).toBe('4.9.2');
  });

  it('ignores a historical test-only straggler when anchoring the next LIVE', () => {
    // 4.4 shows up in the PTU but its LIVE note never parsed, so it reads as
    // "test, never live" forever — below the shipped frontier, it must not date
    // the next release. 4.10 (the build actually ahead of LIVE) must win.
    const withStraggler = groupPatchNotes([
      patch('s44', '[Wave 1] Star Citizen Alpha 4.4 PTU Patch Notes', '2025-11-01T00:00:00.000Z'),
      patch('s48p', '[Wave 1] Star Citizen Alpha 4.8 PTU Patch Notes', '2026-05-01T00:00:00.000Z'),
      patch('s48l', 'Star Citizen Alpha 4.8 LIVE Release Notes', '2026-05-13T00:00:00.000Z'),
      patch('s49p', '[Wave 1] Star Citizen Alpha 4.9 PTU Patch Notes', '2026-07-01T00:00:00.000Z'),
      patch('s49l', 'Star Citizen Alpha 4.9 LIVE Release Notes', '2026-07-15T00:00:00.000Z'),
      patch('s410', '[Wave 1] Star Citizen Alpha 4.10 PTU Patch Notes', '2026-07-30T00:00:00.000Z'),
    ]);
    const live = computePatchForecast(withStraggler).find((r) => r.key === 'live')!;
    expect(live.basis).toBe('4.10');
    // Anchored on 4.10's test entry (Jul 30), not 4.4's from last November.
    expect(Date.parse(live.at)).toBeGreaterThan(Date.parse('2026-07-30T00:00:00.000Z'));
  });

  it('honours the window: a tighter cutoff moves the median it projects from', () => {
    const cutoff = Date.parse('2026-06-01T00:00:00.000Z');
    const ptu = computePatchForecast(GROUPS, cutoff).find((r) => r.key === 'ptu')!;
    // Only the 4.9 (50) and 4.10 (40) gaps survive → median 45.
    expect(ptu.medianDays).toBe(45);
    expect(ptu.samples).toBe(2);
  });
});

describe('kpiDelta / pointPct', () => {
  const kpis = computePatchStats(GROUPS);

  it('reports the latest measurement against the median, in whole days', () => {
    const cadence = kpis.find((k) => k.key === 'cadence')!;
    // 63 days vs. a median of 52.5 → 10 days slower than usual.
    expect(kpiDelta(cadence)).toBe(10);
  });

  it('scales bars against the tallest point and keeps an empty bucket visible', () => {
    const cadence = kpis.find((k) => k.key === 'cadence')!;
    expect(pointPct(cadence, cadence.points[1])).toBe(100);
    expect(pointPct(cadence, { label: 'x', value: 0, at: '' })).toBe(2);
  });
});
