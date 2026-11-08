import { NO_FILTER, buildOverview, categoryOf, filterStock, nextWindow, stockLines, STOCK_PAGE, StockItem } from './hq-stock-model';

const NOW = Date.parse('2026-11-05T12:00:00Z');
const ago = (d: number) => new Date(NOW - d * 86_400_000).toISOString();
const row = (location: string, name: string, qty: number, unit: 'pcs' | 'scu' = 'pcs', class_name: string | null = null): StockItem => ({
  location, name, qty, unit, class_name,
});

describe('hq-stock-model', () => {
  it('maps categories only from unit and class name; the rest is other', () => {
    expect(categoryOf({ unit: 'scu', class_name: null })).toBe('materials');
    expect(categoryOf({ unit: 'pcs', class_name: 'KLWE_LaserRepeater_S1' })).toBe('weapons');
    expect(categoryOf({ unit: 'pcs', class_name: 'ARGO_Helmet_01' })).toBe('armor');
    expect(categoryOf({ unit: 'pcs', class_name: 'ITEM_X' })).toBe('other');
    expect(categoryOf({ unit: 'pcs', class_name: null })).toBe('other');
  });

  it('builds the overview: top places, place-free, stale places, categories', () => {
    const rows = [row('A', 'x', 1), row('A', 'y', 1), row('B', 'z', 1, 'scu'), row('', 'free', 1)];
    const ov = buildOverview(rows, [{ location: 'A', takenAt: ago(1) }, { location: 'B', takenAt: ago(9) }], 5, NOW);
    expect(ov.items).toBe(4);
    expect(ov.places).toBe(2);
    expect(ov.top.map((p) => p.location)).toEqual(['A', 'B']);
    expect(ov.free).toBe(1);
    expect(ov.stale.map((p) => p.location)).toEqual(['B']);
    expect(ov.cats).toEqual([{ cat: 'materials', count: 1 }, { cat: 'other', count: 3 }]);
  });

  it('filters by text, place, category and stale', () => {
    const rows = [row('A', 'Gold', 3, 'scu'), row('B', 'Helm', 1, 'pcs', 'X_Helmet_1')];
    const places = [{ location: 'A', takenAt: ago(9) }, { location: 'B', takenAt: ago(1) }];
    expect(filterStock(rows, { ...NO_FILTER, q: 'gol' }, places, NOW).length).toBe(1);
    expect(filterStock(rows, { ...NO_FILTER, place: 'B' }, places, NOW)[0].name).toBe('Helm');
    expect(filterStock(rows, { ...NO_FILTER, cat: 'armor' }, places, NOW)[0].name).toBe('Helm');
    expect(filterStock(rows, { ...NO_FILTER, stale: true }, places, NOW)[0].name).toBe('Gold');
  });

  it('groups by place with the place-free group last, by name with places beneath, by quantity flat', () => {
    const rows = [row('B', 'x', 1), row('', 'free', 2), row('A', 'x', 5), row('A', 'y', 2)];
    const place = stockLines(rows, 'place').filter((l) => l.kind === 'head').map((l) => (l.kind === 'head' ? l.location : null));
    expect(place).toEqual(['A', 'B', '']);
    const byName = stockLines(rows, 'name');
    const xHead = byName.findIndex((l) => l.kind === 'head' && l.title === 'x');
    const firstRow = byName[xHead + 1];
    expect(firstRow.kind === 'row' ? firstRow.row.location : null).toBe('A');
    const qty = stockLines(rows, 'qty');
    expect(qty.every((l) => l.kind === 'row')).toBe(true);
    const q0 = qty[0];
    expect(q0.kind === 'row' ? q0.row.qty : null).toBe(5);
  });

  it('grows the render window in steps up to the total', () => {
    expect(nextWindow(STOCK_PAGE, 1000)).toBe(STOCK_PAGE * 2);
    expect(nextWindow(STOCK_PAGE, 70)).toBe(70);
  });
});
