import { VerseNewsItem } from './news.service';
import { groupPatchNotes } from './patch-notes';
import {
  VOLUME_WINDOWS,
  computePatchStats,
  firstTestAt,
  kpiDelta,
  liveReleaseAt,
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
const NOW = Date.parse('2026-07-31T12:00:00.000Z');

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

describe('computePatchStats — current vs. all-time, in the order the admin listed them', () => {
  const kpis = computePatchStats(GROUPS, NOW);

  it('offers the three KPIs, volume first', () => {
    expect(kpis.map((k) => k.key)).toEqual(['volume', 'leadTime', 'cadence']);
  });

  it('measures the patch cadence between consecutive live releases', () => {
    const cadence = kpis.find((k) => k.key === 'cadence')!;
    // 4.7 → 4.8 is 42 days, 4.8 → 4.9 is 63.
    expect(cadence.points.map((p) => p.label)).toEqual(['4.8', '4.9']);
    expect(cadence.points.map((p) => p.value)).toEqual([42, 63]);
    expect(cadence.latest).toBe(63);
    expect(cadence.average).toBe(52.5);
    expect(cadence.samples).toBe(2);
    expect(cadence.lowerIsBetter).toBe(true);
  });

  it('measures PTU → LIVE per line, newest last', () => {
    const lead = kpis.find((k) => k.key === 'leadTime')!;
    expect(lead.points.map((p) => p.label)).toEqual(['4.7', '4.8', '4.9']);
    expect(lead.points.map((p) => p.value)).toEqual([12, 12, 25]);
    expect(lead.latest).toBe(25);
    expect(lead.average).toBeCloseTo(49 / 3, 5);
    expect(lead.unit).toBe('days');
  });

  it('counts published notes per rolling 30 days and compares against the full span', () => {
    const volume = kpis.find((k) => k.key === 'volume')!;
    expect(volume.points.length).toBe(VOLUME_WINDOWS);
    // Last 30 days before 2026-07-31: the 4.9 release, its hotfix and the 4.10 wave.
    expect(volume.latest).toBe(3);
    // 9 notes over 133.5 days = 4.45 windows.
    expect(volume.average).toBeCloseTo(9 / 4.45, 2);
    expect(volume.lowerIsBetter).toBe(false);
    expect(volume.unit).toBe('notes');
  });

  it('leaves out a KPI it cannot prove instead of showing a zero', () => {
    const ptuOnly = groupPatchNotes([
      patch('a', '[Wave 1] Star Citizen Alpha 4.10 PTU Patch Notes 12358556', '2026-07-30T00:00:00.000Z'),
    ]);
    // No live release at all → no cadence, no lead time; the volume still holds.
    expect(computePatchStats(ptuOnly, NOW).map((k) => k.key)).toEqual(['volume']);
  });

  it('needs two releases before it claims a cadence', () => {
    const oneLine = groupPatchNotes([
      patch('a', '[Wave 1] Star Citizen Alpha 4.9 PTU Patch Notes', '2026-07-01T00:00:00.000Z'),
      patch('b', 'Star Citizen Alpha 4.9 LIVE Release Notes', '2026-07-15T00:00:00.000Z'),
    ]);
    expect(computePatchStats(oneLine, NOW).map((k) => k.key)).toEqual(['volume', 'leadTime']);
  });

  it('returns nothing at all when there are no patch notes', () => {
    expect(computePatchStats([], NOW)).toEqual([]);
  });

  it('ignores a test thread posted after the release — that is a re-test, not a lead time', () => {
    const backwards = groupPatchNotes([
      patch('live', 'Star Citizen Alpha 4.9 LIVE Release Notes', '2026-07-01T00:00:00.000Z'),
      patch('ptu', '[Wave 1] Star Citizen Alpha 4.9 PTU Patch Notes', '2026-07-20T00:00:00.000Z'),
    ]);
    expect(computePatchStats(backwards, NOW).some((k) => k.key === 'leadTime')).toBe(false);
  });
});

describe('kpiDelta / pointPct', () => {
  const kpis = computePatchStats(GROUPS, NOW);

  it('reports the latest measurement against the average, in whole units', () => {
    const cadence = kpis.find((k) => k.key === 'cadence')!;
    // 63 days vs. an average of 52.5 → 10 days slower than usual.
    expect(kpiDelta(cadence)).toBe(10);
  });

  it('scales bars against the tallest point and keeps an empty bucket visible', () => {
    const cadence = kpis.find((k) => k.key === 'cadence')!;
    expect(pointPct(cadence, cadence.points[1])).toBe(100);
    expect(pointPct(cadence, { label: 'x', value: 0, at: '' })).toBe(2);
  });
});
