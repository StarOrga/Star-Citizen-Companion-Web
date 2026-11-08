import { emptyState, isInEventArea, nearestEnd, openEvents, resolveEventEnd, setProgress, earnedRewards, reachedTier, type EventRow } from './event-logic';
import { normalizeSheet } from './event-sheet';

const NOW = Date.parse('2026-11-08T12:00:00Z');
const ev = (id: string, over: Partial<EventRow> = {}): EventRow => ({
  id, name: id, startDate: '2026-11-01', endDate: '2026-11-30', dateStatus: 'estimated', status: 'scheduled', hidden: false, freeFly: false, sheet: null, ...over,
});
const EST = '2026-12-10T00:00:00.000Z';

describe('event end chain (C5)', () => {
  it('official sheet end > confirmed row end > estimated patch > unknown', () => {
    const sheet = normalizeSheet({ fields: { end: { value: '2026-11-25', confidence: 1, source: 'official' } } });
    expect(resolveEventEnd(ev('a', { sheet }), EST)).toEqual({ at: '2026-11-25', basis: 'official' });
    expect(resolveEventEnd(ev('a', { dateStatus: 'confirmed' }), EST)).toEqual({ at: '2026-11-30', basis: 'official' });
    expect(resolveEventEnd(ev('a'), EST)).toEqual({ at: EST, basis: 'estimate' });
    expect(resolveEventEnd(ev('a'), null)).toEqual({ at: null, basis: 'unknown' });
  });

  it('an extension (new official end) moves the deadline', () => {
    const before = normalizeSheet({ fields: { end: { value: '2026-11-25', confidence: 1, source: 'official' } } });
    const after = normalizeSheet({ fields: { end: { value: '2026-12-02', confidence: 1, source: 'official' } } });
    expect(resolveEventEnd(ev('a', { sheet: before }), EST).at).toBe('2026-11-25');
    expect(resolveEventEnd(ev('a', { sheet: after }), EST).at).toBe('2026-12-02');
  });
});

describe('openEvents', () => {
  it('skips done, dismissed, cancelled, hidden, unstarted and officially over; keeps aborted', () => {
    const confirmed = { dateStatus: 'confirmed' as const };
    const events = [
      ev('open'),
      ev('done'),
      ev('dismissed'),
      ev('aborted'),
      ev('cancelled', { status: 'cancelled' }),
      ev('hidden', { hidden: true }),
      ev('future', { startDate: '2026-12-01' }),
      ev('over', { ...confirmed, endDate: '2026-11-07' }),
      ev('late-estimate', { endDate: '2026-11-07' }),
    ];
    const states = new Map([
      ['done', { status: 'done' as const }],
      ['dismissed', { status: 'dismissed' as const }],
      ['aborted', { status: 'aborted' as const }],
    ]);
    const ids = openEvents(events, states, EST, NOW).map((o) => o.event.id);
    expect(ids).toContain('open');
    expect(ids).toContain('aborted');
    expect(ids).toContain('late-estimate');
    for (const gone of ['done', 'dismissed', 'cancelled', 'hidden', 'future', 'over']) expect(ids).not.toContain(gone);
  });

  it('sorts by nearest end, unknown last; nearestEnd names the first', () => {
    const events = [ev('b', { dateStatus: 'confirmed', endDate: '2026-12-01' }), ev('a', { dateStatus: 'confirmed', endDate: '2026-11-20' }), ev('c')];
    const open = openEvents(events, new Map(), null, NOW);
    expect(open.map((o) => o.event.id)).toEqual(['a', 'b', 'c']);
    expect(nearestEnd(open)?.event.id).toBe('a');
    expect(nearestEnd([])).toBeNull();
  });
});

describe('user state and progress', () => {
  it('newest write per track wins; tiers and earned rewards follow progress', () => {
    const sheet = normalizeSheet({
      fields: {
        progress: { value: { model: 'tiers', tracks: [{ id: 'disc', label: 'Discovery', tiers: [{ at: 5, label: 'I', rewardIds: ['hat'] }, { at: 20, label: 'II', rewardIds: ['ship'] }] }] }, confidence: 1, source: 'official' },
        rewards: { value: [{ id: 'hat', name: 'Hat', trackId: 'disc', tier: 0 }, { id: 'ship', name: 'Ship', trackId: 'disc' }, { id: 'gift', name: 'Gift' }], confidence: 1, source: 'official' },
      },
    });
    let s = emptyState('e', '2026-11-08T10:00:00Z');
    s = setProgress(s, 'disc', 6, 'manual', '2026-11-08T11:00:00Z');
    expect(setProgress(s, 'disc', 99, 'live', '2026-11-08T10:30:00Z')).toBe(s);
    expect(reachedTier(sheet.fields.progress.value!.tracks[0], 6)).toBe(0);
    expect(earnedRewards(sheet, s.progress).map((r) => r.id)).toEqual(['hat', 'gift']);
    s = setProgress(s, 'disc', 21, 'live', '2026-11-08T12:00:00Z');
    expect(s.progress['disc'].source).toBe('live');
    expect(earnedRewards(sheet, s.progress).map((r) => r.id)).toEqual(['hat', 'ship', 'gift']);
  });
});

describe('isInEventArea', () => {
  const area = { kind: 'places', systems: ['stanton'], places: ['lorville'] };
  it('matches places, systems and Arena Commander as a separate venue', () => {
    expect(isInEventArea(['verse'], area, { system: 'Stanton', place: 'Lorville' })).toBeTrue();
    expect(isInEventArea(['verse'], area, { system: 'Stanton', place: 'Area 18' })).toBeFalse();
    expect(isInEventArea(['verse'], { kind: 'system', systems: ['stanton'], places: [] }, { system: 'Stanton' })).toBeTrue();
    expect(isInEventArea(['verse', 'arena-commander'], null, { arenaCommander: true })).toBeTrue();
    expect(isInEventArea(['verse'], area, { arenaCommander: true })).toBeFalse();
    expect(isInEventArea(null, { kind: 'none', systems: [], places: [] }, { system: 'Stanton' })).toBeFalse();
    expect(isInEventArea(null, { kind: 'something-new', systems: [], places: [] }, { system: 'Stanton' })).toBeFalse();
  });
});
