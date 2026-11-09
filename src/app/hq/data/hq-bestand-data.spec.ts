import type { HqCodexKindRow, HqInventoryRemovalRow, HqInventoryStack } from './hq-db.types';
import { bestandKindOf } from './hq-codex-kind';
import { buildGatherStops, gatherProgress, gatherToSteps, moveStop, nextStop, orderByAmount, parseGather, withStopDone } from './hq-gather';
import { aggregateQuality, averageLabel, qualityBands, rangeLabel, resolveStacks, takeFromStacks } from './hq-quality';
import { lastRemovals } from './hq-removals';
import { parseSellGoal, sellProgress } from '../nachschub/nachschub.model';

/** One item row: ONE per place and item with the total qty, the quality split in `stacks` (known shares only). */
const row = (location: string, name: string, qty: number, stacks: HqInventoryStack[] = [], extra: Record<string, unknown> = {}) => ({
  location,
  name,
  class_name: name.toLowerCase(),
  qty,
  unit: 'scu' as const,
  stacks,
  ...extra,
});

describe('quality stacks of an item row', () => {
  it('shows the remainder as unknown quality and keeps the sum equal to qty', () => {
    expect(resolveStacks(10, [{ quality: 600, qty: 2 }, { quality: 800, qty: 6 }])).toEqual([
      { quality: 800, qty: 6 },
      { quality: 600, qty: 2 },
      { quality: null, qty: 2 },
    ]);
    expect(resolveStacks(5, [])).toEqual([{ quality: null, qty: 5 }]); // old app: nothing known
    expect(resolveStacks(5, undefined)).toEqual([{ quality: null, qty: 5 }]);
  });

  it('ignores stale stacks above the total (an old app lowered the amount)', () => {
    expect(resolveStacks(4, [{ quality: 700, qty: 5 }, { quality: 900, qty: 3 }])).toEqual([{ quality: null, qty: 4 }]);
  });

  it('takes from the unknown remainder first, then the lowest quality; or from the named stack', () => {
    const known = [{ quality: 800, qty: 6 }, { quality: 600, qty: 2 }];
    expect(takeFromStacks(10, known, 2)).toEqual([{ quality: 800, qty: 6 }, { quality: 600, qty: 2 }]); // remainder 2 absorbs it
    expect(takeFromStacks(10, known, 3)).toEqual([{ quality: 800, qty: 6 }, { quality: 600, qty: 1 }]);
    expect(takeFromStacks(10, known, 5)).toEqual([{ quality: 800, qty: 5 }]);
    expect(takeFromStacks(10, known, 4, 800)).toEqual([{ quality: 800, qty: 2 }, { quality: 600, qty: 2 }]);
  });
});

describe('quality aggregation', () => {
  it('weights the average by amount and reports the range per place and item', () => {
    const [a] = aggregateQuality([row('Area18', 'Eisen', 10, [{ quality: 800, qty: 6 }, { quality: 600, qty: 2 }])]);
    expect(a.qty).toBe(10);
    expect(a.avg).toBe(750); // (6*800 + 2*600) / 8
    expect([a.min, a.max]).toEqual([600, 800]);
    expect(a.unknownQty).toBe(2);
    expect(a.stacks.map((s) => s.quality)).toEqual([800, 600, null]);
    expect(averageLabel(a)).toBe('Ø Q 750');
    expect(rangeLabel(a)).toBe('600–800');
  });

  it('keeps places apart but joins them with by "item"', () => {
    const rows = [row('Area18', 'Eisen', 4, [{ quality: 900, qty: 4 }]), row('Lorville', 'Eisen', 4, [{ quality: 700, qty: 4 }])];
    expect(aggregateQuality(rows).length).toBe(2);
    const [all] = aggregateQuality(rows, 'item');
    expect(all.qty).toBe(8);
    expect(all.avg).toBe(800);
  });

  it('has no average for a row without stacks (old app) and a single value as range label', () => {
    const [u] = aggregateQuality([row('A', 'Gold', 3)]);
    expect(u.avg).toBeNull();
    expect(u.unknownQty).toBe(3);
    expect(averageLabel(u)).toBeNull();
    expect(rangeLabel(u)).toBeNull();
    const [one] = aggregateQuality([row('A', 'Gold', 3, [{ quality: 512, qty: 3 }])]);
    expect(rangeLabel(one)).toBe('512');
  });

  it('puts quality reservations on their stack and "any" reservations on the item', () => {
    const [a] = aggregateQuality([
      row('A', 'Eisen', 5, [{ quality: 700, qty: 5 }], {
        reservations: [
          { amount: 2, note: 'Max', at: '2026-11-01T00:00:00Z', quality: 700 },
          { amount: 1, note: 'egal', at: '2026-11-01T00:00:00Z' },
        ],
      }),
      row('A', 'Leer', 0),
    ]);
    expect(a.reserved).toBe(3);
    expect(a.available).toBe(2);
    expect(a.stacks[0].reserved).toBe(2);
    expect(a.stacks[0].available).toBe(3);
    expect(a.anyReservations.length).toBe(1);
  });

  it('groups stacks into 100-point bands, best first', () => {
    const [a] = aggregateQuality([row('A', 'Eisen', 19, [{ quality: 100, qty: 1 }, { quality: 101, qty: 2 }, { quality: 150, qty: 3 }, { quality: 905, qty: 4 }])]);
    const bands = qualityBands(a.stacks);
    expect(bands.map((b) => [b.from, b.to, b.qty])).toEqual([
      [901, 1000, 4],
      [101, 200, 5],
      [1, 100, 1],
    ]);
  });
});

