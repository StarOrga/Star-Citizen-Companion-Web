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

describe('buildPatchCycle — real and usual measure the same stretch from the same anchor', () => {
  const groups = groupPatchNotes(FEED);

  it('anchors the live line on its Live release: usual = median cadence, real = so far', () => {
    const cycle = buildPatchCycle(stackCardFor('4.10', groups, null)!, groups, NOW)!;
    const main = cycle.main!;
    expect(main.key).toBe('cadence');
    const live = cycle.points.find((p) => p.key === 'live')!;
    expect(main.fromPct).toBe(live.pct);
    expect(main.realPct).toBe(cycle.points.find((p) => p.key === 'now')!.pct);
    expect(main.usualPct).toBe(cycle.points.find((p) => p.key === 'usual')!.pct);
    expect(main.realDays).toBe(9); // 27 Aug 00:00 → 4 Sep 12:00, rounded
    expect(main.finished).toBeFalse();
    expect(main.deltaDays).toBeLessThan(0); // well inside the usual cycle
    expect(cycle.daysToNext).toBeGreaterThan(0);
    expect(cycle.points.some((p) => p.key === 'nextLive')).toBeFalse();
  });

  it('lays the test phase out retrospectively against the median lead time', () => {
    const cycle = buildPatchCycle(stackCardFor('4.10', groups, null)!, groups, NOW)!;
    const lead = cycle.lead!;
    expect(lead.realDays).toBe(24); // 3 Aug → 27 Aug
    expect(lead.samples).toBe(3);
    expect(lead.finished).toBeTrue();
    expect(lead.fromPct).toBe(cycle.points.find((p) => p.key === 'firstTest')!.pct);
    expect(lead.realPct).toBe(cycle.points.find((p) => p.key === 'live')!.pct);
    expect(lead.deltaDays).toBe(24 - Math.round(lead.medianDays));
    expect(cycle.previousCycle!.days).toBe(49); // 9 Jul → 27 Aug
  });

  it('collapses hotfixes to one counted marker after Live', () => {
    const cycle = buildPatchCycle(stackCardFor('4.10', groups, null)!, groups, NOW)!;
    const hot = cycle.points.filter((p) => p.key === 'hotfix');
    expect(hot.length).toBe(1);
    expect(hot[0].count).toBe(1);
    expect(cycle.hotfixes).toEqual({ count: 1, lastAt: Date.parse('2026-09-03T00:00:00Z') });
  });

  it('keeps the axis monotonic and within 0..100', () => {
    const cycle = buildPatchCycle(stackCardFor('4.10', groups, null)!, groups, NOW)!;
    const pcts = cycle.points.map((p) => p.pct);
    expect([...pcts].sort((a, b) => a - b)).toEqual(pcts);
    expect(pcts[0]).toBe(0);
    expect(Math.max(...pcts)).toBe(100);
  });

  it('a superseded line is a finished stretch that ends on its actual successor', () => {
    const cycle = buildPatchCycle(stackCardFor('4.9', groups, null)!, groups, NOW)!;
    const main = cycle.main!;
    expect(main.finished).toBeTrue();
    expect(main.realDays).toBe(49); // 9 Jul → 27 Aug
    const next = cycle.points.find((p) => p.key === 'nextLive')!;
    expect(next.version).toBe('4.10');
    expect(main.realPct).toBe(next.pct);
    expect(cycle.daysToNext).toBeNull();
    expect(cycle.points.some((p) => p.key === 'now')).toBeFalse();
    expect(cycle.points.some((p) => p.key === 'usual')).toBeFalse();
  });

  it('a line still in testing anchors on its first test build against the lead-time median', () => {
    const feed = [...FEED, patch('p411', '[Wave 1] Star Citizen Alpha 4.11 PTU Patch Notes 12600000', '2026-09-01T00:00:00Z')];
    const g = groupPatchNotes(feed);
    const cycle = buildPatchCycle(stackCardFor('4.11', g, null)!, g, NOW)!;
    expect(cycle.main!.key).toBe('leadTime');
    expect(cycle.main!.realDays).toBe(4);
    expect(cycle.lead).toBeNull();
    expect(cycle.points.map((p) => p.key)).toEqual(['prevLive', 'firstTest', 'now', 'usual']);
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
