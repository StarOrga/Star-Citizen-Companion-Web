import type { VerseNewsItem } from './news.service';
import { buildPatchCycle } from './patch-cycle';
import { groupPatchNotes } from './patch-notes';
import { stackCardFor } from './patch-stack';

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

const FEED: VerseNewsItem[] = [
  patch('l410', 'Star Citizen Alpha 4.10 LIVE Release Notes', '2026-08-27T00:00:00Z'),
  patch('h410', 'Star Citizen Alpha 4.10 LIVE - Hotfix Central', '2026-09-03T00:00:00Z'),
  patch('p410', '[All Waves] Star Citizen Alpha 4.10 PTU Patch Notes 12479687', '2026-08-03T00:00:00Z'),
  patch('l49', 'Star Citizen Alpha 4.9 LIVE Release Notes', '2026-07-09T00:00:00Z'),
  patch('p49', '[Wave 1] Star Citizen Alpha 4.9 PTU Patch Notes 12107679', '2026-06-18T00:00:00Z'),
  patch('l48', 'Star Citizen Alpha 4.8 LIVE Release Notes', '2026-06-12T00:00:00Z'),
  patch('p48', '[Wave 1] Star Citizen Alpha 4.8 PTU Patch Notes 12000000', '2026-05-20T00:00:00Z'),
  patch('l47', 'Star Citizen Alpha 4.7 LIVE Release Notes', '2026-03-20T00:00:00Z'),
];
const NOW = Date.parse('2026-09-04T12:00:00Z');

describe('buildPatchCycle — the three cadence figures as spans on one axis', () => {
  const groups = groupPatchNotes(FEED);

  it('lays the live line out from the previous live to the projected next, with today on it', () => {
    const cycle = buildPatchCycle(stackCardFor('4.10', groups, null)!, groups, NOW)!;
    const keys = cycle.points.map((p) => p.key);
    expect(keys).toEqual(['prevLive', 'firstTest', 'live', 'hotfix', 'now', 'nextLive']);
    expect(cycle.points[0].version).toBe('4.9');
    expect(cycle.points.find((p) => p.key === 'nextLive')?.estimated).toBeTrue();
    expect(cycle.startMs).toBe(Date.parse('2026-07-09T00:00:00Z'));
    // Monotonic along the axis, within 0..100.
    const pcts = cycle.points.map((p) => p.pct);
    expect([...pcts].sort((a, b) => a - b)).toEqual(pcts);
    expect(pcts[0]).toBe(0);
    expect(pcts[pcts.length - 1]).toBe(100);
  });

  it('measures the spans on the same axis and pairs them with the feed median', () => {
    const cycle = buildPatchCycle(stackCardFor('4.10', groups, null)!, groups, NOW)!;
    const lead = cycle.spans.find((s) => s.key === 'leadTime')!;
    expect(lead.days).toBe(24); // 3 Aug → 27 Aug
    expect(lead.samples).toBe(3);
    const cadence = cycle.spans.find((s) => s.key === 'cadence')!;
    expect(cadence.days).toBe(49); // 9 Jul → 27 Aug
    expect(cadence.medianDays).not.toBeNull();
    const sub = cycle.spans.find((s) => s.key === 'subCadence')!;
    expect(sub.days).toBe(7);
    expect(lead.fromPct).toBeGreaterThanOrEqual(cadence.fromPct);
    expect(lead.toPct).toBe(cadence.toPct);
  });

  it('splits the axis into a real bar (start → today) and an expected bar (live → next)', () => {
    const cycle = buildPatchCycle(stackCardFor('4.10', groups, null)!, groups, NOW)!;
    expect(cycle.real.fromPct).toBe(0);
    expect(cycle.real.toPct).toBe(cycle.points.find((p) => p.key === 'now')!.pct);
    expect(cycle.expected).not.toBeNull();
    expect(cycle.expected!.fromPct).toBe(cycle.points.find((p) => p.key === 'live')!.pct);
    expect(cycle.expected!.toPct).toBe(100);
    expect(cycle.daysToNext).toBeGreaterThan(0);
  });

  it('uses the actual successor for a superseded line and projects nothing', () => {
    const cycle = buildPatchCycle(stackCardFor('4.9', groups, null)!, groups, NOW)!;
    const next = cycle.points.find((p) => p.key === 'nextLive')!;
    expect(next.estimated).toBeFalse();
    expect(next.version).toBe('4.10');
    expect(next.at).toBe(Date.parse('2026-08-27T00:00:00Z'));
    expect(cycle.expected).toBeNull();
    expect(cycle.daysToNext).toBeNull();
    // Today lies past the end of a finished cycle, so it is not a point on it.
    expect(cycle.points.some((p) => p.key === 'now')).toBeFalse();
  });

  it('is null when there is nothing to anchor an axis on', () => {
    const empty = buildPatchCycle(
      { line: '5.0', status: 'next', group: null, release: null, liveAt: null, firstTestAt: null, supersededAt: null, hotfixCount: 0, lastHotfixAt: null, waveCount: 0, noteCount: 0, plannedCount: 0 },
      [],
      NOW,
    );
    expect(empty).toBeNull();
  });
});
