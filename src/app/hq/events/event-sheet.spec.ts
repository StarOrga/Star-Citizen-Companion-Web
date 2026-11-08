import {
  SHEET_CONFIDENCE_MIN,
  approveField,
  emptySheet,
  gateSheet,
  normalizeSheet,
  pendingFields,
  prereqGear,
  publicSheet,
  setByAdmin,
  validateSheet,
} from './event-sheet';

const f = (value: unknown, confidence = 0.9, review = 'auto') => ({ value, confidence, source: 'ai', review });

describe('event-sheet', () => {
  it('turns garbage into an all-unknown sheet and never throws', () => {
    for (const raw of [null, 42, 'x', [], { fields: 3 }]) {
      const s = normalizeSheet(raw);
      expect(s.fields.rewards.value).toBeNull();
      expect(s.fields.end.value).toBeNull();
    }
  });

  it('keeps open-ended ids (venue, area kind, progress model) instead of locking them', () => {
    const s = normalizeSheet({
      schema: 1,
      fields: {
        venues: f(['Verse', 'Arena Commander', 'Mars Rover Race']),
        area: f({ kind: 'Orbit Ring', systems: ['Stanton'], places: ['Lorville', 'Area 18'] }),
        progress: f({ model: 'Seasonal Ladder', tracks: [] }),
      },
    });
    expect(s.fields.venues.value).toEqual(['verse', 'arena-commander', 'mars-rover-race']);
    expect(s.fields.area.value).toEqual({ kind: 'orbit-ring', systems: ['stanton'], places: ['lorville', 'area-18'] });
    expect(s.fields.progress.value?.model).toBe('seasonal-ladder');
  });

  it('sorts tiers, keeps reward channel/timing and falls back to unknown', () => {
    const s = normalizeSheet({
      fields: {
        progress: f({ model: 'tiers', tracks: [{ id: 'Discovery', label: 'Discovery', tiers: [{ at: 20, label: 'B' }, { at: 5, label: 'A' }] }] }),
        rewards: f([
          { id: 'keelback', name: 'Keelback', className: 'DRAK_Cutlass', channel: 'pledge', timing: { kind: 'after-end' }, trackId: 'discovery', tier: 1 },
          { name: 'Hat', channel: 'weird', timing: { kind: 'date', date: 'not a date' } },
        ]),
      },
    });
    expect(s.fields.progress.value?.tracks[0].tiers.map((t) => t.at)).toEqual([5, 20]);
    const [a, b] = s.fields.rewards.value!;
    expect(a.channel).toBe('pledge');
    expect(a.timing.kind).toBe('after-end');
    expect(b.channel).toBe('unknown');
    expect(b.timing).toEqual({ kind: 'unknown', date: null });
    expect(b.id).toBe('reward-2');
  });

  it('prerequisites: AND/OR groups of gear, never patch or game package', () => {
    const s = normalizeSheet({
      fields: {
        prerequisites: f({
          op: 'and',
          items: [
            { gear: 'Alpha 4.10.2' },
            { gear: 'game package' },
            { op: 'or', items: [{ gear: 'fps-combat-set' }, { gear: 'combat-ship' }] },
            { gear: 'salvage-ship' },
          ],
        }),
      },
    });
    const p = s.fields.prerequisites.value!;
    expect(p).toEqual({
      op: 'and',
      items: [{ op: 'or', items: [{ gear: 'fps-combat-set', label: null }, { gear: 'combat-ship', label: null }] }, { gear: 'salvage-ship', label: null }],
    });
    expect(prereqGear(p)).toEqual(['fps-combat-set', 'combat-ship', 'salvage-ship']);
    expect(normalizeSheet({ fields: { prerequisites: f({ gear: 'patch-4-10' }) } }).fields.prerequisites.value).toBeNull();
  });

  it('review gate: below 0.8 is pending and hidden publicly; approved passes; admin edit wins', () => {
    let s = normalizeSheet({ fields: { end: f('2026-11-20', 0.5), start: f('2026-11-01', 0.95), venues: f(['verse'], SHEET_CONFIDENCE_MIN) } });
    s = gateSheet(s);
    expect(pendingFields(s)).toEqual(['end']);
    expect(publicSheet(s).fields.end.value).toBeNull();
    expect(publicSheet(s).fields.start.value).toBe('2026-11-01');
    expect(publicSheet(s).fields.venues.value).toEqual(['verse']);
    expect(publicSheet(approveField(s, 'end')).fields.end.value).toBe('2026-11-20');
    const edited = setByAdmin(s, 'end', '2026-12-01');
    expect(edited.fields.end).toEqual({ value: '2026-12-01', confidence: 1, source: 'admin', review: 'edited' });
    expect(pendingFields(gateSheet(edited))).toEqual([]);
  });

  it('validateSheet reports rejected values and out-of-range confidence', () => {
    const { issues } = validateSheet({ fields: { end: f('tomorrow', 3) } });
    expect(issues).toEqual(['end: value rejected', 'end: confidence out of range']);
    expect(validateSheet({}).issues.length).toBe(1);
    expect(emptySheet().fields.tasks.value).toBeNull();
  });
});
