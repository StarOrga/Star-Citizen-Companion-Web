import { defaultAmount, expiryFromField, expiryToField, freeForQuality, indexedReservations, reservationFriends, reserveTarget } from './hq-reserve';
import { NO_DECK_FILTER, crateMatches, type DeckCrate } from './hq-stock-deck';

function crate(over: Partial<DeckCrate> = {}): DeckCrate {
  return {
    key: 'k', location: 'area18', name: 'Eisen', className: 'iron', unit: 'scu', qty: 15, reserved: 5, available: 10,
    anyReservations: [{ amount: 1, note: '', at: '2026-01-01', friendId: 'f-any' }], knownQty: 15, unknownQty: 0, avg: 800, min: 600, max: 900, kind: 'materials', sub: 'refined',
    stacks: [
      { quality: 900, qty: 9, reserved: 4, available: 5, reservations: [{ amount: 4, note: 'x', at: '2026-01-02', friendId: 'f-1', quality: 900 }] },
      { quality: 600, qty: 6, reserved: 0, available: 6, reservations: [] },
    ],
    ...over,
  } as DeckCrate;
}

describe('hq-reserve (D2 / I8)', () => {
  it('needs a friend or a text', () => {
    expect(reserveTarget({ friendId: null, note: '  ', quality: null, expiryDay: '' })).toBeNull();
    expect(reserveTarget({ friendId: 'f', note: '', quality: 900, expiryDay: '' })).toEqual({ note: '', friendId: 'f', quality: 900, expiresAt: null });
    expect(reserveTarget({ friendId: null, note: ' Crew ', quality: null, expiryDay: '' })?.note).toBe('Crew');
  });

  it('maps the expiry day to the end of that local day and back', () => {
    const iso = expiryFromField('2026-12-24');
    expect(iso).not.toBeNull();
    expect(expiryToField(iso)).toBe('2026-12-24');
    expect(expiryFromField('')).toBeNull();
    expect(expiryFromField('24.12.2026')).toBeNull();
    expect(expiryToField(null)).toBe('');
  });

  it('defaults the amount to the free amount of the chosen stack', () => {
    const c = crate();
    expect(defaultAmount(c)).toBe(10);
    expect(freeForQuality(c, 900)).toBe(5);
    expect(freeForQuality(c, 600)).toBe(6);
    expect(freeForQuality(c, 123)).toBe(0);
  });

  it('indexes the stored reservations for endReservation', () => {
    const list = indexedReservations({ reservations: [{ amount: 2, note: 'a', at: '1' }, { amount: 0, note: 'dead', at: '2' }, { amount: 3, note: 'b', at: '3' }] });
    expect(list.map((r) => r.note)).toEqual(['a', 'b']);
    expect(list.map((r) => r.index)).toEqual([0, 1]);
    expect(indexedReservations(undefined)).toEqual([]);
  });

  it('groups the Reserviert view by friend', () => {
    const second = crate({ key: 'k2', anyReservations: [], stacks: [{ quality: 900, qty: 1, reserved: 1, available: 0, reservations: [{ amount: 1, note: '', at: '3', friendId: 'f-1', quality: 900 }] }] });
    expect(reservationFriends([crate(), second])).toEqual([{ id: 'f-1', count: 2 }, { id: 'f-any', count: 1 }]);
    const f = { ...NO_DECK_FILTER, reserved: true, friend: 'f-any' };
    expect(crateMatches(crate(), f, () => false)).toBeTrue();
    expect(crateMatches(second, f, () => false)).toBeFalse();
  });
});
