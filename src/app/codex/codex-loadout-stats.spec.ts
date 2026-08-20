import { missionById } from './codex-mission';
import {
  KpiSheet,
  SummaryOccupant,
  buildDefensivePanel,
  buildKpiCells,
  buildOffensivePanel,
  computeKpiDelta,
  computeKpiSheet,
  findArmorPayload,
} from './codex-loadout-stats';

function gun(opts: {
  className?: string;
  size?: number;
  fireRate?: number;
  damage?: number;
  speed?: number;
  lifetime?: number;
  count?: number;
  section?: 'weapons' | 'remoteTurrets';
}): SummaryOccupant {
  return {
    section: opts.section ?? 'weapons',
    kind: 'weapon',
    payload: {
      entityKind: 'weapon',
      className: opts.className ?? 'KLWE_LaserRepeater_S3',
      size: opts.size ?? 3,
      weaponParams: opts.fireRate != null ? { fireRate: opts.fireRate } : {},
    },
    ammoPayload: {
      impactDamage: { physical: opts.damage ?? 40 },
      speed: opts.speed,
      lifetime: opts.lifetime,
    },
    count: opts.count ?? 1,
  };
}

function shield(opts: { hp?: number; regen?: number; delayDamaged?: number; delayDowned?: number; className?: string; count?: number }): SummaryOccupant {
  return {
    section: 'shields',
    kind: 'component',
    payload: {
      entityKind: 'component',
      kind: 'Shield',
      className: opts.className ?? 'AEGS_ShieldGenerator_S1',
      stats: {
        SCItemShieldGeneratorParams: {
          MaxShieldHealth: opts.hp ?? 1000,
          MaxShieldRegen: opts.regen ?? 50,
          DamagedRegenDelay: opts.delayDamaged ?? 3,
          DownedRegenDelay: opts.delayDowned ?? 5,
        },
      },
    },
    ammoPayload: undefined,
    count: opts.count ?? 1,
  };
}

describe('codex-loadout-stats — computeKpiSheet', () => {
  it('sums alpha and DPS across all fitted guns, once a fireRate is present', () => {
    const sheet = computeKpiSheet(
      [gun({ damage: 40, fireRate: 60 }), gun({ damage: 40, fireRate: 60 })],
      null,
    );
    expect(sheet.alpha).toBe(80);
    expect(sheet.sustainedDps).toBe(80); // 40dmg * 60rpm/60s * 2 guns
    expect(sheet.burstDps).toBe(sheet.sustainedDps);
  });

  it('leaves DPS a gap when no gun carries a fireRate, but keeps alpha', () => {
    const sheet = computeKpiSheet([gun({ damage: 40 })], null);
    expect(sheet.alpha).toBe(40);
    expect(sheet.sustainedDps).toBeNull();
  });

  it('never invents hull HP, cargo or effective HP', () => {
    const sheet = computeKpiSheet([], null);
    expect(sheet.hullHp).toBeNull();
    expect(sheet.cargo).toBeNull();
    expect(sheet.effectiveHp).toBeNull();
  });

  it('sums shield HP/regen across fitted generators', () => {
    const sheet = computeKpiSheet([shield({ hp: 1000, regen: 50 }), shield({ hp: 500, regen: 20 })], null);
    expect(sheet.shieldHp).toBe(1500);
    expect(sheet.shieldRegen).toBe(70);
  });

  it('reads scm/max speed straight from ship.flight', () => {
    const sheet = computeKpiSheet([], { flight: { scmSpeed: 180, maxSpeed: 700 } });
    expect(sheet.scm).toBe(180);
    expect(sheet.maxSpeed).toBe(700);
  });
});

