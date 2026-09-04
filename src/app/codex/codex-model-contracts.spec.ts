// R7 (picker columns), R10 (storage keys) and the ranking's scope hygiene.
import {
  buildSwapCandidate,
  swapAimStats,
  swapResourceStats,
  STANDARD_UNITS_PER_SEGMENT,
} from './swap-table';
import {
  DEFAULT_POWER_DRAFT,
  decodePowerParam,
  dockPositionStorageKey,
  encodePowerParam,
  parseDockPosition,
  POWER_GROUP_SEPARATOR,
  powerStorageKey,
} from './codex-loadout-draft';
import { POWER_GROUP_ORDER } from './codex-power';
import { rankShip, resolveCareerLabel } from './codex-rank';
import type { RankShipInput } from './codex-rank';
import { fixtureOccupant, NOMAD_COOLER, NOMAD_REPEATERS } from './testing/nomad-power.fixture';

describe('picker columns read the resource group (R7)', () => {
  it('fills power / minPower / em / ir / coolant / hp / distortion / mass for a weapon', () => {
    const stats = swapResourceStats(fixtureOccupant(NOMAD_REPEATERS).payload);
    // one repeater draws 1.0 STANDARD unit → 0.75 of a segment
    expect(stats['codex.picker.col.power'].value).toBe(
      Math.round((1 / STANDARD_UNITS_PER_SEGMENT) * 100) / 100,
    );
    expect(stats['codex.picker.col.power'].derived).toBeTrue();
    expect(stats['codex.picker.col.minPower'].value).toBe(0);
    expect(stats['codex.picker.col.em'].value).toBe(0);
    expect(stats['codex.picker.col.ir'].value).toBe(0);
    expect(stats['codex.equipped.health'].value).toBe(1500);
    expect(stats['codex.equipped.distortion'].value).toBe(500000);
    expect(stats['codex.picker.col.mass'].value).toBe(120);
  });

  it('reads whole segments verbatim for a component', () => {
    const stats = swapResourceStats(fixtureOccupant(NOMAD_COOLER).payload);
    expect(stats['codex.picker.col.power'].value).toBe(3);
    expect(stats['codex.picker.col.power'].derived).toBeFalsy();
    expect(stats['codex.picker.col.minPower'].value).toBe(0.6667);
    expect(stats['codex.picker.col.em'].value).toBe(1490);
    expect(stats['codex.picker.col.ir'].value).toBe(7130);
    // the cooler GENERATES coolant but consumes none — no column, not a 0
    expect(stats['codex.picker.col.coolant']).toBeUndefined();
  });

  it('emits nothing at all for a payload without the group — never a 0', () => {
    expect(swapResourceStats({ className: 'X', stats: {} })).toEqual({});
    expect(swapAimStats(null)).toEqual({});
  });

  it('buildSwapCandidate carries the columns onto the row', () => {
    const c = buildSwapCandidate({
      className: 'KLWE_LaserRepeater_S3_SCItem',
      kind: 'weapon',
      nameLocalized: 'Bulldog',
      manufacturerCode: 'KLWE',
      size: 3,
      grade: 'A',
      subType: 'Gun',
      payload: fixtureOccupant(NOMAD_REPEATERS).payload,
    });
    expect(c.stats['codex.picker.col.power']).toBeDefined();
    expect(c.stats['codex.picker.col.mass'].value).toBe(120);
  });
});

describe('power draft storage keys (R10)', () => {
  it('every group key is [a-z]+, so "-" is a safe separator', () => {
    for (const g of POWER_GROUP_ORDER) expect(g).toMatch(/^[a-z]+$/);
    expect(POWER_GROUP_SEPARATOR).toBe('-');
  });

  it('round-trips a multi-group cut through the URL param unchanged', () => {
    const state = { ...DEFAULT_POWER_DRAFT, cutGroups: ['weapons', 'quantum'], mode: 'nav' as const };
    const raw = encodePowerParam(state)!;
    expect(raw).toBe('p1.nav.auto.center.weapons-quantum');
    expect(decodePowerParam(raw)).toEqual(state);
  });

  it('splits per-ship power state from the per-user dock position', () => {
    expect(powerStorageKey('CNOU_Nomad')).toBe('scc-codex-power:v1:CNOU_Nomad');
    expect(powerStorageKey('AEGS_Idris_P')).not.toBe(powerStorageKey('CNOU_Nomad'));
    expect(dockPositionStorageKey('u-1')).toBe('scc-codex-dock-pos:v1:u-1');
    expect(dockPositionStorageKey(null)).toBe('scc-codex-dock-pos:v1:anon');
    expect(dockPositionStorageKey('  ')).toBe('scc-codex-dock-pos:v1:anon');
  });

  it('parses a stored dock position tolerantly', () => {
    expect(parseDockPosition('left')).toBe('left');
    expect(parseDockPosition('nonsense')).toBeNull();
    expect(parseDockPosition(null)).toBeNull();
  });
});

describe('ranking scope hygiene', () => {
  const base: RankShipInput = { className: 'A', sizeClass: 1, career: null, sheet: { alpha: 10 } };
  const cohort: RankShipInput[] = [base, { ...base, className: 'B', sheet: { alpha: 20 } }];

  it('reports scope "all" plus a reason when the target has no career', () => {
    const r = rankShip(base, cohort, { scope: 'career' });
    expect(r.scope).toBe('all');
    expect(r.scopeFallbackKey).toBe('codex.rank.disabled.noData');
  });

  it('keeps the requested scope when the discriminator exists', () => {
    const r = rankShip({ ...base, career: '@vehicle_focus_Combat' }, cohort, { scope: 'career' });
    expect(r.scope).toBe('career');
    expect(r.scopeFallbackKey).toBeNull();
  });

  it('falls back for sizeClass too', () => {
    const r = rankShip({ ...base, sizeClass: null }, cohort, { scope: 'sizeClass' });
    expect(r.scope).toBe('all');
    expect(r.scopeFallbackKey).toBe('codex.rank.disabled.noData');
  });

  it('hands the career loc key through UNCHANGED', () => {
    expect(resolveCareerLabel('@vehicle_focus_Light_Freight')).toBe('@vehicle_focus_Light_Freight');
    expect(resolveCareerLabel('  ')).toBeNull();
    expect(resolveCareerLabel(null)).toBeNull();
  });
});
