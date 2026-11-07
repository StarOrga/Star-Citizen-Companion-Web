import { VerseNewsItem } from './news.service';
import { groupPatchNotes } from './patch-notes';
import { computeTestBuildRelease } from './patch-stats';

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

describe('computeTestBuildRelease — when the PTU build reaches LIVE (feedback #317)', () => {
  it('dates a point release in the PTU off the median version lead time', () => {
    const groups = groupPatchNotes([
      patch('a', '[All Waves] Star Citizen Alpha 4.10.1 PTU Patch Notes 13000001', '2026-09-01T00:00:00.000Z'),
      patch('b', 'Star Citizen Alpha 4.10.1 LIVE Release Notes', '2026-09-11T00:00:00.000Z'), // 10 d
      patch('c', '[All Waves] Star Citizen Alpha 4.10.2 PTU Patch Notes 13050001', '2026-10-01T00:00:00.000Z'),
      patch('d', 'Star Citizen Alpha 4.10.2 LIVE Release Notes', '2026-10-15T00:00:00.000Z'), // 14 d
      patch('e', '[Wave 1] Star Citizen Alpha 4.10.3 PTU Patch Notes 13132001', '2026-11-01T00:00:00.000Z'),
      patch('f', '[All Waves] Star Citizen Alpha 4.10.3 PTU Patch Notes 13132002', '2026-11-04T00:00:00.000Z'),
    ]);
    const r = computeTestBuildRelease(groups)!;
    expect(r.version).toBe('4.10.3');
    expect(r.firstTestAt).toBe(Date.parse('2026-11-01T00:00:00.000Z'));
    expect(r.medianDays).toBe(12);
    expect(r.samples).toBe(2);
    expect(r.at).toBe(Date.parse('2026-11-01T00:00:00.000Z') + 12 * DAY);
  });

  it('treats 4.10.0 and 4.10 as the same build', () => {
    const groups = groupPatchNotes([
      patch('a', '[All Waves] Star Citizen Alpha 4.10.0 PTU Patch Notes 1', '2026-08-01T00:00:00.000Z'),
      patch('b', 'Star Citizen Alpha 4.10 LIVE Release Notes', '2026-08-21T00:00:00.000Z'),
      patch('c', '[All Waves] Star Citizen Alpha 4.10.1 PTU Patch Notes 2', '2026-09-01T00:00:00.000Z'),
    ]);
    const r = computeTestBuildRelease(groups)!;
    expect(r.version).toBe('4.10.1');
    expect(r.medianDays).toBe(20);
  });

  it('is null when nothing is ahead of LIVE', () => {
    const groups = groupPatchNotes([
      patch('a', '[All Waves] Star Citizen Alpha 4.10.1 PTU Patch Notes 1', '2026-09-01T00:00:00.000Z'),
      patch('b', 'Star Citizen Alpha 4.10.1 LIVE Release Notes', '2026-09-11T00:00:00.000Z'),
    ]);
    expect(computeTestBuildRelease(groups)).toBeNull();
  });

  it('is null without a single PTU → LIVE trip to measure', () => {
    const groups = groupPatchNotes([
      patch('a', 'Star Citizen Alpha 4.10 LIVE Release Notes', '2026-09-11T00:00:00.000Z'),
      patch('b', '[All Waves] Star Citizen Alpha 4.10.1 PTU Patch Notes 1', '2026-10-01T00:00:00.000Z'),
    ]);
    expect(computeTestBuildRelease(groups)).toBeNull();
  });
});
