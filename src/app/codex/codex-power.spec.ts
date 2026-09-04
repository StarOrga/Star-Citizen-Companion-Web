import {
  classifyPowerGroup,
  computePowerSheet,
  occupantDraw,
  parsePowerGroups,
  POWER_GROUP_ORDER,
  resetPowerState,
  togglePowerGroup,
  type PowerGroup,
} from './codex-power';
import type { SummaryOccupant } from './ship-summary-panels';
import type { ShipModuleSection } from './ship-module-sections';

// ── fixtures ────────────────────────────────────────────────────────────────
// A Nomad-shaped loadout built from the probe's real key shapes: reactor 14
// generated segments, cooler 34 coolant/s, shield 3 segments @ minFraction 0.5,
// weapons drawing STANDARD units (1.0 each, no whole segment on their own).

type Res = Record<string, number>;

interface OccOptions {
  section: ShipModuleSection;
  entityKind?: string;
  componentKind?: string;
  className?: string;
  count?: number;
  resource?: Res;
  extraStats?: Record<string, Record<string, unknown>>;
}

function occ(o: OccOptions): SummaryOccupant {
  const stats: Record<string, Record<string, unknown>> = { ...(o.extraStats ?? {}) };
  if (o.resource) {
    stats['ItemResourceComponentParams'] = Object.fromEntries(
      Object.entries(o.resource).map(([k, v]) => [`online.${k}`, v]),
    );
  }
  return {
    section: o.section,
    kind: o.entityKind ?? 'component',
    count: o.count ?? 1,
    payload: {
      entityKind: o.entityKind ?? 'component',
      kind: o.componentKind,
      className: o.className ?? 'TEST_ITEM',
      size: 1,
      stats,
    },
  };
}

const reactor = occ({
  section: 'powerPlants',
  componentKind: 'PowerPlant',
  className: 'POWR_LPLT_S01_IonBurst',
  resource: { 'power.generateSegments': 14 },
});

const weapon = (n: number, em: number, ir: number) =>
  occ({
    section: 'weapons',
    entityKind: 'weapon',
    className: `KLWE_LaserRepeater_S3_${n}`,
    resource: { 'power.consumeUnits': 1.0, 'coolant.consume': 3, 'em.nominal': em, 'ir.nominal': ir },
  });

const shields = occ({
  section: 'shields',
  componentKind: 'Shield',
  className: 'SHLD_SECO_S01_WEB',
  resource: {
    'power.consumeSegments': 3,
    'power.minFraction': 0.5,
    'shield.generate': 410,
    'coolant.consume': 6,
    'em.nominal': 1500,
  },
});

const coolers = occ({
  section: 'coolers',
  componentKind: 'Cooler',
  className: 'COOL_JUST_S01_UltraFlow',
  resource: {
    'power.consumeSegments': 3,
    'power.minFraction': 0.6667,
    'coolant.generate': 34,
    'coolant.consume': 2,
    'em.nominal': 1490,
    'ir.nominal': 7130,
  },
});

const thrusters = occ({
  section: 'structure',
  componentKind: 'Thruster',
  className: 'MAIN_THRUSTER',
  resource: { 'power.consumeSegments': 1, 'coolant.consume': 4 },
});

const radar = occ({
  section: 'radar',
  className: 'RADAR_S01',
  // NB: the concept's own group table (C §4 B-C1) lists 3+3+1+3+4+1 and calls
  // it 14 — that adds up to 15. We keep the printed budget (14 / 14 -> 11 / 14)
  // and give the radar 3 segments, since the budget is the number the concept
  // asserts twice and the per-column split only once.
  resource: { 'power.consumeSegments': 3, 'coolant.consume': 8 },
});

const life = occ({
  section: 'lifeSupport',
  className: 'LIFE_S01',
  resource: { 'power.consumeSegments': 1, 'coolant.consume': 2 },
});

const nomad: SummaryOccupant[] = [
  reactor,
  weapon(1, 278, 277),
  weapon(2, 278, 277),
  weapon(3, 278, 276),
  shields,
  coolers,
  thrusters,
  radar,
  life,
];

