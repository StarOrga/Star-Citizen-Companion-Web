import type { SupplyItem } from '../hq-supplies.service';
import { MOODS_AVAILABLE, MOODS_OFF } from './hq-moods';
import { buildPlanNeeds } from './hq-plan-needs';
import { passesFilters, top3Selection } from './hq-plan-selection';

const supply = (id: string, stepKind: SupplyItem['stepKind']): SupplyItem =>
  ({ id, name: id, qty: 1, done: false, entityKind: null, className: null, setKind: null, setId: null, stepKind, wanted: true, amount: null, unit: null, forClassName: null, packageId: null }) as unknown as SupplyItem;

describe('buildPlanNeeds (W5.3)', () => {
  it('carries no mission activity and a crew of one, so moods must not be applied until codex data exists', () => {
    const needs = buildPlanNeeds([supply('a', 'buy'), supply('b', 'mission')], [], new Map());
    expect(needs.every((n) => n.activity === null && n.crew === 1)).toBe(true);
    expect(MOODS_AVAILABLE).toBe(false);
  });

  it('Gruppe and Friedlich filter no line while the moods are off', () => {
    const needs = buildPlanNeeds([supply('a', 'buy'), supply('b', 'mission')], [], new Map());
    const base = top3Selection({ needs, sets: [] });
    for (const moods of [{ ...MOODS_OFF, crew: 'right' as const }, { ...MOODS_OFF, danger: 'left' as const }]) {
      expect(needs.every((n) => passesFilters({ ...base, moods }, n))).toBe(true);
    }
  });
});
