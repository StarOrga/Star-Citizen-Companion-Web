import type { StockItem } from './hq-stock-model';
import { USED_UP_WINDOW_MS, buildTiles, categoryCounts, filterTiles, pageOf, usedUpRecently } from './hq-stock-tiles';

const row = (location: string, name: string, qty: number, class_name: string | null = null, unit: 'pcs' | 'scu' = 'pcs'): StockItem => ({
  location,
  name,
  qty,
  class_name,
  unit,
});

describe('buildTiles', () => {
  const rows = [
    row('Cutlass Black', 'Medpen', 2, 'medpen'),
    row('Lorville', 'Medpen', 5, 'medpen'),
    row('Lorville', 'P4-AR', 1, 'ksar_rifle_p4ar'),
    row('', 'Aluminium', 0.5, 'aluminium', 'scu'),
    row('Blueprints', 'Gallant', 1, 'gallant_bp'),
    row('Lorville', 'Leer', 0, 'empty'),
  ];

  it('folds one thing over all places, largest stack first', () => {
    const t = buildTiles(rows, 'Blueprints');
    const medpen = t.find((x) => x.key === 'medpen')!;
    expect(medpen.qty).toBe(7);
    expect(medpen.places).toEqual(['Lorville', 'Cutlass Black']);
  });

  it('skips the Sammlung place and empty rows, keeps place-free rows without a place', () => {
    const t = buildTiles(rows, 'Blueprints');
    expect(t.map((x) => x.key)).toEqual(['medpen', 'ksar_rifle_p4ar', 'aluminium']);
    expect(t[2].places).toEqual([]);
    expect(t[2].unit).toBe('scu');
  });

  it('filters by category and text and counts categories', () => {
    const t = buildTiles(rows, 'Blueprints');
    expect(filterTiles(t, 'weapons', '').map((x) => x.key)).toEqual(['ksar_rifle_p4ar']);
    expect(filterTiles(t, null, 'MED').map((x) => x.key)).toEqual(['medpen']);
    expect(categoryCounts(t).get('materials')).toBe(1);
  });
});

describe('usedUpRecently', () => {
  const now = Date.parse('2026-11-07T12:00:00Z');
  const ev = (hoursAgo: number, location: string, items: { name: string; class_name: string | null; qty: number }[], extra: Record<string, unknown> = {}) => ({
    type: 'inventory.snapshot',
    at: new Date(now - hoursAgo * 3_600_000).toISOString(),
    undone: false,
    applied: {
      kind: 'snapshot',
      replaced: true,
      previous: { snapshot: { location, source: 'ocr', taken_at: new Date(now - 90 * 3_600_000).toISOString() }, items: items.map((i) => ({ ...i, unit: 'pcs' })) },
      ...extra,
    },
  });
  const current = [row('Cutlass Black', 'Medpen', 10, 'medpen'), row('Cutlass Black', 'P4-AR-Magazin', 2, 'p4ar_mag')];

  it('reports what fell between the replaced snapshot and now at the same place', () => {
    const out = usedUpRecently([ev(31, 'Cutlass Black', [{ name: 'P4-AR-Magazin', class_name: 'p4ar_mag', qty: 5 }, { name: 'Medpen', class_name: 'medpen', qty: 10 }])], current, now);
    expect(out.map((u) => [u.key, u.qty])).toEqual([['p4ar_mag', 3]]);
  });

  it('counts a thing that is gone completely and sums the drops of several snapshots', () => {
    const out = usedUpRecently(
      [ev(2, 'Cutlass Black', [{ name: 'Granate', class_name: 'nade', qty: 2 }]), ev(30, 'Cutlass Black', [{ name: 'Granate', class_name: 'nade', qty: 1 }])],
      current,
      now,
    );
    expect(out).toEqual([jasmine.objectContaining({ key: 'nade', qty: 3 })]);
  });

  it('ignores snapshots older than 48 hours, undone ones and other event types', () => {
    const old = ev(USED_UP_WINDOW_MS / 3_600_000 + 1, 'Cutlass Black', [{ name: 'X', class_name: 'x', qty: 3 }]);
    const undone = { ...ev(3, 'Cutlass Black', [{ name: 'Y', class_name: 'y', qty: 3 }]), undone: true };
    const other = { ...ev(3, 'Cutlass Black', [{ name: 'Z', class_name: 'z', qty: 3 }]), type: 'shop.purchase' };
    expect(usedUpRecently([old, undone, other], current, now)).toEqual([]);
  });

  it('skips snapshots without a replaced one', () => {
    expect(usedUpRecently([{ type: 'inventory.snapshot', at: new Date(now - 3_600_000).toISOString(), undone: false, applied: { kind: 'snapshot', previous: null } }], current, now)).toEqual([]);
  });
});

describe('pageOf', () => {
  it('pages a list and clamps the page', () => {
    const list = Array.from({ length: 43 }, (_, i) => i);
    expect(pageOf(list, 0, 22)).toEqual(jasmine.objectContaining({ from: 1, to: 22, pages: 2, total: 43 }));
    expect(pageOf(list, 9, 22)).toEqual(jasmine.objectContaining({ page: 1, from: 23, to: 43 }));
    expect(pageOf([], 0, 5)).toEqual(jasmine.objectContaining({ from: 0, to: 0, pages: 1 }));
  });
});