const shipStats = { SSCSignatureSystemParams: { 'crossSection.x': 9712, 'crossSection.y': 4100, 'crossSection.z': 2300 } };

describe('classifyPowerGroup', () => {
  it('maps weapons, component kinds, sections and port names', () => {
    expect(classifyPowerGroup(weapon(1, 0, 0))).toBe('weapons');
    expect(classifyPowerGroup(shields)).toBe('shields');
    expect(classifyPowerGroup(coolers)).toBe('coolers');
    expect(classifyPowerGroup(thrusters)).toBe('thrusters');
    expect(classifyPowerGroup(radar)).toBe('radar');
    expect(classifyPowerGroup(life)).toBe('life');
  });

  it('gives the reactor NO group — it funds the budget, it does not spend it', () => {
    expect(classifyPowerGroup(reactor)).toBeNull();
  });

  it('routes a tractor beam out of the weapons group', () => {
    const tractor = occ({ section: 'weapons', entityKind: 'weapon', className: 'TRACTOR_BEAM_S1' });
    expect(classifyPowerGroup(tractor)).toBe('tractor');
  });
});

describe('occupantDraw', () => {
  it('scales every figure by the hardpoint count', () => {
    const d = occupantDraw({ ...weapon(1, 100, 50), count: 3 });
    expect(d.consumeUnits).toBe(3);
    expect(d.emNominal).toBe(300);
    expect(d.irNominal).toBe(150);
  });

  it('flags an item without any resource group as missing, not as zero-draw', () => {
    expect(occupantDraw(occ({ section: 'radar' })).missing).toBeTrue();
    expect(occupantDraw(coolers).missing).toBeFalse();
  });
});

describe('computePowerSheet — the Nomad baseline', () => {
  const sheet = computePowerSheet({ occupants: nomad, shipStats });

  it('reads the reactor budget from generated segments', () => {
    expect(sheet.budgetTotal).toBe(14);
    expect(sheet.available).toBeTrue();
    expect(sheet.gapKeys).toEqual([]);
  });

  it('allocates 14 of 14 segments across the six live groups', () => {
    expect(sheet.budgetUsed).toBe(14);
    const byGroup = Object.fromEntries(sheet.groups.map((g) => [g.group, g.allocated]));
    expect(byGroup['weapons']).toBe(3); // 3 × 1.0 standard units, ceil'd once
    expect(byGroup['shields']).toBe(3);
    expect(byGroup['thrusters']).toBe(1);
    expect(byGroup['coolers']).toBe(3);
    expect(byGroup['radar']).toBe(3);
    expect(byGroup['life']).toBe(1);
  });

  it('keeps the dock column order', () => {
    expect(sheet.groups.map((g) => g.group)).toEqual([...POWER_GROUP_ORDER]);
  });

  it('marks the shield minimum as two gold pips (3 × 0.5, rounded up)', () => {
    const shield = sheet.groups.find((g) => g.group === 'shields')!;
    expect(shield.minimum).toBe(2);
    expect(shield.pips.map((p) => p.kind)).toEqual(['min', 'min', 'on']);
    expect(shield.pips[2].numeral).toBe(3);
  });

  it('gives the quantum drive no channel in SCM', () => {
    const q = sheet.groups.find((g) => g.group === 'quantum')!;
    expect(q.allocated).toBe(0);
    expect(q.state).toBe('absent');
  });

  it('reports coolant 31 / 34 and the cross-section from the hull', () => {
    expect(sheet.coolant).toEqual({ used: 31, total: 34, percent: 91 });
    expect(sheet.facts.find((f) => f.key === 'crossSection')!.value).toBe(9712);
  });

  it('is ready for combat when the reactor covers every minimum', () => {
    expect(sheet.ready).toBeTrue();
    expect(sheet.readinessKey).toBe('codex.energy.readiness.ok');
  });
});

