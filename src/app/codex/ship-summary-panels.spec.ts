import {
  SummaryOccupant,
  buildDamagePanel,
  buildDefencePanel,
  buildPowerPanel,
  buildShipSummaryPanels,
  equippedMass,
} from './ship-summary-panels';

// Payload fragments below mirror the real 4.9.0 shapes: SHLD_GODI_S01_AllStop
// (shield), POWR_AEGS_S01_Regulus (power plant) and the `<class>_AMMO` join a
// gun's damage comes through.

function shield(): unknown {
  return {
    entityKind: 'component',
    kind: 'Shield',
    size: 1,
    stats: {
      SCItemShieldGeneratorParams: {
        MaxShieldHealth: 3168,
        MaxShieldRegen: 602,
        DamagedRegenDelay: 5.75,
        DownedRegenDelay: 11.5,
      },
      SDistortionParams: { Maximum: 3150 },
      SHealthComponentParams: { Health: 210 },
      SEntityPhysicsControllerParams: { 'PhysType.Mass': 120 },
    },
  };
}

function powerPlant(): unknown {
  return {
    entityKind: 'component',
    kind: 'PowerPlant',
    size: 1,
    stats: {
      SDistortionParams: { Maximum: 2000 },
      SHealthComponentParams: { Health: 92 },
      SEntityPhysicsControllerParams: { 'PhysType.Mass': 22.5 },
    },
  };
}

function gun(): unknown {
  return { entityKind: 'weapon', subType: 'Gun', size: 3, weaponParams: { fireRate: 0 } };
}

function ammo(): unknown {
  return { impactDamage: { energy: 43.65 } };
}

function occ(over: Partial<SummaryOccupant>): SummaryOccupant {
  return { section: 'weapons', kind: null, payload: null, count: 1, ...over };
}

function rows(panel: { rows: { labelKey: string; value: number }[] }): Record<string, number> {
  return Object.fromEntries(panel.rows.map((r) => [r.labelKey, r.value]));
}

describe('buildDamagePanel', () => {
  it('sums alpha damage across every gun, scaled by hardpoint count', () => {
    const panel = buildDamagePanel([
      occ({ kind: 'weapon', payload: gun(), ammoPayload: ammo(), count: 3 }),
    ]);
    expect(rows(panel)['codex.summary.alphaDamage']).toBeCloseTo(130.95, 2);
    expect(rows(panel)['codex.summary.weaponMounts']).toBe(3);
  });

  it('omits DPS rather than printing zero while fireRate is missing', () => {
    const panel = buildDamagePanel([
      occ({ kind: 'weapon', payload: gun(), ammoPayload: ammo(), count: 1 }),
    ]);
    expect(rows(panel)['codex.summary.dps']).toBeUndefined();
    expect(panel.gapKeys).toContain('codex.summary.gap.noFireRate');
  });

  it('counts empty mounts and names the stock-gun gap', () => {
    const panel = buildDamagePanel([
      occ({ section: 'weapons', count: 3 }),
      occ({ section: 'missiles', count: 4 }),
    ]);
    expect(rows(panel)['codex.summary.weaponMounts']).toBe(3);
    expect(rows(panel)['codex.summary.ordnanceMounts']).toBe(4);
    expect(rows(panel)['codex.summary.alphaDamage']).toBeUndefined();
    expect(panel.gapKeys).toContain('codex.summary.gap.noStockGuns');
  });
});

describe('buildDefencePanel', () => {
  it('adds up the shield pool and keeps the slowest delay', () => {
    const panel = buildDefencePanel([
      occ({ section: 'shields', kind: 'component', payload: shield(), count: 2 }),
    ]);
    const r = rows(panel);
    expect(r['codex.summary.shieldHp']).toBe(6336);
    expect(r['codex.summary.shieldRegen']).toBe(1204);
    expect(r['codex.summary.regenDelay']).toBe(5.75);
    expect(r['codex.summary.downedDelay']).toBe(11.5);
    expect(r['codex.summary.distortionPool']).toBe(6300);
  });

  it('never invents hull HP or resistances, and says why', () => {
    const panel = buildDefencePanel([
      occ({ section: 'shields', kind: 'component', payload: shield(), count: 1 }),
    ]);
    expect(rows(panel)['codex.summary.hullHp']).toBeUndefined();
    expect(panel.gapKeys).toContain('codex.summary.gap.noHullHp');
    expect(panel.gapKeys).toContain('codex.summary.gap.noResistances');
  });

  it('flags a ship whose stock loadout carries no shield at all', () => {
    expect(buildDefencePanel([occ({})]).gapKeys).toContain('codex.summary.gap.noShields');
  });
});

describe('buildPowerPanel', () => {
  it('reports the generation that IS installed', () => {
    const panel = buildPowerPanel([
      occ({ section: 'powerPlants', kind: 'component', payload: powerPlant(), count: 2 }),
      occ({ section: 'shields', kind: 'component', payload: shield(), count: 1 }),
    ]);
    const r = rows(panel);
    expect(r['codex.summary.powerPlants']).toBe(2);
    expect(r['codex.summary.powerPlantSize']).toBe(2);
    expect(r['codex.summary.plantDurability']).toBe(184);
    expect(r['codex.summary.poweredItems']).toBe(3);
  });

  it('admits that per-item draw is not extracted instead of showing 0', () => {
    const panel = buildPowerPanel([
      occ({ section: 'powerPlants', kind: 'component', payload: powerPlant(), count: 1 }),
    ]);
    expect(rows(panel)['codex.summary.powerDraw']).toBeUndefined();
    expect(panel.gapKeys).toContain('codex.summary.gap.noPowerDraw');
  });
});

describe('buildShipSummaryPanels', () => {
  it('always returns the three panels in display order', () => {
    expect(buildShipSummaryPanels([]).map((p) => p.key)).toEqual(['damage', 'defence', 'power']);
  });
});

describe('equippedMass', () => {
  it('sums the physicalised mass of everything installed', () => {
    expect(
      equippedMass([
        occ({ payload: shield(), count: 2 }),
        occ({ payload: powerPlant(), count: 1 }),
      ]),
    ).toBeCloseTo(262.5, 1);
  });

  it('returns null when nothing carries a mass', () => {
    expect(equippedMass([occ({})])).toBeNull();
  });
});