describe('codex-loadout-stats — computeKpiDelta (03-rules §3.5)', () => {
  it('renders nothing for an exact ±0 change', () => {
    expect(computeKpiDelta('shieldHp', 1000, 1000)).toBeNull();
  });

  it('renders nothing when either side is a gap', () => {
    expect(computeKpiDelta('shieldHp', null, 1000)).toBeNull();
    expect(computeKpiDelta('shieldHp', 1000, null)).toBeNull();
  });

  it('drops the % suffix under 0.5% relative change but still reports direction', () => {
    const delta = computeKpiDelta('shieldHp', 10000, 10040); // 0.4%
    expect(delta).not.toBeNull();
    expect(delta!.direction).toBe('up');
    expect(delta!.pctText).toBeNull();
  });

  it('keeps the % suffix at/above 0.5%', () => {
    const delta = computeKpiDelta('shieldHp', 1000, 1010); // 1%
    expect(delta!.pctText).toBe('+1%');
  });

  it('flags mass DOWN as the good direction (03-rules: mass down=better)', () => {
    const lighter = computeKpiDelta('mass', 1000, 900);
    expect(lighter!.direction).toBe('down');
    expect(lighter!.good).toBeTrue();

    const heavier = computeKpiDelta('mass', 1000, 1100);
    expect(heavier!.direction).toBe('up');
    expect(heavier!.good).toBeFalse();
  });

  it('flags shieldHp UP as good (the default direction)', () => {
    const stronger = computeKpiDelta('shieldHp', 1000, 1100);
    expect(stronger!.good).toBeTrue();
  });
});

describe('codex-loadout-stats — buildKpiCells', () => {
  const sheet = (over: Partial<KpiSheet> = {}): KpiSheet => ({
    alpha: null,
    burstDps: null,
    sustainedDps: null,
    missiles: null,
    shieldHp: null,
    shieldRegen: null,
    hullHp: null,
    effectiveHp: null,
    cargo: null,
    mass: null,
    scm: null,
    maxSpeed: null,
    quantumSpeed: null,
    quantumRange: null,
    spool: null,
    ir: null,
    emIdle: null,
    emMax: null,
    crossSection: null,
    ...over,
  });

  it('emits exactly six cells for combat, the first one accented', () => {
    const cells = buildKpiCells(missionById('combat'), sheet(), sheet({ alpha: 100 }));
    expect(cells.length).toBe(6);
    expect(cells[0].key).toBe('alpha');
    expect(cells[0].accent).toBeTrue();
    expect(cells.slice(1).every((c) => !c.accent)).toBeTrue();
  });

  it('names the gap key when a mission KPI has no value', () => {
    const cells = buildKpiCells(missionById('travel'), sheet(), sheet());
    const quantumRangeCell = cells.find((c) => c.key === 'quantumRange')!;
    expect(quantumRangeCell.value).toBeNull();
    expect(quantumRangeCell.gapKey).toBe('codex.summary.gap.noQuantum');
  });

  it('carries a real delta from stock to current for the same KPI', () => {
    const cells = buildKpiCells(missionById('combat'), sheet({ shieldHp: 1000 }), sheet({ shieldHp: 1200 }));
    const shieldCell = cells.find((c) => c.key === 'shieldHp')!;
    expect(shieldCell.delta?.direction).toBe('up');
    expect(shieldCell.delta?.good).toBeTrue();
  });
});

describe('codex-loadout-stats — buildOffensivePanel', () => {
  it('omits the missile section entirely when nothing is fitted', () => {
    const panel = buildOffensivePanel([gun({})]);
    expect(panel.missileCount).toBe(0);
    expect(panel.missileSalvoDamage).toBeNull();
  });

  it('takes the MINIMUM range across guns as the effective range, noting the outlier', () => {
    const panel = buildOffensivePanel([
      gun({ className: 'ShortGun', speed: 1000, lifetime: 1 }), // 1000m
      gun({ className: 'LongGun', speed: 1000, lifetime: 2 }), // 2000m
    ]);
    expect(panel.effectiveRange).toBe(1000);
    expect(panel.longestRangeGun).toBe('LongGun');
  });

  it('flags a mixed-range warning only once the longest gun exceeds 115% of the effective range', () => {
    const justUnder = buildOffensivePanel([
      gun({ className: 'A', speed: 1000, lifetime: 1 }), // 1000
      gun({ className: 'B', speed: 1000, lifetime: 1.1 }), // 1100 = 110%
    ]);
    expect(justUnder.mixedRangeWarning).toBeFalse();

    const over = buildOffensivePanel([
      gun({ className: 'A', speed: 1000, lifetime: 1 }), // 1000
      gun({ className: 'B', speed: 1000, lifetime: 1.2 }), // 1200 = 120%
    ]);
    expect(over.mixedRangeWarning).toBeTrue();
  });

  it('takes the MINIMUM projectile speed across guns', () => {
    const panel = buildOffensivePanel([
      gun({ className: 'Slow', speed: 800, lifetime: 1 }),
      gun({ className: 'Fast', speed: 1600, lifetime: 1 }),
    ]);
    expect(panel.projectileSpeed).toBe(800);
  });

  it('reports the noStockGuns gap when nothing resolves to a real gun', () => {
    const panel = buildOffensivePanel([]);
    expect(panel.gapKeys).toContain('codex.summary.gap.noStockGuns');
  });
});

