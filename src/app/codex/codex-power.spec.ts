import {
  classifyPowerGroup,
  clickPowerPip,
  computePowerSheet,
  coolerUnitCount,
  migrateLegacyCoolerDraft,
  occupantDraw,
  parseCoolerUnit,
  parsePowerGroups,
  parsePowerLevels,
  POWER_GROUP_ORDER,
  resetPowerState,
  togglePowerGroup,
  type PowerColumnKey,
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
  attachType?: string;
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
      attachType: o.attachType ?? null,
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

  it('charges the flight controller to the thrusters group (#227)', () => {
    // LIVE 4.9: thrusters draw no power themselves; the ship's FlightController
    // item does, and its port is airframe furniture (section `structure`).
    const fc = occ({
      section: 'structure',
      entityKind: 'item',
      className: 'Controller_Flight_ARGO_RAFT',
      attachType: 'FlightController',
      resource: { 'power.consumeSegments': 6 },
    });
    expect(classifyPowerGroup(fc)).toBe('thrusters');
    expect(occupantDraw(fc).consumeSegments).toBe(6);
  });

  it('routes a powered radar / life-support ITEM by its attach type (#227)', () => {
    const radar = occ({ section: 'structure', entityKind: 'item', className: 'RADR_NAVE_S01_SNSR6', attachType: 'Radar' });
    const life = occ({ section: 'structure', entityKind: 'item', className: 'LFSP_TYDT_S02_ComfortAirPlus', attachType: 'LifeSupportGenerator' });
    expect(classifyPowerGroup(radar)).toBe('radar');
    expect(classifyPowerGroup(life)).toBe('life');
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
    // one cooler installed: its column is the unit, not the group
    expect(sheet.groups.map((g) => g.key)).toEqual([...POWER_GROUP_ORDER.slice(0, 7), 'cooler1']);
  });

  it('renders the eight groups in the order the admin fixed (590230e3), absent ones included', () => {
    // Waffen, Antriebe, Schilde, Quantum, Tractor, Radar, Lebenserhaltung, Kühlung
    expect(sheet.groups.map((g) => g.group)).toEqual([
      'weapons',
      'thrusters',
      'shields',
      'quantum',
      'tractor',
      'radar',
      'life',
      'coolers',
    ]);
    // the Nomad has no quantum drive and no tractor beam — the columns stay
    expect(sheet.groups.find((g) => g.group === 'tractor')!.state).toBe('absent');
    expect(sheet.groups.length).toBe(8);
  });

  it('prints the exact demand the stat sheet prints, and ceils it once for the pips', () => {
    // three 1.0-unit repeaters = 3 / (4/3) = 2.25 segments → 3 pips
    const weapons = sheet.groups.find((g) => g.group === 'weapons')!;
    expect(weapons.demand).toBe(2.25);
    expect(weapons.capacity).toBe(3);
    const shield = sheet.groups.find((g) => g.group === 'shields')!;
    expect(shield.demand).toBe(3);
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
    let cut: ReadonlySet<PowerColumnKey> = new Set();
    cut = togglePowerGroup(cut, 'weapons');
    expect(cut.has('weapons')).toBeTrue();
    cut = togglePowerGroup(cut, 'weapons');
    expect(cut.has('weapons')).toBeFalse();
  });

  it('resets to auto / SCM / nothing cut / no pins', () => {
    const s = resetPowerState();
    expect(s.mode).toBe('scm');
    expect(s.preset).toBe('auto');
    expect(s.cutGroups.size).toBe(0);
    expect(s.levels).toEqual({});
  });

  it('drops unknown group keys when parsing', () => {
    expect([...parsePowerGroups(['weapons', 'nope', 'radar'])]).toEqual(['weapons', 'radar']);
  });

  it('accepts cooler unit keys and the legacy group key when parsing (F1d)', () => {
    expect([...parsePowerGroups(['cooler1', 'cooler2', 'coolers', 'cooler0', 'cooler', 'coolerx'])]).toEqual([
      'cooler1',
      'cooler2',
      'coolers',
    ]);
    expect(parsePowerLevels({ cooler2: 3, coolers: '4', cooler0: 1, nope: 2 })).toEqual({ cooler2: 3, coolers: 4 });
    expect(parseCoolerUnit('cooler12')).toBe(12);
    expect(parseCoolerUnit('coolers')).toBeNull();
    expect(parseCoolerUnit('cooler01')).toBeNull();
  });
});

