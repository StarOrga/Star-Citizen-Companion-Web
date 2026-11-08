import { EvalLine, RisePool, WISH_QTY_MAX, evaluateNachschub, wishOverflow } from './nachschub.model';
import { stockMatches, stockQtyOf } from './nachschub-stock';

const line = (id: string, className: string, need: number, ticked = false, ship = false): EvalLine => ({ id, need, ticked, ship, className });

describe('shared stock gain (H4)', () => {
  it('one gained unit closes only the oldest of two lines asking for the same class', () => {
    const pool: RisePool = new Map();
    const stock = { laser: 1 };
    const owned = (l: EvalLine) => stock[l.className as 'laser'];
    const a = evaluateNachschub([line('a', 'laser', 1)], { a: 0 }, owned, pool);
    const b = evaluateNachschub([line('b', 'laser', 1)], { b: 0 }, owned, pool);
    expect(a.closeIds).toEqual(['a']);
    expect(b.closeIds).toEqual([]);
    expect(b.statuses.get('b')?.rise).toBe(0);
  });

  it('shares across lines of one Nachschub and keeps the share of a line that already closed', () => {
    const owned = () => 2;
    // a is already done (closed by an earlier pass), b and c are open; stock rose by 2 against a baseline of 0.
    const ev = evaluateNachschub([line('a', 'x', 1, true), line('b', 'x', 1), line('c', 'x', 1)], { a: 0, b: 0, c: 0 }, owned, new Map());
    expect(ev.closeIds).toEqual(['b']);
    expect(ev.statuses.get('c')?.closed).toBeFalse();
  });

  it('a partly filled older line still takes its share (the rest is what is left for the next line)', () => {
    const ev = evaluateNachschub([line('a', 'x', 3), line('b', 'x', 1)], { a: 0, b: 0 }, () => 2, new Map());
    expect(ev.statuses.get('a')?.rise).toBe(2);
    expect(ev.statuses.get('b')?.rise).toBe(0);
    expect(ev.closeIds).toEqual([]);
  });

  it('a newer line counts from its own baseline: what an older line took below it never blocks it', () => {
    // A (line of 2, baseline 0) closed at stock 2; B was planned at stock 2 with a line of 1; stock is now 3.
    const pool: RisePool = new Map();
    const a = evaluateNachschub([line('a', 'x', 2, true)], { a: 0 }, () => 3, pool);
    const b = evaluateNachschub([line('b', 'x', 1)], { b: 2 }, () => 3, pool);
    expect(a.statuses.get('a')?.rise).toBe(3);
    expect(b.closeIds).toEqual(['b']);
  });

  it('two lines on the same baseline still share one gain after the fix (H4 kept)', () => {
    const pool: RisePool = new Map();
    const a = evaluateNachschub([line('a', 'x', 2)], { a: 5 }, () => 7, pool);
    const b = evaluateNachschub([line('b', 'x', 2)], { b: 5 }, () => 7, pool);
    expect(a.closeIds).toEqual(['a']);
    expect(b.statuses.get('b')?.rise).toBe(0);
  });

  it('different classes and ship vs item do not share', () => {
    const pool: RisePool = new Map();
    const ev = evaluateNachschub([line('a', 'x', 1), line('b', 'y', 1), line('c', 'x', 1, false, true)], { a: 0, b: 0, c: 0 }, () => 1, pool);
    expect(ev.closeIds).toEqual(['a', 'b', 'c']);
  });

  it('without a pool every line sees the full rise (single-Nachschub callers)', () => {
    const ev = evaluateNachschub([line('a', 'x', 1), line('b', 'x', 1)], { a: 0, b: 0 }, () => 1);
    expect(ev.closeIds).toEqual(['a', 'b']);
  });
});

describe('baseline follows the stock down (M1)', () => {
  it('lowers a baseline above the current stock and reports the snapshot as changed', () => {
    const ev = evaluateNachschub([line('a', 'x', 5)], { a: 10 }, () => 0);
    expect(ev.snapshot['a']).toBe(0);
    expect(ev.snapshotChanged).toBeTrue();
  });

  it('a later purchase then closes the line', () => {
    const lowered = evaluateNachschub([line('a', 'x', 5)], { a: 10 }, () => 0).snapshot;
    const ev = evaluateNachschub([line('a', 'x', 5)], lowered, () => 5);
    expect(ev.closeIds).toEqual(['a']);
  });

  it('keeps a baseline at or below the stock untouched', () => {
    const snap = { a: 2 };
    const ev = evaluateNachschub([line('a', 'x', 5)], snap, () => 3);
    expect(ev.snapshot).toBe(snap);
    expect(ev.snapshotChanged).toBeFalse();
  });

  it('a line without a baseline starts at the current stock (migrated lines)', () => {
    const ev = evaluateNachschub([line('a', 'x', 1)], {}, () => 4);
    expect(ev.snapshot['a']).toBe(4);
    expect(ev.closeIds).toEqual([]);
  });
});

describe('wishOverflow (L1)', () => {
  it('counts what does not fit under the 999 cap', () => {
    expect(wishOverflow(600, 600)).toBe(201);
    expect(wishOverflow(10, 5)).toBe(0);
    expect(wishOverflow(WISH_QTY_MAX, 1)).toBe(1);
  });
});

describe('stock matching (AUD-8)', () => {
  const row = (class_name: string | null, qty: number) => ({ class_name, qty });
  const CRATE = 'Carryable_TBO_FL_32SCU_Commodity_Metal_Iron';
  const ORE = 'Carryable_TBO_FL_32SCU_Commodity_Ore_Iron';

  it('a manual row (kind:Class) counts like a bare class name', () => {
    expect(stockQtyOf([row('weapon:Laser_S1', 2), row('Laser_S1', 1), row('item:Other', 5)], 'laser_s1')).toBe(3);
  });

  it('a material line counts the cargo crates of that ingredient, not ore', () => {
    expect(stockQtyOf([row(CRATE, 4), row(`item:${CRATE}`, 1), row(ORE, 9)], 'Iron')).toBe(5);
    expect(stockMatches(ORE, 'Iron')).toBeFalse();
    expect(stockMatches(ORE, 'Iron_Ore')).toBeFalse();
  });

  it('an exact crate class still matches itself', () => {
    expect(stockQtyOf([row(CRATE, 3)], CRATE)).toBe(3);
  });

  it('ignores rows without a class and bad quantities', () => {
    expect(stockQtyOf([row(null, 3), row('', 3), { class_name: 'x', qty: 'abc' }], 'x')).toBe(0);
    expect(stockMatches('x', '')).toBeFalse();
  });
});
