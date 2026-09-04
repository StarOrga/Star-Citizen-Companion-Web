import {
  applyPowerEffects,
  buildKpiStrip,
  kpiDelta,
  kpiLowerIsBetter,
  kpiSetFor,
  kpiTooltipKey,
} from './codex-kpi-sets';
import type { KpiSheet } from './codex-loadout-stats';
import { missionById } from './codex-mission';
import type { PowerSheet } from './codex-power';

const sheet = (over: Partial<KpiSheet> = {}): KpiSheet =>
  ({
    alpha: 131,
    burstDps: 837,
    sustainedDps: 837,
    missiles: null,
    shieldHp: 6480,
    shieldRegen: 410,
    hullHp: 9800,
    effectiveHp: 16280,
    cargo: 24,
    mass: 216323,
    scm: 210,
    maxSpeed: 1100,
    boost: 300,
    agility: 60,
    armorHp: 2200,
    quantumSpeed: null,
    quantumRange: null,
    spool: null,
    ir: 7340,
    emIdle: null,
    emMax: 29100,
    crossSection: 9712,
    ...over,
  }) as KpiSheet;

function powerSheet(weaponsCut: boolean): PowerSheet {
  return {
    available: true,
    gapKeys: [],
    mode: 'scm',
    preset: 'auto',
    cutGroups: new Set(weaponsCut ? (['weapons'] as const) : []),
    budgetTotal: 14,
    budgetUsed: weaponsCut ? 11 : 14,
    groups: [],
    facts: [],
    coolant: { used: 22, total: 34, percent: 65 },
    ready: true,
    readinessKey: 'codex.energy.ready.yes',
    weaponsCut,
  };
}

describe('kpiSetFor', () => {
  it('gives every lens exactly six cells', () => {
    for (const id of ['all', 'combat', 'transport', 'travel', 'stealth', 'mining', 'salvage']) {
      expect(kpiSetFor(id).length).withContext(id).toBe(6);
    }
  });

  it('follows MASTER §4 for Transport, Reisen and Schleichen', () => {
    expect(kpiSetFor('transport')).toEqual(['cargo', 'hullHp', 'shieldHp', 'quantumRange', 'scm', 'mass']);
    expect(kpiSetFor('travel')).toEqual(['quantumRange', 'scm', 'maxSpeed', 'boost', 'mass', 'shieldHp']);
    expect(kpiSetFor('stealth')).toEqual(['ir', 'emMax', 'crossSection', 'shieldHp', 'scm', 'sustainedDps']);
  });

  it('falls back to the Alles set for Bergbau and Bergung', () => {
    expect(kpiSetFor('mining')).toEqual(kpiSetFor('all'));
    expect(kpiSetFor('salvage')).toEqual(kpiSetFor('all'));
  });
});

describe('conventions', () => {
  it('names signatures, mass and spool as lower-is-better — nothing else', () => {
    expect(kpiLowerIsBetter('ir')).toBeTrue();
    expect(kpiLowerIsBetter('emMax')).toBeTrue();
    expect(kpiLowerIsBetter('crossSection')).toBeTrue();
    expect(kpiLowerIsBetter('mass')).toBeTrue();
    expect(kpiLowerIsBetter('shieldHp')).toBeFalse();
  });

  it('tooltips only the two DPS cells', () => {
    expect(kpiTooltipKey('burstDps')).toBe('codex.kpi.tooltip.burstDps');
    expect(kpiTooltipKey('sustainedDps')).toBe('codex.kpi.tooltip.sustainedDps');
    expect(kpiTooltipKey('alpha')).toBeNull();
  });

  it('never returns a ±0 delta', () => {
    expect(kpiDelta('alpha', 131, 131)).toBeNull();
    expect(kpiDelta('alpha', 131, 159)!.raw).toBe(28);
    expect(kpiDelta('alpha', null, 159)).toBeNull();
  });
});

describe('applyPowerEffects', () => {
  it('zeroes both DPS figures when the weapons group is cut', () => {
    const out = applyPowerEffects(sheet(), powerSheet(true));
    expect(out.sustainedDps).toBe(0);
    expect(out.burstDps).toBe(0);
    expect(out.alpha).toBe(131); // per-shot, unaffected by the power state
    expect(out.shieldHp).toBe(6480);
  });

  it('returns the identical object when nothing changes', () => {
    const s = sheet();
    expect(applyPowerEffects(s, powerSheet(false))).toBe(s);
    expect(applyPowerEffects(s, null)).toBe(s);
  });
});

describe('buildKpiStrip', () => {
  it('shows the cut as a red delta against the factory sheet', () => {
    const cells = buildKpiStrip(missionById('combat'), sheet(), sheet(), powerSheet(true));
    const dps = cells.find((c) => c.key === 'sustainedDps')!;
    expect(dps.value).toBe(0);
    expect(dps.delta!.raw).toBe(-837);
    expect(dps.delta!.good).toBeFalse();
    expect(dps.fromPower).toBeTrue();
    expect(cells.find((c) => c.key === 'alpha')!.delta).toBeNull();
  });

  it('carries lowerIsBetter and the tooltip key on every cell', () => {
    const cells = buildKpiStrip(missionById('stealth'), sheet(), sheet());
    expect(cells.find((c) => c.key === 'ir')!.lowerIsBetter).toBeTrue();
    expect(cells.find((c) => c.key === 'sustainedDps')!.tooltipKey).toBe('codex.kpi.tooltip.sustainedDps');
    expect(cells.every((c) => !c.fromPower)).toBeTrue();
  });
});