describe('last ten removals', () => {
  const man = (id: string, at: string, name: string, kind: HqInventoryRemovalRow['kind'] = 'take'): HqInventoryRemovalRow => ({
    user_id: 'u', id, at, location: 'Area18', name, class_name: null, qty: 1, unit: 'pcs', quality: null, kind,
  });

  it('orders manual removals newest first and cuts at ten', () => {
    const manual = Array.from({ length: 12 }, (_, i) => man(`r${i}`, new Date(Date.UTC(2026, 10, 1, i)).toISOString(), `Item ${i}`));
    const out = lastRemovals(manual, [], []);
    expect(out.length).toBe(10);
    expect(out[0].name).toBe('Item 11');
    expect(out[9].name).toBe('Item 2');
  });

  it('merges snapshot drops with manual removals regardless of age, newest first', () => {
    const snapEvent = {
      id: 'e1',
      type: 'inventory.snapshot',
      at: '2026-01-02T00:00:00Z', // far older than any 48 h window
      undone: false,
      applied: { previous: { snapshot: { location: 'Area18', source: 'log', taken_at: '2026-01-01T00:00:00Z' }, items: [{ name: 'Agricium', class_name: 'agricium', qty: 10, unit: 'scu' }] } },
    };
    const out = lastRemovals([man('m1', '2026-11-05T00:00:00Z', 'Pistole')], [snapEvent], [{ location: 'Area18', name: 'Agricium', class_name: 'agricium', qty: 4 }]);
    expect(out.map((r) => [r.name, r.kind, r.qty])).toEqual([
      ['Pistole', 'take', 1],
      ['Agricium', 'snapshot', 6],
    ]);
  });

  it('counts a drop once when two replaced snapshots of one place show it, and skips undone events', () => {
    const ev = (id: string, at: string, undone = false) => ({
      id, type: 'inventory.snapshot', at, undone,
      applied: { previous: { location: 'A', items: [{ name: 'Gold', class_name: 'gold', qty: 5, unit: 'scu' }] } },
    });
    const out = lastRemovals([], [ev('new', '2026-11-03T00:00:00Z'), ev('old', '2026-11-02T00:00:00Z'), ev('gone', '2026-11-04T00:00:00Z', true)], []);
    expect(out.length).toBe(1);
    expect(out[0].key).toContain('new');
  });
});

