import { availableOf, parseAmount, reservationsOf, reservedOf, takeOut } from './hq-stock-counter';

describe('hq-stock-counter', () => {
  const at = '2026-11-07T20:00:00.000Z';

  it('reads reservations defensively (missing column, bad entries)', () => {
    expect(reservationsOf({})).toEqual([]);
    expect(reservationsOf({ reservations: null })).toEqual([]);
    expect(reservationsOf({ reservations: [{ amount: 0, note: 'x', at }, { amount: 2, note: 'Spieler X', at }] })).toEqual([
      { amount: 2, note: 'Spieler X', at },
    ]);
  });

  it('available = amount minus reserved, never below zero', () => {
    const row = { qty: 5, reservations: [{ amount: 1.5, note: 'a', at }, { amount: 1, note: 'b', at }] };
    expect(reservedOf(row)).toBe(2.5);
    expect(availableOf(row)).toBe(2.5);
    expect(availableOf({ qty: 1, reservations: [{ amount: 3, note: 'a', at }] })).toBe(0);
  });

  it('parses amounts: pieces whole, SCU fractions, comma decimals', () => {
    expect(parseAmount('2,5', 'scu')).toBe(2.5);
    expect(parseAmount('2.6', 'pcs')).toBe(3);
    expect(parseAmount('0', 'pcs')).toBeNull();
    expect(parseAmount('abc', 'scu')).toBeNull();
    expect(parseAmount(0.2, 'pcs')).toBeNull();
  });

  it('takes free stock first, then shrinks the newest reservations', () => {
    const res = [{ amount: 2, note: 'old', at }, { amount: 2, note: 'new', at }];
    expect(takeOut(10, res, 3)).toEqual({ qty: 7, reservations: res });
    expect(takeOut(10, res, 7)).toEqual({ qty: 3, reservations: [{ amount: 2, note: 'old', at }, { amount: 1, note: 'new', at }] });
    expect(takeOut(10, res, 9)).toEqual({ qty: 1, reservations: [{ amount: 1, note: 'old', at }] });
    expect(takeOut(10, res, 12)).toEqual({ qty: 0, reservations: [] });
  });
});
