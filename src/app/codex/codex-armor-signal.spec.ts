import { armorSignalMultipliers } from './codex-loadout-stats';
import { computePowerSheet } from './codex-power';
import type { SummaryOccupant } from './ship-summary-panels';
import { NOMAD_SHIP_STATS, nomadOccupants } from './testing/nomad-power.fixture';

// Feedback #242 follow-up: the ship signature a countermeasure has to outshine
// is the powered components' IR / EM emission scaled by the hull armor's
// `SCItemVehicleArmorParams.signal*` factor (live 4.10 values: Eclipse 0.6,
// Centurion IR 0.4 / EM 0.3).

function armor(className: string, params: Record<string, unknown> | null): SummaryOccupant {
  return {
    section: 'hull',
    count: 1,
    kind: 'item',
    payload: {
      className,
      stats: params ? { SCItemVehicleArmorParams: { ...params, 'damageMultiplier.DamagePhysical': 0.7 } } : {},
    },
  } as unknown as SummaryOccupant;
}

const value = (occupants: SummaryOccupant[], key: string): number | null =>
  computePowerSheet({ occupants, shipStats: NOMAD_SHIP_STATS }).facts.find((f) => f.key === key)?.value ?? null;

describe('armorSignalMultipliers', () => {
  it('reads the three signal factors from the armor item', () => {
    const a = armor('ARMR_ANVL_Centurion', { signalInfrared: 0.4, signalElectromagnetic: 0.3, signalCrossSection: 1 });
    expect(armorSignalMultipliers(a.payload)).toEqual({ ir: 0.4, em: 0.3, crossSection: 1 });
  });

  it('keeps a channel the armor does not carry at the neutral 1', () => {
    const a = armor('ARMR_X', { signalInfrared: 0.6 });
    expect(armorSignalMultipliers(a.payload)).toEqual({ ir: 0.6, em: 1, crossSection: 1 });
  });

  it('is null without armor or without any signal field', () => {
    expect(armorSignalMultipliers(null)).toBeNull();
    expect(armorSignalMultipliers(armor('ARMR_X', null).payload)).toBeNull();
    expect(armorSignalMultipliers(armor('ARMR_X', { 'damageMultiplier.DamageEnergy': 0.5 }).payload)).toBeNull();
  });
});

describe('computePowerSheet — armor signal factor', () => {
  const bare = nomadOccupants();
  const irBare = value(bare, 'ir')!;
  const emBare = value(bare, 'em')!;
  const csBare = value(bare, 'crossSection')!;

  it('has a component signature to scale in the first place', () => {
    expect(irBare).toBeGreaterThan(0);
    expect(emBare).toBeGreaterThan(0);
    expect(csBare).toBeGreaterThan(0);
  });

  it('a neutral armor (all 1) changes nothing', () => {
    const occ = [...bare, armor('ARMR_CNOU_Nomad', { signalInfrared: 1, signalElectromagnetic: 1, signalCrossSection: 1 })];
    expect(value(occ, 'ir')).toBe(irBare);
    expect(value(occ, 'em')).toBe(emBare);
    expect(value(occ, 'crossSection')).toBe(csBare);
  });

  it('a stealth armor scales IR, EM and cross-section per channel', () => {
    const occ = [...bare, armor('ARMR_ANVL_Centurion', { signalInfrared: 0.4, signalElectromagnetic: 0.3, signalCrossSection: 0.5 })];
    const sheet = computePowerSheet({ occupants: occ, shipStats: NOMAD_SHIP_STATS });
    expect(sheet.facts.find((f) => f.key === 'ir')!.value).toBeCloseTo(irBare * 0.4, 0);
    expect(sheet.facts.find((f) => f.key === 'em')!.value).toBeCloseTo(emBare * 0.3, 0);
    expect(sheet.facts.find((f) => f.key === 'crossSection')!.value).toBeCloseTo(csBare * 0.5, 0);
    expect(sheet.armorSignal).toEqual({ ir: 0.4, em: 0.3, crossSection: 0.5 });
  });

  it('reports no factor when the loadout has no armor', () => {
    expect(computePowerSheet({ occupants: bare, shipStats: NOMAD_SHIP_STATS }).armorSignal).toBeNull();
  });
});
