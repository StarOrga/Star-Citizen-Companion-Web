// The redteam cases for the energy model (R1/R2/R3/R5/R6/R8), all driven by the
// exported Nomad fixture so the numbers are the ones the LIVE P4K carries.
import {
  computePowerSheet,
  distributePower,
  isPassiveShield,
  occupantDraw,
  POWER_REQUIRED_SCHEMA,
  resolveResourceState,
  resourceStateNames,
} from './codex-power';
import {
  fixtureOccupant,
  NOMAD_BUDGET_SEGMENTS,
  NOMAD_COOLER,
  NOMAD_POWER_FIXTURE,
  NOMAD_REPEATERS,
  NOMAD_SHIELD_ACTIVE,
  NOMAD_SHIELD_PASSIVE,
  NOMAD_SHIP_STATS,
  nomadOccupants,
} from './testing/nomad-power.fixture';

type SheetInput = Parameters<typeof computePowerSheet>[0];

const sheet = (over: Partial<SheetInput> = {}): ReturnType<typeof computePowerSheet> =>
  computePowerSheet({ occupants: nomadOccupants(), shipStats: NOMAD_SHIP_STATS, ...over });

const row = (s: ReturnType<typeof computePowerSheet>, g: string) =>
  s.groups.find((r) => r.group === g)!;

describe('power distribution (R1)', () => {
  it('never allocates more than the reactor funds', () => {
    const s = sheet();
    expect(s.budgetTotal).toBe(NOMAD_BUDGET_SEGMENTS);
    const sum = s.groups.reduce((n, g) => n + g.allocated, 0);
    expect(sum).toBe(s.budgetUsed);
    expect(s.budgetUsed).toBeLessThanOrEqual(NOMAD_BUDGET_SEGMENTS);
  });

  it('seeds every group with its minimum, then spends the surplus weapons-first', () => {
    const s = sheet();
    // capacity: weapons 3 (three 1.0-unit repeaters), shields 4 (2 active × 2,
    // the passive one draws nothing), coolers 6 (2 × 3), 1 each for the rest.
    expect(row(s, 'weapons').capacity).toBe(3);
    expect(row(s, 'shields').capacity).toBe(4);
    expect(row(s, 'coolers').capacity).toBe(6);
    // minimums: 0 / 2 / 4 / 1 / 1 / 1 → 9 of the 14 segments are spoken for.
    expect(s.budgetMinimum).toBe(9);
    // the remaining 5 go weapons (3) then shields (2).
    expect(row(s, 'weapons').allocated).toBe(3);
    expect(row(s, 'shields').allocated).toBe(4);
    expect(row(s, 'coolers').allocated).toBe(4);
    expect(s.budgetUsed).toBe(14);
    expect(s.overBudget).toBeFalse();
    expect(s.ready).toBeTrue();
  });

  it('cutting weapons frees EXACTLY the weapons allocation', () => {
    const before = sheet();
    const after = sheet({ occupants: nomadOccupants(), cutGroups: ['weapons'] });
    expect(row(after, 'weapons').allocated).toBe(0);
    expect(before.budgetUsed - after.budgetUsed).toBe(row(before, 'weapons').allocated);
    expect(after.budgetUsed).toBe(11);
  });

  it('stealth runs every group at its minimum', () => {
    const s = sheet({ occupants: nomadOccupants(), preset: 'stealth' });
    expect(row(s, 'weapons').allocated).toBe(0);
    expect(row(s, 'shields').allocated).toBe(2);
    expect(row(s, 'coolers').allocated).toBe(4);
    expect(s.budgetUsed).toBe(9);
  });

  it('reports a deficit honestly when the minimums exceed the budget', () => {
    // a 3-segment plant cannot hold this ship's 9 segments of floor
    const weak = NOMAD_POWER_FIXTURE.map((f) =>
      f.generateSegments ? { ...f, generateSegments: 3 } : f,
    );
    const s = computePowerSheet({ occupants: nomadOccupants(weak) });
    expect(s.budgetTotal).toBe(3);
    expect(s.overBudget).toBeTrue();
    expect(s.ready).toBeFalse();
    expect(s.readinessKey).toBe('codex.energy.readiness.no');
    // allocations stay AT the minimum — the dock prints 9 / 3, it does not lie
    expect(row(s, 'coolers').allocated).toBe(4);
    expect(s.budgetUsed).toBe(s.budgetMinimum);
  });

  it('pips are capacity slots: min, then on, then empty', () => {
    const s = sheet();
    const coolers = row(s, 'coolers');
    expect(coolers.pips.length).toBe(6);
    expect(coolers.pips.map((p) => p.kind)).toEqual([
      'min',
      'min',
      'min',
      'min',
      'empty',
      'empty',
    ]);
    const shields = row(s, 'shields');
    expect(shields.pips.map((p) => p.kind)).toEqual(['min', 'min', 'on', 'on']);
  });

  it('distributePower keeps min ≤ alloc ≤ capacity', () => {
    const out = distributePower(
      [
        { group: 'weapons', capacity: 3, minimum: 0, items: 3, present: true },
        { group: 'shields', capacity: 4, minimum: 2, items: 2, present: true },
      ],
      4,
      'auto',
    );
    expect(out.get('weapons')).toBe(2);
    expect(out.get('shields')).toBe(2);
  });
});

