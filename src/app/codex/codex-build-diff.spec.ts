import type { CodexListRow } from './codex.service';
import { computeShipRowDeltas } from './codex-build-diff';

function ship(
  flight: Partial<{ scmSpeed: number; maxSpeed: number; boostSpeed: number }> | null,
  crewSize: number | null = null,
): CodexListRow {
  return {
    classNameSlug: 'AEGS_Gladius',
    nameLocalized: 'Gladius',
    manufacturerCode: 'AEGS',
    size: null,
    grade: null,
    role: null,
    crewSize,
    weaponClass: null,
    componentKind: null,
    subType: null,
    attachType: null,
    speed: null,
    isVariant: false,
    payload: flight ? { flight } : { flight: {} },
    blueprintCategory: null,
    blueprintTier: null,
    craftTimeSec: null,
  };
}

describe('computeShipRowDeltas', () => {
  it('flags a faster ship green (direction up) with the signed delta', () => {
    const deltas = computeShipRowDeltas(ship({ scmSpeed: 250 }), ship({ scmSpeed: 200 }));
    expect(deltas.length).toBe(1);
    expect(deltas[0].labelKey).toBe('codex.landing.diff.scm');
    expect(deltas[0].from).toBe(200);
    expect(deltas[0].to).toBe(250);
    expect(deltas[0].delta).toBe(50);
    expect(deltas[0].direction).toBe('up');
    expect(deltas[0].unit).toBe('m/s');
  });

  it('flags a slower ship red (direction down) with a negative delta', () => {
    const deltas = computeShipRowDeltas(ship({ boostSpeed: 1100 }), ship({ boostSpeed: 1200 }));
    expect(deltas.length).toBe(1);
    expect(deltas[0].labelKey).toBe('codex.landing.diff.boost');
    expect(deltas[0].delta).toBe(-100);
    expect(deltas[0].direction).toBe('down');
  });

  it('marks a crew change neutral (no better/worse polarity)', () => {
    const deltas = computeShipRowDeltas(ship(null, 3), ship(null, 2));
    expect(deltas.length).toBe(1);
    expect(deltas[0].labelKey).toBe('codex.landing.diff.crew');
    expect(deltas[0].direction).toBe('neutral');
    expect(deltas[0].delta).toBe(1);
  });

  it('emits nothing when a field is unchanged', () => {
    expect(computeShipRowDeltas(ship({ scmSpeed: 200 }), ship({ scmSpeed: 200 }))).toEqual([]);
  });

  it('skips a field missing on either side (no half-delta)', () => {
    // current has scmSpeed, previous does not -> no comparable pair.
    expect(computeShipRowDeltas(ship({ scmSpeed: 200 }), ship(null))).toEqual([]);
    expect(computeShipRowDeltas(ship(null), ship({ scmSpeed: 200 }))).toEqual([]);
  });

  it('collects deltas across multiple fields at once', () => {
    const cur = ship({ scmSpeed: 260, maxSpeed: 1000 }, 4);
    const prev = ship({ scmSpeed: 250, maxSpeed: 900 }, 4); // crew unchanged
    const deltas = computeShipRowDeltas(cur, prev);
    expect(deltas.map((d) => d.labelKey).sort()).toEqual([
      'codex.landing.diff.max',
      'codex.landing.diff.scm',
    ]);
    expect(deltas.every((d) => d.direction === 'up')).toBe(true);
  });

  it('ignores non-finite / non-numeric payload values', () => {
    const cur = ship(null);
    (cur.payload as { flight: Record<string, unknown> }).flight = { scmSpeed: 'fast' };
    expect(computeShipRowDeltas(cur, ship({ scmSpeed: 200 }))).toEqual([]);
  });
});