describe('gather route', () => {
  it('orders by amount, ties by place', () => {
    const o = orderByAmount([{ location: 'B', amount: 2 }, { location: 'A', amount: 2 }, { location: 'C', amount: 9 }]);
    expect(o.map((s) => s.location)).toEqual(['C', 'A', 'B']);
  });

  it('collects "10 Agricium" from the largest free amounts first and trims the last stop', () => {
    const { stops, covered } = buildGatherStops(
      [
        { location: 'Lorville', qty: 3 },
        { location: 'Area18', qty: 8 },
        { location: 'Orison', qty: 5, reservations: [{ amount: 5, note: 'x', at: '' }] }, // all reserved: skipped
        { location: 'Area18', qty: 1, quality: 900 }, // second stack of the same place merges
        { location: 'Port Olisar', qty: 4 },
      ],
      10,
    );
    expect(covered).toBe(true);
    expect(stops.map((s) => [s.location, s.amount])).toEqual([['Area18', 9], ['Port Olisar', 1]]);
    expect(stops.every((s) => !s.done)).toBe(true);
  });

  it('reports when the stock cannot cover the need', () => {
    const r = buildGatherStops([{ location: 'A', qty: 2 }], 5);
    expect(r.covered).toBe(false);
    expect(r.stops[0].amount).toBe(2);
  });

  it('reorders by the user and ticks stops one by one', () => {
    const stops = [1, 2, 3].map((n) => ({ location: `P${n}`, amount: n, done: false }));
    expect(moveStop(stops, 2, 0).map((s) => s.location)).toEqual(['P3', 'P1', 'P2']);
    const t = withStopDone(stops, 0, true);
    expect(gatherProgress(t)).toEqual({ done: 1, total: 3, complete: false });
    expect(nextStop(t)?.location).toBe('P2');
    expect(gatherProgress(withStopDone(withStopDone(t, 1, true), 2, true)).complete).toBe(true);
  });

  it('turns stops into one pickup step each, in route order', () => {
    const steps = gatherToSteps({ id: 'L1', name: 'Agricium', className: 'agricium' }, [
      { location: 'Area18', system: 'Stanton', amount: 6.5, done: true },
      { location: 'Lorville', amount: 4, done: false },
    ]);
    expect(steps.map((s) => [s.kind, s.location, s.qty, s.state, s.supply_id])).toEqual([
      ['pickup', 'Area18', 7, 'done', 'L1'],
      ['pickup', 'Lorville', 4, 'todo', 'L1'],
    ]);
  });

  it('parses stored stops defensively', () => {
    expect(parseGather('x')).toBeNull();
    expect(parseGather([{ location: '', amount: 3 }, { location: 'A', amount: -1 }])).toBeNull();
    expect(parseGather([{ location: 'A', amount: '2.5', quality: 2000, done: true }])).toEqual([{ location: 'A', system: null, amount: 2.5, done: true }]);
  });
});

describe('codex kind mapping', () => {
  const kind = (o: Partial<HqCodexKindRow>): HqCodexKindRow => ({
    class_name: 'x', entity: 'item', attach_type: null, sub_type: null, weapon_class: null, role: null, career: null, ...o,
  });

  it('maps armour slots, personal weapon classes and ship roles', () => {
    expect(bestandKindOf(kind({ attach_type: 'Char_Armor_Helmet' }))).toEqual({ area: 'armor', sub: 'helmet', role: null });
    expect(bestandKindOf(kind({ attach_type: 'Char_Armor_Backpack' })).sub).toBe('backpack');
    expect(bestandKindOf(kind({ entity: 'weapon', weapon_class: 'FPS', sub_type: 'Small' }))).toEqual({ area: 'weapons', sub: 'sidearm', role: null });
    expect(bestandKindOf(kind({ entity: 'weapon', weapon_class: 'FPS', sub_type: 'Knife' })).sub).toBe('melee');
    expect(bestandKindOf(kind({ entity: 'weapon', weapon_class: 'FPS', sub_type: 'Weird' })).sub).toBe('other');
    expect(bestandKindOf(kind({ entity: 'ship', career: '@vehicle_focus_Transporter' }))).toEqual({ area: 'ship', sub: null, role: 'transport' });
  });

  it('puts ship weapons, plain items and unknown classes into "other"', () => {
    expect(bestandKindOf(kind({ entity: 'weapon', weapon_class: 'Ship', attach_type: 'WeaponGun' })).area).toBe('other');
    expect(bestandKindOf(kind({ attach_type: 'Food' })).area).toBe('other');
    expect(bestandKindOf(null)).toEqual({ area: 'other', sub: null, role: null });
  });
});

describe('Verkauf goal', () => {
  it('parses whole aUEC goals and computes progress', () => {
    expect(parseSellGoal('1.500.000')).toBe(1_500_000);
    expect(parseSellGoal(0)).toBeNull();
    expect(parseSellGoal(1e13)).toBeNull();
    expect(sellProgress({ type: 'verkauf', goalAuec: 1000, progressAuec: 250 })).toEqual({ earned: 250, goal: 1000, share: 0.25, reached: false });
    expect(sellProgress({ type: 'normal', goalAuec: null })).toBeNull();
    expect(sellProgress({ type: 'verkauf', goalAuec: 100, progressAuec: 500 })?.reached).toBe(true);
  });
});
