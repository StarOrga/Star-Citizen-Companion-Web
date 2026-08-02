import { VerseNewsItem } from './news.service';
import { groupPatchNotes } from './patch-notes';
import {
  computePatchStats,
  firstTestAt,
  kpiDelta,
  liveReleaseAt,
  median,
  pointPct,
} from './patch-stats';

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
