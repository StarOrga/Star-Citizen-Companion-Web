import {
  armorSlotsFromLoadout,
  computeReadiness,
  roleSlotForAttachType,
  sortByRecency,
  withSelectedFirst,
  type EntityPayloadEntry,
} from './codex-landing-kpi';

describe('armorSlotsFromLoadout', () => {
  it('resolves the six anatomical positions from a free-form item list, open ones as null', () => {
    const slots = armorSlotsFromLoadout([
      { slot: 'helmet', className: 'P4-AR_Ballistic' },
      { slot: 'core', className: 'Outland_Miner_Torso' },
      { slot: 'legs', className: 'Novikov_Legschutz' },
      { slot: 'primary', className: 'behr_rifle_ballistic_01' },
    ]);
    expect(slots.map((s) => [s.roleSlot, s.className])).toEqual([
      ['helmet', 'P4-AR_Ballistic'],
      ['core', 'Outland_Miner_Torso'],
      ['arms', null],
      ['legs', 'Novikov_Legschutz'],
      ['undersuit', null],
      ['backpack', null],
    ]);
  });
});

describe('sortByRecency', () => {
  it('orders by updatedAt descending (newest first)', () => {
    const items = [
      { id: 'a', updatedAt: '2026-08-01T00:00:00Z' },
      { id: 'b', updatedAt: '2026-08-10T00:00:00Z' },
      { id: 'c', updatedAt: '2026-08-05T00:00:00Z' },
    ];
    expect(sortByRecency(items).map((i) => i.id)).toEqual(['b', 'c', 'a']);
  });
});

// Admin feedback 34505d70 ("2A"): the standalone /hangar/loadout/:id editor was
// retired, so "which set am I looking at" moved into the Codex landing's URL
// (`?set=`). Position 0 of this list IS the active set, which makes the
// reordering below the whole selection mechanism — worth locking down.
describe('withSelectedFirst', () => {
  const sets = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];

  it('leaves the order alone when nothing is selected', () => {
    expect(withSelectedFirst(sets, null).map((s) => s.id)).toEqual(['a', 'b', 'c']);
  });

  it('pulls the named set to the front and keeps the rest in order', () => {
    expect(withSelectedFirst(sets, 'c').map((s) => s.id)).toEqual(['c', 'a', 'b']);
  });

  it('is a no-op for the set that already leads', () => {
    expect(withSelectedFirst(sets, 'a').map((s) => s.id)).toEqual(['a', 'b', 'c']);
  });

  it('ignores an id that no longer resolves, rather than emptying the zone', () => {
    // A bookmark from the retired editor pointing at a deleted set.
    expect(withSelectedFirst(sets, 'gone').map((s) => s.id)).toEqual(['a', 'b', 'c']);
  });

  it('never hands back the caller array', () => {
    expect(withSelectedFirst(sets, 'b')).not.toBe(sets as unknown as { id: string }[]);
  });
});

describe('roleSlotForAttachType', () => {
  it('maps every anatomical attach_type to the role slot the set stores', () => {
    expect(roleSlotForAttachType('Char_Armor_Helmet')).toBe('helmet');
    expect(roleSlotForAttachType('Char_Armor_Torso')).toBe('core');
    expect(roleSlotForAttachType('Char_Armor_Backpack')).toBe('backpack');
  });

  it('refuses everything else, so the equip control cannot invent a slot', () => {
    // Ship hull armour — deliberately NOT a personal-armour attach type.
    expect(roleSlotForAttachType('Armor')).toBeNull();
    expect(roleSlotForAttachType(null)).toBeNull();
    expect(roleSlotForAttachType('')).toBeNull();
  });
});

describe('computeReadiness', () => {
  const weapon = (subType: string): EntityPayloadEntry => ({ kind: 'weapon', payload: { subType } }) as EntityPayloadEntry;
  const on = (slots: { key: string; ok: boolean }[]) => slots.filter((s) => s.ok).map((s) => s.key);

  it('classifies guns, blades and tools by their sub-type', () => {
    const payloads = new Map<string, EntityPayloadEntry>([
      ['behr_rifle_ballistic_01', weapon('Medium')],
      ['klwe_pistol_energy_01', weapon('Small')],
      ['grin_multitool_01', weapon('Gadget')],
    ]);
    const items = [...payloads.keys()].map((className) => ({ className }));
    expect(on(computeReadiness(items, payloads))).toEqual(['primary', 'secondary', 'gadget']);
  });

  it('counts the ParaMed as medical, not as a second pistol', () => {
    const payloads = new Map<string, EntityPayloadEntry>([['crlf_medgun_01', weapon('Small')]]);
    expect(on(computeReadiness([{ className: 'crlf_medgun_01' }], payloads))).toEqual(['medical']);
  });
});