describe('computePowerSheet — cutting the weapons group', () => {
  const before = computePowerSheet({ occupants: nomad, shipStats });
  const after = computePowerSheet({
    occupants: nomad,
    shipStats,
    cutGroups: ['weapons'],
    previous: before,
  });

  it('drops the budget from 14 to 11 occupied segments', () => {
    expect(after.budgetUsed).toBe(11);
    expect(after.budgetTotal).toBe(14);
  });

  it('empties the weapon pip stack and marks the group off', () => {
    const g = after.groups.find((x) => x.group === 'weapons')!;
    expect(g.state).toBe('off');
    expect(g.stateLabelKey).toBe('codex.energy.state.off');
    expect(g.pips.every((p) => p.kind === 'empty')).toBeTrue();
    expect(g.pips.length).toBe(3);
  });

  it('drops the cooling load from 31 to 22 with the denominator fixed', () => {
    expect(after.coolant.used).toBe(22);
    expect(after.coolant.total).toBe(34);
  });

  it('drops EM by 834 and IR by 830, both flagged lower-is-better', () => {
    const em = after.facts.find((f) => f.key === 'em')!;
    const ir = after.facts.find((f) => f.key === 'ir')!;
    expect(em.delta).toBe(-834);
    expect(ir.delta).toBe(-830);
    expect(em.lowerIsBetter).toBeTrue();
  });

  it('never moves the cross-section', () => {
    const cs = after.facts.find((f) => f.key === 'crossSection')!;
    expect(cs.value).toBe(9712);
    expect(cs.delta).toBeNull();
  });

  it('reports the weapons cut so the KPI strip can zero the DPS', () => {
    expect(after.weaponsCut).toBeTrue();
    expect(before.weaponsCut).toBeFalse();
  });
});

describe('computePowerSheet — modes, presets and gaps', () => {
  it('NAV powers the quantum channel and drops the shields', () => {
    const withDrive = [
      ...nomad,
      occ({
        section: 'quantum',
        componentKind: 'QuantumDrive',
        className: 'QDRV_S01',
        resource: { 'power.consumeSegments': 2 },
      }),
    ];
    const nav = computePowerSheet({ occupants: withDrive, mode: 'nav' });
    expect(nav.groups.find((g) => g.group === 'quantum')!.allocated).toBe(2);
    const shield = nav.groups.find((g) => g.group === 'shields')!;
    expect(shield.allocated).toBe(0);
    expect(shield.state).toBe('noChannel');
    expect(shield.stateLabelKey).toBe('codex.energy.state.noChannel');
  });

  it('the stealth preset runs every group at its gold minimum', () => {
    const stealth = computePowerSheet({ occupants: nomad, preset: 'stealth' });
    const shield = stealth.groups.find((g) => g.group === 'shields')!;
    expect(shield.allocated).toBe(shield.minimum);
    expect(stealth.budgetUsed).toBeLessThan(14);
  });

  it('reports gaps instead of zeros when the build carries no resource data', () => {
    const bare = computePowerSheet({
      occupants: [occ({ section: 'weapons', entityKind: 'weapon' })],
    });
    expect(bare.available).toBeFalse();
    expect(bare.budgetTotal).toBeNull();
    expect(bare.gapKeys).toContain('codex.energy.gap.reExtractPending');
    expect(bare.coolant.percent).toBeNull();
    expect(bare.facts.find((f) => f.key === 'em')!.value).toBeNull();
  });
});

describe('dock state helpers', () => {
  it('toggles a group in and out of the cut set', () => {
    let cut: ReadonlySet<PowerGroup> = new Set();
    cut = togglePowerGroup(cut, 'weapons');
    expect(cut.has('weapons')).toBeTrue();
    cut = togglePowerGroup(cut, 'weapons');
    expect(cut.has('weapons')).toBeFalse();
  });

  it('resets to auto / SCM / nothing cut', () => {
    const s = resetPowerState();
    expect(s.mode).toBe('scm');
    expect(s.preset).toBe('auto');
    expect(s.cutGroups.size).toBe(0);
  });

  it('drops unknown group keys when parsing', () => {
    expect([...parsePowerGroups(['weapons', 'nope', 'radar'])]).toEqual(['weapons', 'radar']);
  });
});