describe('clickPowerPip (590230e3)', () => {
  const none: ReadonlySet<PowerColumnKey> = new Set();
  const shields = { key: 'shields' as const, allocated: 3, capacity: 3, cut: false };

  it('clicking pip N pins the group at exactly N', () => {
    const r = clickPowerPip(none, {}, shields, 2);
    expect(r.levels).toEqual({ shields: 2 });
    expect(r.cutGroups.has('shields')).toBeFalse();
  });

  it('clicking the topmost pip of a group at full capacity switches it off', () => {
    const r = clickPowerPip(none, { shields: 3 }, shields, 3);
    expect(r.cutGroups.has('shields')).toBeTrue();
    expect(r.levels).toEqual({});
  });

  it('the top pip does NOT switch off a group that is below capacity — it raises it', () => {
    const r = clickPowerPip(none, {}, { ...shields, allocated: 1 }, 3);
    expect(r.cutGroups.has('shields')).toBeFalse();
    expect(r.levels).toEqual({ shields: 3 });
  });

  it('any pip on a cut group switches it back on at that level', () => {
    const r = clickPowerPip(new Set<PowerColumnKey>(['shields']), {}, { ...shields, allocated: 0, cut: true }, 3);
    expect(r.cutGroups.has('shields')).toBeFalse();
    expect(r.levels).toEqual({ shields: 3 });
  });

  it('clamps the level to the stack and keeps other pins', () => {
    const r = clickPowerPip(none, { cooler1: 2 }, { ...shields, allocated: 1 }, 9);
    expect(r.levels).toEqual({ cooler1: 2, shields: 3 });
  });

  it('a cooler unit pins and cuts under its own key, the sibling unit is untouched', () => {
    const unit2 = { key: 'cooler2' as const, allocated: 3, capacity: 3, cut: false };
    const pinned = clickPowerPip(none, { cooler1: 1 }, unit2, 2);
    expect(pinned.levels).toEqual({ cooler1: 1, cooler2: 2 });
    const cut = clickPowerPip(none, {}, unit2, 3);
    expect([...cut.cutGroups]).toEqual(['cooler2']);
  });
});

