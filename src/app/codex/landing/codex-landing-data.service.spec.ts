import { LandingPaint } from './codex-landing-data.types';
import {
  classCohort,
  dedupeByName,
  factsFor,
  withClassStats,
  isNewPaint,
  overviewFor,
  paintRecency,
  pickNewest,
  pickPatchThread,
  sortPaints,
  topValuesFor,
  MAX_TOP_VALUES,
  NEW_PAINT_DAYS,
} from './codex-landing-data.service';

const paint = (id: string, name: string, recencyAt: string): LandingPaint => ({
  id,
  name,
  imageUrl: 'https://x/y.jpg',
  rsiUrl: null,
  recencyAt,
  isNew: false,
});

describe('codex-landing-data pure helpers', () => {
  it('pickNewest prefers the first class the previous build lacked', () => {
    expect(pickNewest(['a', 'b', 'c'], new Set(['a', 'b']))).toBe('c');
    expect(pickNewest(['a', 'b'], new Set(['a', 'b']))).toBe('a');
    expect(pickNewest(['a', 'b'], null)).toBe('a');
    expect(pickNewest([], null)).toBeNull();
  });

  it('topValuesFor ships: curated order, skips missing and zero, caps at 7', () => {
    const v = topValuesFor('ship', { flight: { scmSpeed: 210, maxSpeed: 0 }, hull: { hp: 5000, mass: null }, cargoScu: 4, crew: { size: 1 } });
    expect(v.map((x) => x.key)).toEqual(['flight.scmSpeed', 'hull.hp', 'cargoScu', 'crew.size']);
    expect(v[0].unit).toBe('m/s');
  });

  it('topValuesFor other kinds: weaponParams then stats, no energy plumbing, max 7', () => {
    const weaponParams: Record<string, number> = {};
    for (let i = 0; i < 10; i++) weaponParams['p' + i] = i + 1;
    expect(topValuesFor('fpsWeapon', { weaponParams }).length).toBe(MAX_TOP_VALUES);
    const v = topValuesFor('component', { stats: { ItemResourceComponentParams: { 'online.x': 5 }, SHealthComponentParams: { Health: 90 } } });
    expect(v).toEqual([{ key: 'stats.SHealthComponentParams.Health', value: 90, unit: null }]);
    expect(topValuesFor('tool', null)).toEqual([]);
  });

  it('overviewFor follows the brief per category', () => {
    const row = { size: 2, grade: 'A', subType: 'Rifle', attachType: 'Char_Armor_Helmet', weaponClass: 'FPS', componentKind: 'Shield', role: null };
    expect(overviewFor('fpsWeapon', row, 'Behring', null).map((f) => f.id)).toEqual(['type', 'size', 'manufacturer']);
    expect(overviewFor('armor', row, 'CDS', null)[0]).toEqual({ id: 'part', value: 'Helmet' });
    expect(overviewFor('component', row, 'X', null).map((f) => f.value)).toEqual(['Shield', 'S2', 'A']);
    expect(overviewFor('ship', row, 'Aegis', 'Fighter').map((f) => f.id)).toEqual(['role', 'size', 'manufacturer']);
  });

  it('paints: recency fallback, newest-first stable order, neu flag window', () => {
    expect(paintRecency(null, '2026-01-01')).toBe('2026-01-01');
    expect(paintRecency('2026-02-01', '2026-01-01')).toBe('2026-02-01');
    const sorted = sortPaints([paint('1', 'B', '2026-01-01'), paint('2', 'A', '2026-03-01'), paint('3', 'C', '2026-03-01')]);
    expect(sorted.map((p) => p.id)).toEqual(['2', '3', '1']);
    const now = Date.parse('2026-10-29T00:00:00Z');
    expect(isNewPaint('2026-10-20T00:00:00Z', now)).toBeTrue();
    expect(isNewPaint(new Date(now - (NEW_PAINT_DAYS + 1) * 86_400_000).toISOString(), now)).toBeFalse();
    expect(isNewPaint('garbage', now)).toBeFalse();
  });

  it('pickPatchThread: exact thread, else the line\'s live thread, else null', () => {
    const groups = [
      {
        line: '4.4',
        entries: [
          { version: '4.4.1', stage: 'live', item: { url: 'https://rsi/441' } },
          { version: '4.4.0', stage: 'ptu', item: { url: 'https://rsi/440ptu' } },
        ],
      },
    ];
    expect(pickPatchThread(groups, '4.4.0')).toEqual({ url: 'https://rsi/440ptu', exact: true });
    expect(pickPatchThread(groups, '4.4.2')).toEqual({ url: 'https://rsi/441', exact: false });
    expect(pickPatchThread(groups, '4.5.0')).toBeNull();
  });
});

describe('dedupeByName', () => {
  const r = (classNameSlug: string, nameLocalized: string | null) => ({ classNameSlug, nameLocalized });

  it('keeps the flyable row of a showroom copy, in first-occurrence position', () => {
    const rows = [r('A_Display', 'Alpha'), r('B', 'Beta'), r('A', 'Alpha')];
    expect(dedupeByName(rows).map((x) => x.classNameSlug)).toEqual(['A', 'B']);
  });

  it('keeps distinct names and rows without a name', () => {
    const rows = [r('X', null), r('Y', null), r('Z', 'Zed')];
    expect(dedupeByName(rows).length).toBe(3);
  });
});

describe('class comparison + size facts', () => {
  const row = (role: string | null, size: number | null, payload: unknown) => ({ role, size, classNameSlug: 'x', payload });

  it('classCohort: same role (ships) / same size (others), whole category when the group is small', () => {
    const rows = [row('fighter', 1, {}), row('fighter', 1, {}), row('fighter', 2, {}), row('hauler', 2, {})];
    expect(classCohort('ship', { role: 'fighter', size: null }, rows).length).toBe(3);
    expect(classCohort('ship', { role: 'hauler', size: null }, rows).length).toBe(4);
    expect(classCohort('component', { role: null, size: 2 }, rows).length).toBe(4);
    expect(classCohort('component', { role: null, size: null }, rows).length).toBe(4);
  });

  it('withClassStats: mean + max over members that carry the value, direction per ship value', () => {
    const cohort = [{ payload: { hull: { hp: 100 } } }, { payload: { hull: { hp: 300 } } }, { payload: { hull: {} } }];
    const [hull, mass] = withClassStats('ship', [
      { key: 'hull.hp', value: 300, unit: 'hp' },
      { key: 'hull.mass', value: 5, unit: 'kg' },
    ], cohort);
    expect(hull.classAvg).toBe(200);
    expect(hull.classMax).toBe(300);
    expect(hull.higherIsBetter).toBeTrue();
    expect(mass.classAvg).toBeNull();
    expect(mass.higherIsBetter).toBeNull();
    expect(withClassStats('tool', [{ key: 'weaponParams.a', value: 1, unit: null }], [])[0].higherIsBetter).toBeNull();
  });

  it('factsFor: L/W/H for ships, size class for the rest, unknown facts left out', () => {
    expect(factsFor('ship', { dimensions: { length: 22.5, width: 16, height: 0 } }, null).map((f) => f.id)).toEqual(['length', 'width']);
    expect(factsFor('ship', null, null)).toEqual([]);
    expect(factsFor('component', null, 2)).toEqual([{ id: 'size', value: 'S2' }]);
    expect(factsFor('tool', null, null)).toEqual([]);
  });
});
