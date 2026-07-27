import {
  CONFIGURABLE_SHIP_SECTIONS,
  SHIP_MODULE_SECTION_ORDER,
  ShipModuleSection,
  classifyShipModule,
  groupByShipSection,
  isConfigurableSection,
} from './ship-module-sections';

// Port names below are verbatim from the 4.9.0 catalog (build b77f1586) —
// AEGS_Gladius, MISC_Reliant_Mako, ORIG_600i and CRUS_Starlifter loadouts —
// so a regression here is a regression against real data, not against a
// made-up naming scheme.

describe('classifyShipModule', () => {
  it('puts guns and their mounts under weapons', () => {
    expect(classifyShipModule('hardpoint_gun_nose')).toBe('weapons');
    expect(classifyShipModule('Hardpoint_Weapon_Wing_S1_Left')).toBe('weapons');
    expect(classifyShipModule('hardpoint_weapon_left_gimbal')).toBe('weapons');
  });

  it('separates remote turrets from the pilot weapons', () => {
    expect(classifyShipModule('hardpoint_remote_turret_bottom')).toBe('remoteTurrets');
    expect(classifyShipModule('hardpoint_turret_top')).toBe('remoteTurrets');
  });

  it('reads a gimbal mount as a weapon even though the extract types it GunTurret', () => {
    // Mount_Gimbal_S2 really is `subType: GunTurret` in the catalog — only the
    // port it bolts onto tells a pilot it is a pilot-fired wing gun.
    expect(
      classifyShipModule('Hardpoint_Weapon_Wing_S1_Left', { subType: 'GunTurret' }),
    ).toBe('weapons');
  });

  it('keeps a missile rack out of the weapons block even when the port says "weapon"', () => {
    expect(classifyShipModule('hardpoint_weapon_missilerack_right_wing')).toBe('missiles');
    expect(classifyShipModule('hardpoint_missile_rack_left')).toBe('missiles');
    expect(classifyShipModule('hardpoint_countermeasure_launcher_left')).toBe('missiles');
  });

  it('never mistakes furniture for armament', () => {
    // These all carry an armament keyword and are a ladder, a locker and the
    // fire-group module respectively.
    expect(classifyShipModule('hardpoint_turret_seataccess')).toBe('structure');
    expect(classifyShipModule('hardpoint_weapon_rack')).toBe('structure');
    expect(classifyShipModule('hardpoint_Weapon_Cabinet_19')).toBe('structure');
    expect(classifyShipModule('hardpoint_controller_weapon')).toBe('structure');
  });

  it('files the remaining configurable blocks by port name', () => {
    expect(classifyShipModule('hardpoint_shield_generator_left')).toBe('shields');
    expect(classifyShipModule('hardpoint_power_plant')).toBe('powerPlants');
    expect(classifyShipModule('hardpoint_quantum_drive')).toBe('quantum');
    expect(classifyShipModule('hardpoint_quantum_fuel_tank')).toBe('quantum');
    expect(classifyShipModule('hardpoint_radar')).toBe('radar');
    expect(classifyShipModule('Hardpoint_cooler_left')).toBe('coolers');
    expect(classifyShipModule('Hardpoint_Life_Support')).toBe('lifeSupport');
    expect(classifyShipModule('hardpoint_esc_pod_lower_left')).toBe('pod');
    expect(classifyShipModule('hardpoint_mining_pod_3')).toBe('pod');
  });

  it('falls back to what is installed when the port name says nothing', () => {
    // A mount's own sub-port ("hardpoint_class_2") identifies itself only
    // through its occupant.
    expect(classifyShipModule('hardpoint_class_2', { componentKind: 'Shield' })).toBe('shields');
    expect(classifyShipModule('hardpoint_class_2', { subType: 'MissileRack' })).toBe('missiles');
    expect(classifyShipModule('hardpoint_class_2', { attachType: 'Radar' })).toBe('radar');
  });

  it('ignores the engine placeholder types instead of letting them win', () => {
    expect(classifyShipModule('hardpoint_unknown_thing', { subType: 'UNDEFINED' })).toBe(
      'structure',
    );
  });

  it('is total — anything unrecognised is fixed structure, never dropped', () => {
    expect(classifyShipModule(null)).toBe('structure');
    expect(classifyShipModule('')).toBe('structure');
    expect(classifyShipModule('landingpad_helper')).toBe('structure');
    expect(classifyShipModule('hardpoint_thruster_main_left')).toBe('structure');
  });
});

describe('SHIP_MODULE_SECTION_ORDER', () => {
  it('leads with everything a pilot can configure, in the requested order', () => {
    expect(SHIP_MODULE_SECTION_ORDER.slice(0, CONFIGURABLE_SHIP_SECTIONS.length)).toEqual([
      'weapons',
      'remoteTurrets',
      'missiles',
      'pod',
      'shields',
      'powerPlants',
      'quantum',
      'radar',
      'coolers',
      'lifeSupport',
    ]);
    expect(SHIP_MODULE_SECTION_ORDER[SHIP_MODULE_SECTION_ORDER.length - 1]).toBe('structure');
  });

  it('marks exactly the fixed block as non-configurable', () => {
    for (const s of SHIP_MODULE_SECTION_ORDER) {
      expect(isConfigurableSection(s)).toBe(s !== 'structure');
    }
  });
});

describe('groupByShipSection', () => {
  const ports = [
    'hardpoint_thruster_main_left',
    'hardpoint_gun_nose',
    'hardpoint_shield_generator_left',
    'hardpoint_gun_left_wing',
  ];

  it('emits blocks in display order and preserves input order inside them', () => {
    const groups = groupByShipSection(ports, (p) => classifyShipModule(p));
    expect(groups.map((g) => g.section)).toEqual(['weapons', 'shields', 'structure']);
    expect(groups[0].rows).toEqual(['hardpoint_gun_nose', 'hardpoint_gun_left_wing']);
  });

  it('loses no hardpoint — every input lands in exactly one block', () => {
    const groups = groupByShipSection(ports, (p) => classifyShipModule(p));
    const total = groups.reduce((n, g) => n + g.rows.length, 0);
    expect(total).toBe(ports.length);
  });

  it('omits blocks the hull has no hardpoint for', () => {
    const groups = groupByShipSection(['hardpoint_gun_nose'], () => 'weapons' as ShipModuleSection);
    expect(groups.length).toBe(1);
  });
});