describe('codex-loadout-stats — buildDefensivePanel', () => {
  it('sums HP/regen across ALL fitted generators (active/passive split is cut)', () => {
    const panel = buildDefensivePanel([shield({ hp: 1000, regen: 50 }), shield({ hp: 500, regen: 20 })], null);
    expect(panel.shieldHp).toBe(1500);
    expect(panel.shieldRegen).toBe(70);
  });

  it('reads delay figures from the STRONGEST generator', () => {
    const panel = buildDefensivePanel(
      [
        shield({ hp: 2000, regen: 50, delayDamaged: 4, delayDowned: 6 }),
        shield({ hp: 500, regen: 20, delayDamaged: 1, delayDowned: 2 }),
      ],
      null,
    );
    expect(panel.regenDelay).toBe(4);
    expect(panel.downedDelay).toBe(6);
  });

  it('flags a mixed-generator note when more than one distinct class is fitted', () => {
    const mixed = buildDefensivePanel(
      [shield({ className: 'A_Shield_S1' }), shield({ className: 'B_Shield_S1' })],
      null,
    );
    expect(mixed.mixedGeneratorNote).toBeTrue();

    const uniform = buildDefensivePanel(
      [shield({ className: 'A_Shield_S1' }), shield({ className: 'A_Shield_S1' })],
      null,
    );
    expect(uniform.mixedGeneratorNote).toBeFalse();
  });

  it('never computes hull HP or effective HP — always a named gap', () => {
    const panel = buildDefensivePanel([shield({})], null);
    expect(panel.hullHp).toBeNull();
    expect(panel.effectiveHp).toBeNull();
    expect(panel.gapKeys).toContain('codex.summary.gap.noHullMass');
  });

  it('computes armor reduction % as (1 - multiplier) when the extract carries it', () => {
    const armorPayload = {
      className: 'ARMR_Test_S1',
      stats: {
        SCItemVehicleArmorParams: {
          'damageMultiplier.physical': 0.7,
          'damageMultiplier.energy': 0.85,
        },
      },
    };
    const panel = buildDefensivePanel([], armorPayload);
    expect(panel.armor?.reductionPhysicalPct).toBeCloseTo(30, 5);
    expect(panel.armor?.reductionEnergyPct).toBeCloseTo(15, 5);
    expect(panel.gapKeys).not.toContain('codex.summary.gap.noArmorStats');
  });

  it('names the armor gap with the exact spec sentence key when the extract has no armor stats', () => {
    const panel = buildDefensivePanel([], null);
    expect(panel.gapKeys).toContain('codex.summary.gap.noArmorStats');
  });

  it('finds the ship ARMR_ item among resolved occupants by className prefix', () => {
    const occ: SummaryOccupant = {
      section: 'structure',
      kind: 'item',
      payload: { className: 'ARMR_Nomad_S1' },
      ammoPayload: undefined,
      count: 1,
    };
    expect(findArmorPayload([occ])).toEqual(occ.payload);
    expect(findArmorPayload([])).toBeNull();
  });
});