describe('passive shield generator (R2)', () => {
  it('draws nothing and does not inflate the shield capacity', () => {
    expect(isPassiveShield(fixtureOccupant(NOMAD_SHIELD_PASSIVE))).toBeTrue();
    expect(isPassiveShield(fixtureOccupant(NOMAD_SHIELD_ACTIVE))).toBeFalse();
    const s = computePowerSheet({
      occupants: nomadOccupants([NOMAD_SHIELD_ACTIVE, NOMAD_SHIELD_PASSIVE]),
    });
    expect(row(s, 'shields').capacity).toBe(4);
    expect(row(s, 'shields').items).toBe(3);
  });
});

describe('weaponsCut (R3)', () => {
  it('is the pilot cut, not "allocated 0"', () => {
    // a weapons group the extract carries no resource block for allocates 0…
    const bare = { ...NOMAD_REPEATERS, consumeUnits: undefined, minFraction: undefined };
    const s = computePowerSheet({ occupants: nomadOccupants([...NOMAD_POWER_FIXTURE.slice(0, 4), bare]) });
    expect(row(s, 'weapons').allocated).toBe(0);
    expect(s.weaponsCut).toBeFalse(); // …and must NOT zero the DPS
    const cut = sheet({ occupants: nomadOccupants(), cutGroups: ['weapons'] });
    expect(cut.weaponsCut).toBeTrue();
  });
});

describe('minFraction rounding (R6)', () => {
  it('two UltraFlow coolers floor at 4 segments, not 5', () => {
    const s = computePowerSheet({ occupants: nomadOccupants([NOMAD_COOLER]) });
    expect(row(s, 'coolers').minimum).toBe(4);
  });

  it('a genuine fraction above the floor still rounds up', () => {
    const s = computePowerSheet({
      occupants: nomadOccupants([{ ...NOMAD_COOLER, count: 1, minFraction: 0.7 }]),
    });
    expect(row(s, 'coolers').minimum).toBe(3); // 3 × 0.7 = 2.1 → 3
  });
});

describe('resource state prefix (R8)', () => {
  it('prefers online and falls back to the first listed state', () => {
    expect(resolveResourceState(fixtureOccupant(NOMAD_COOLER).payload)).toBe('online');
    const navOnly = fixtureOccupant({
      ...NOMAD_COOLER,
      state: 'nav',
      stateNames: 'Nav|Standby',
    });
    expect(resourceStateNames(navOnly.payload)).toEqual(['Nav', 'Standby']);
    expect(resolveResourceState(navOnly.payload)).toBe('nav');
    expect(occupantDraw(navOnly).consumeSegments).toBe(6);
    expect(occupantDraw(navOnly).missing).toBeFalse();
  });

  it('an absent group is missing, not zero', () => {
    const bare = {
      section: 'radar',
      count: 1,
      kind: 'component',
      payload: { className: 'X', stats: {} },
    } as unknown as Parameters<typeof occupantDraw>[0];
    expect(resolveResourceState({ className: 'X', stats: {} })).toBeNull();
    const draw = occupantDraw(bare);
    expect(draw.missing).toBeTrue();
    expect(draw.state).toBeNull();
  });
});

describe('schema gate (R5)', () => {
  it('reports reExtractPending and no sheet below schema 3', () => {
    const s = sheet({ occupants: nomadOccupants(), schemaVersion: POWER_REQUIRED_SCHEMA - 1 });
    expect(s.available).toBeFalse();
    expect(s.gapKeys).toContain('codex.energy.gap.reExtractPending');
    expect(s.budgetTotal).toBeNull();
  });
});

describe('cut honesty (R9)', () => {
  it('facts without a change carry delta null', () => {
    const before = sheet();
    const after = sheet({
      occupants: nomadOccupants(),
      shipStats: NOMAD_SHIP_STATS,
      cutGroups: ['weapons'],
      previous: before,
    });
    // the repeaters have EM 0 / IR 0 and no coolant — nothing moves.
    for (const key of ['em', 'ir', 'coolant', 'crossSection'] as const) {
      expect(after.facts.find((f) => f.key === key)!.delta)
        .withContext(key)
        .toBeNull();
    }
  });
});
