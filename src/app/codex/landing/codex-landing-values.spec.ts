import { LandingCodexCategory, LandingValue } from './codex-landing-data.types';
import { MAX_CALLOUTS, barOf, compareValue, splitCallouts } from './codex-landing-values';
import { CLAIMS_PER_CATEGORY, ClaimCursor, buildClaims } from './codex-landing-claims';
import { HOLO_TIMING, scanPassAt } from './codex-landing-holotable.component';

const v = (key: string, value: number, extra: Partial<LandingValue> = {}): LandingValue => ({ key, value, unit: null, ...extra });

describe('splitCallouts', () => {
  it('ships: only values with a hull anchor become callouts, the rest goes to the bars pane', () => {
    const { callouts, rest } = splitCallouts('ship', [
      v('flight.scmSpeed', 210),
      v('flight.maxSpeed', 1240),
      v('hull.hp', 4300),
      v('crew.size', 1),
    ]);
    expect(callouts.map((c) => c.value.key).sort()).toEqual(['flight.maxSpeed', 'hull.hp']);
    expect(rest.map((r) => r.key)).toEqual(['flight.scmSpeed', 'crew.size']);
  });

  it('caps at three callouts, ordered top to bottom by anchor height', () => {
    const { callouts, rest } = splitCallouts('ship', [
      v('flight.maxSpeed', 1),
      v('hull.hp', 1),
      v('armorHp', 1),
      v('cargoScu', 1),
    ]);
    expect(callouts.length).toBe(MAX_CALLOUTS);
    const ys = callouts.map((c) => c.anchor.y);
    expect([...ys].sort((a, b) => a - b)).toEqual(ys);
    expect(rest.map((r) => r.key)).toEqual(['cargoScu']);
  });

  it('non-ship items anchor their first three values on the silhouette body', () => {
    const { callouts, rest } = splitCallouts('tool', [v('a', 1), v('b', 2), v('c', 3), v('d', 4)]);
    expect(callouts.length).toBe(3);
    expect(rest.map((r) => r.key)).toEqual(['d']);
  });
});

describe('compareValue / barOf', () => {
  it('signed delta vs the class mean; a worse value is flagged (warning token, never danger)', () => {
    expect(compareValue(v('hull.hp', 112, { classAvg: 100, classMax: 200, higherIsBetter: true }))).toEqual(
      jasmine.objectContaining({ kind: 'delta', delta: '+12', worse: false }),
    );
    expect(compareValue(v('flight.maxSpeed', 96, { classAvg: 100, classMax: 200, higherIsBetter: true }))).toEqual(
      jasmine.objectContaining({ kind: 'delta', delta: '−4', worse: true }),
    );
  });

  it('neutral values show the class mean, the best of a class says so, no class → null', () => {
    expect(compareValue(v('crew.size', 2, { classAvg: 3, classMax: 5, higherIsBetter: null }))?.kind).toBe('avg');
    expect(compareValue(v('hull.hp', 300, { classAvg: 200, classMax: 300, higherIsBetter: true }))?.kind).toBe('top');
    expect(compareValue(v('hull.hp', 300))).toBeNull();
  });

  it('bars scale to the class maximum with the mean as tick', () => {
    expect(barOf(v('x', 50, { classAvg: 25, classMax: 100 }))).toEqual({ fill: 50, avg: 25 });
    expect(barOf(v('x', 50))).toBeNull();
  });
});

describe('hero claims', () => {
  const t = { instant: (key: string, p?: Record<string, unknown>) => (p ? `${key}:${JSON.stringify(p)}` : key) };
  const news: LandingCodexCategory = {
    category: 'ship',
    count: 14,
    entries: [
      { id: 'a', name: 'Golem OX', route: [], announced: false },
      { id: 'b', name: 'Gladius', route: [], announced: false },
      { id: 'c', name: 'Polaris', route: [], announced: true },
    ],
    more: 12,
    announced: 1,
  };

  it('always seven lines, concrete patch news first, mixed with the static claims', () => {
    const lines = buildClaims(t, 'ship', { patch: '4.3', news });
    expect(lines.length).toBe(CLAIMS_PER_CATEGORY);
    expect(lines[0]).toContain('claims.ship.count');
    expect(lines[0]).toContain('"count":14');
    expect(lines.some((l) => l.includes('Golem OX'))).toBeTrue();
    expect(lines.some((l) => l.includes('Polaris'))).withContext('announced names are no "flight-ready" claim').toBeFalse();
    expect(lines.some((l) => l.includes('claims.ship.announced'))).toBeTrue();
    expect(lines).toContain('codex.landing.claims.ship.s1');
  });

  it('without data: the static claims fill all seven lines, never twice in a row', () => {
    const lines = buildClaims(t, 'tool', { patch: null, news: null });
    expect(lines.length).toBe(CLAIMS_PER_CATEGORY);
    lines.forEach((l, i) => i && expect(l).not.toBe(lines[i - 1]));
  });

  it('a category coming back continues with its next claim; step() advances inside one', () => {
    const c = new ClaimCursor();
    expect(c.enter('ship')).toBe(0);
    expect(c.enter('ship')).withContext('same category stays').toBe(0);
    expect(c.enter('tool')).toBe(0);
    expect(c.enter('ship')).toBe(1);
    expect(c.step()).toBe(2);
    expect(c.enter('tool')).toBe(1);
    expect(c.enter('ship')).toBe(3);
  });
});

describe('scan timing', () => {
  it('a callout draws when the rising scan passes its anchor height', () => {
    expect(scanPassAt(1, 100)).toBe(1);
    expect(scanPassAt(1, 0)).toBe(1 + HOLO_TIMING.build);
    expect(scanPassAt(0, 30)).toBeLessThan(scanPassAt(0, 10));
  });
});
