import { subVersionRows } from './patch-timeline';
import type { PatchLineGroup, PatchNoteEntry } from './patch-notes';
import type { StackCard } from './patch-stack';
import type { StabilityVerdict } from './patch-stability';

function entry(id: number, version: string, stage: PatchNoteEntry['stage'], hotfix: boolean, at: string): PatchNoteEntry {
  return {
    item: { id: String(id), title: `t${id}`, url: `https://x.test/${id}`, publishedAt: at } as PatchNoteEntry['item'],
    version, segments: version.split('.').map(Number), stage, hotfix,
    facet: hotfix ? 'hotfix' : (stage ?? 'other'),
  };
}

function card(entries: PatchNoteEntry[], liveAt: number | null): StackCard {
  return { line: '4.10', status: liveAt ? 'live' : 'ptu', group: { entries } as PatchLineGroup, liveAt } as StackCard;
}

const verdict = {
  line: '4.10', insufficient: false, stability: 72, level: 3,
  days: [
    { date: '2026-10-18', score: 0.4 },
    { date: '2026-10-26', score: 0.2 },
  ],
} as unknown as StabilityVerdict;

describe('subVersionRows', () => {
  it('sorts newest first and gives test builds no stability', () => {
    const rows = subVersionRows(
      card([entry(1, '4.10.0', 'ptu', false, '2026-10-01T00:00:00Z'), entry(2, '4.10.0', 'live', false, '2026-10-17T00:00:00Z')], Date.parse('2026-10-17')),
      verdict,
    );
    expect(rows.map((r) => r.id)).toEqual(['2', '1']);
    expect(rows[1].stability).toBeNull();
    expect(rows[0].stability).not.toBeNull();
  });

  it('a hotfix ends on the newest sampled day, the release on the day before the hotfix', () => {
    const rows = subVersionRows(
      card([entry(1, '4.10.0', 'live', false, '2026-10-17T00:00:00Z'), entry(2, '4.10.1', 'live', true, '2026-10-25T00:00:00Z')], Date.parse('2026-10-17')),
      verdict,
    );
    const hotfix = rows.find((r) => r.hotfix)!;
    const release = rows.find((r) => !r.hotfix)!;
    expect(hotfix.stability).toBeGreaterThan(release.stability!);
  });

  it('folds all but the newest test wave of a shipped line', () => {
    const rows = subVersionRows(
      card([
        entry(1, '4.10.0', 'evocati', false, '2026-10-01T00:00:00Z'),
        entry(2, '4.10.0', 'ptu', false, '2026-10-05T00:00:00Z'),
        entry(3, '4.10.0', 'ptu', false, '2026-10-10T00:00:00Z'),
      ], Date.parse('2026-10-17')),
      null,
    );
    expect(rows.map((r) => r.older)).toEqual([false, true, true]);
  });

  it('keeps every wave open on a line still in testing', () => {
    const rows = subVersionRows(card([entry(1, '4.11.0', 'ptu', false, '2026-10-01T00:00:00Z'), entry(2, '4.11.0', 'evocati', false, '2026-09-20T00:00:00Z')], null), null);
    expect(rows.every((r) => !r.older)).toBeTrue();
  });
});