describe('cooler units (590230e3, F1d)', () => {
  const twoCoolers = nomad.map((o) => (o === coolers ? { ...o, count: 2 } : o));
  const noCoolers = nomad.filter((o) => o !== coolers);
  const cooler2 = occ({
    section: 'coolers',
    componentKind: 'Cooler',
    className: 'COOL_JUST_S01_UltraFlow_B',
    resource: { 'power.consumeSegments': 2, 'power.minFraction': 0.5, 'coolant.generate': 20, 'ir.nominal': 500 },
  });
  const col = (s: ReturnType<typeof computePowerSheet>, key: string) => s.groups.find((g) => g.key === key)!;

  it('renders one column per installed cooler, in hardpoint order, after the seven groups', () => {
    const s = computePowerSheet({ occupants: twoCoolers });
    const cols = s.groups.filter((g) => g.group === 'coolers');
    expect(cols.map((g) => g.key)).toEqual(['cooler1', 'cooler2']);
    expect(cols.map((g) => g.unit)).toEqual([1, 2]);
    expect(s.groups.map((g) => g.key).slice(0, 7)).toEqual([...POWER_GROUP_ORDER.slice(0, 7)]);
    expect(s.groups.length).toBe(9);
    expect(coolerUnitCount(twoCoolers)).toBe(2);
    expect(coolerUnitCount(noCoolers)).toBe(0);
  });

  it('does NOT sum the units: each carries its own demand, capacity, minimum and pips', () => {
    const s = computePowerSheet({ occupants: twoCoolers });
    for (const key of ['cooler1', 'cooler2']) {
      const c = col(s, key);
      expect(c.demand).toBe(3);
      expect(c.capacity).toBe(3);
      expect(c.minimum).toBe(2); // 3 x 0.6667 -> 2 (R6), per unit
      expect(c.items).toBe(1);
      expect(c.pips.length).toBe(3);
    }
  });

  it('splits a mixed pair into two columns with their own figures', () => {
    const s = computePowerSheet({ occupants: [...nomad, cooler2] });
    const [a, b] = s.groups.filter((g) => g.group === 'coolers');
    expect(a.capacity).toBe(3);
    expect(b.capacity).toBe(2);
    expect(b.minimum).toBe(1);
  });

  it('labels the units by their hardpoint index and keeps the group tooltip', () => {
    const s = computePowerSheet({ occupants: twoCoolers });
    const c = col(s, 'cooler2');
    expect(c.labelKey).toBe('codex.energy.group.coolerUnit');
    expect(c.labelParams).toEqual({ n: 2 });
    expect(c.tooltipTitleKey).toBe('codex.energy.group.coolerUnit');
    expect(c.tooltipBodyKey).toBe('codex.energy.tooltip.coolers');
    expect(col(s, 'weapons').labelParams).toBeUndefined();
  });

  it('pins, cuts and the powered set work per unit', () => {
    const auto = computePowerSheet({ occupants: twoCoolers });
    const pinned = computePowerSheet({ occupants: twoCoolers, levels: { cooler2: 1 } });
    expect(col(pinned, 'cooler2').allocated).toBe(1);
    expect(col(pinned, 'cooler2').pinned).toBeTrue();
    expect(col(pinned, 'cooler2').belowMinimum).toBeTrue();
    expect(col(pinned, 'cooler1').pinned).toBeFalse();
    expect(col(pinned, 'cooler1').allocated).toBe(col(auto, 'cooler1').allocated);

    const cut = computePowerSheet({ occupants: twoCoolers, cutGroups: ['cooler1'], previous: auto });
    expect(col(cut, 'cooler1').state).toBe('off');
    expect(col(cut, 'cooler2').state).toBe('active');
    // only the cut unit's signature leaves the IR sum: one UltraFlow = 7130
    expect(cut.facts.find((f) => f.key === 'ir')!.delta).toBe(-7130);
    // the ship-wide coolant balance is untouched by the split
    expect(auto.coolant.total).toBe(68);
  });

  it('a ship without coolers keeps ONE empty cooling column so the row never shifts', () => {
    const s = computePowerSheet({ occupants: noCoolers });
    const cols = s.groups.filter((g) => g.group === 'coolers');
    expect(cols.length).toBe(1);
    expect(cols[0].key).toBe('coolers');
    expect(cols[0].unit).toBeNull();
    expect(cols[0].state).toBe('absent');
    expect(cols[0].labelKey).toBe('codex.energy.group.coolers');
    expect(s.groups.length).toBe(8);
  });

  it('a legacy single `coolers` cut/pin is mapped onto every unit on load', () => {
    const cut = migrateLegacyCoolerDraft(new Set<PowerColumnKey>(['coolers', 'weapons']), {}, 2);
    expect([...cut.cutGroups].sort()).toEqual(['cooler1', 'cooler2', 'weapons']);
    // a pin of 5 on the summed group -> ceil(5 / 2) = 3 per unit, the total stays
    const pin = migrateLegacyCoolerDraft(new Set<PowerColumnKey>(), { coolers: 5, shields: 2 }, 2);
    expect(pin.levels).toEqual({ cooler1: 3, cooler2: 3, shields: 2 });
    // a unit that already has its own pin keeps it
    const mixed = migrateLegacyCoolerDraft(new Set<PowerColumnKey>(), { coolers: 4, cooler1: 1 }, 2);
    expect(mixed.levels).toEqual({ cooler1: 1, cooler2: 2 });
    // nothing to map onto: no coolers, or no legacy entry
    const none = migrateLegacyCoolerDraft(new Set<PowerColumnKey>(['coolers']), { coolers: 4 }, 0);
    expect([...none.cutGroups]).toEqual(['coolers']);
    const untouched = migrateLegacyCoolerDraft(new Set<PowerColumnKey>(['weapons']), { cooler1: 1 }, 2);
    expect(untouched.levels).toEqual({ cooler1: 1 });
    // and the migrated draft actually drives the sheet per unit
    const s = computePowerSheet({ occupants: twoCoolers, cutGroups: cut.cutGroups, levels: pin.levels });
    expect(s.groups.filter((g) => g.group === 'coolers').every((g) => g.state === 'off')).toBeTrue();
  });
});
