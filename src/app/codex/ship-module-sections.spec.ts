import {
  CONFIGURABLE_SHIP_SECTIONS,
  SHIP_MODULE_SECTION_ORDER,
  ShipModuleSection,
  classifyShipModule,
  groupByShipSection,
  isConfigurableSection,
  isIndividualSection,
  isShieldControlPort,
  shipPortFamily,
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
  });

  it('files decoy / noise launchers under countermeasures, not under ordnance', () => {
    // Verbatim from the 4.9.0 CNOU_Nomad loadout (admin request 1add86a4):
    // both launchers used to land in the missile block, where they read as
    // ordnance a pilot cannot pick.
    expect(classifyShipModule('hardpoint_countermeasure_launcher_left')).toBe('countermeasures');
    expect(classifyShipModule('hardpoint_countermeasure_launcher_right')).toBe('countermeasures');
    expect(classifyShipModule('hardpoint_cml_left')).toBe('countermeasures');
    // …and the occupant alone is enough when the port name says nothing.
    expect(
      classifyShipModule('hardpoint_class_1', { subType: 'CountermeasureLauncher' }),
    ).toBe('countermeasures');
    expect(classifyShipModule('hardpoint_class_1', { attachType: 'WeaponDefensive' })).toBe(
      'countermeasures',
    );
  });

  it('keeps the missile racks themselves in the ordnance block', () => {
    expect(classifyShipModule('hardpoint_missiles_wing_left')).toBe('missiles');
    expect(classifyShipModule('hardpoint_missiles_wing_right')).toBe('missiles');
  });

  it('keeps the shield CONTROL module out of the shield block', () => {
    // 1add86a4 pulled it into the shield block and tagged it; 32659942 sent it
    // back to the airframe — invisible in game, not swappable, and a fourth row
    // in a three-shield block reads as a fourth shield.
    expect(classifyShipModule('hardpoint_controller_shield')).toBe('structure');
    expect(classifyShipModule('hardpoint_class_1', { attachType: 'ShieldController' })).toBe(
      'structure',
    );
    // The generator bays themselves are untouched — they are the choice.
    expect(classifyShipModule('hardpoint_shield_generator_01')).toBe('shields');
    expect(isShieldControlPort('hardpoint_controller_shield')).toBe(true);
    expect(isShieldControlPort('hardpoint_shield_generator_01')).toBe(false);
    expect(isShieldControlPort(null, { attachType: 'ShieldController' })).toBe(true);
    // The fire-group module stays fixed: it holds nothing and offers no choice.
    expect(classifyShipModule('hardpoint_controller_weapon')).toBe('structure');
    expect(isShieldControlPort('hardpoint_controller_weapon')).toBe(false);
  });

  it('files the quantum drive\'s internal tank as airframe, not as a quantum choice', () => {
    // "Internal Tank" sat next to the drive and cannot be changed (32659942).
    expect(classifyShipModule('hardpoint_quantum_fuel_tank')).toBe('structure');
    expect(classifyShipModule('hardpoint_fuel_tank_internal_01')).toBe('structure');
    expect(classifyShipModule('hardpoint_class_2', { attachType: 'QuantumFuelTank' })).toBe(
      'structure',
    );
    // …while the drive itself stays exactly where it was.
    expect(classifyShipModule('hardpoint_quantum_drive')).toBe('quantum');
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

  it('drops the countermeasures below everything a pilot can change', () => {
    // 32659942: the launchers cannot be swapped in game, so the block moves out
    // of the decision list — still its own block, just under it.
    const order = [...SHIP_MODULE_SECTION_ORDER];
    expect(order.indexOf('countermeasures')).toBe(order.indexOf('lifeSupport') + 1);
    expect(order.indexOf('countermeasures')).toBe(order.indexOf('structure') - 1);
  });

  it('marks the countermeasures and the airframe as non-configurable', () => {
    for (const s of SHIP_MODULE_SECTION_ORDER) {
      expect(isConfigurableSection(s)).toBe(s !== 'structure' && s !== 'countermeasures');
    }
  });

  it('lists shields, countermeasures and coolers slot by slot, everything else collapsed', () => {
    for (const s of SHIP_MODULE_SECTION_ORDER) {
      expect(isIndividualSection(s)).toBe(
        s === 'shields' || s === 'countermeasures' || s === 'coolers',
      );
    }
  });
});

describe('shipPortFamily', () => {
  it('gives the Nomad\'s three shield bays one family', () => {
    const family = shipPortFamily('hardpoint_shield_generator_02');
    expect(family).toBe('hardpoint_shield_generator');
    expect(shipPortFamily('hardpoint_shield_generator_01')).toBe(family);
    expect(shipPortFamily('hardpoint_shield_generator_03')).toBe(family);
  });

  it('strips stacked positional words, not the identity of the port', () => {
    expect(shipPortFamily('hardpoint_weapon_top_left')).toBe('hardpoint_weapon');
    expect(shipPortFamily('hardpoint_cooler_right')).toBe('hardpoint_cooler');
    // The fire-group controller carries no positional tail — it keeps its name.
    expect(shipPortFamily('hardpoint_controller_weapon')).toBe('hardpoint_controller_weapon');
  });

  it('never strips a port down to nothing', () => {
    expect(shipPortFamily('left')).toBe('left');
    expect(shipPortFamily('hardpoint_01')).toBe('hardpoint_01');
    expect(shipPortFamily(null)).toBe('');
  });

  it('does not merge unrelated bays that merely share a prefix', () => {
    expect(shipPortFamily('hardpoint_weapon_rack_01')).not.toBe(
      shipPortFamily('hardpoint_weapon_top_left'),
    );
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
