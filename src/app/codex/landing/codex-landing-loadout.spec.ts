import type { ComponentKeyStats } from '../codex.service';
import { LandingItem } from './codex-landing-data.types';
import { hasLoadoutSet, parseCalloutSet, valuesForSet } from './codex-landing-callout-set.service';
import {
  loadoutAnchorPorts,
  loadoutComponentClasses,
  loadoutParts,
  loadoutValues,
  weaponText,
  withLoadoutClassStats,
} from './codex-landing-loadout';
import { splitCallouts, valueText } from './codex-landing-values';

const entry = (itemPortName: string, entityClassName: string | null) => ({ itemPortName, entityClassName });
const stat = (s: Partial<ComponentKeyStats>): ComponentKeyStats => ({ shield: null, quantum: null, power: null, cooling: null, ...s });

// Real AEGS_Gladius stock loadout (LIVE 4.3), trimmed to the parts that matter plus look-alikes that must be ignored.
const GLADIUS = {
  defaultLoadout: [
    entry('hardpoint_power_plant', 'POWR_AEGS_S01_Regulus_SCItem'),
    entry('hardpoint_controller_cooler', 'Controller_Cooler'),
    entry('Hardpoint_cooler_left', 'COOL_AEGS_S01_Bracer_SCItem'),
    entry('Hardpoint_cooler_right', 'COOL_AEGS_S01_Bracer_SCItem'),
    entry('hardpoint_controller_shield', 'Controller_Shield_AEGS_Gladius'),
    entry('hardpoint_shield_generator_left', 'SHLD_GODI_S01_AllStop_SCItem'),
    entry('hardpoint_shield_generator_right', 'SHLD_GODI_S01_AllStop_SCItem'),
    entry('hardpoint_quantum_drive', 'QDRV_WETK_S01_Beacon_SCItem'),
    entry('hardpoint_controller_weapon', 'Controller_Weapon'),
    entry('hardpoint_gun_nose', 'Mount_Gimbal_S3'),
    entry('hardpoint_gun_left_wing', 'Mount_Gimbal_S3'),
    entry('hardpoint_gun_right_wing', 'Mount_Gimbal_S3'),
    entry('hardpoint_weapon_rack', 'Weapon_Rack_AEGS_Gladius'),
    entry('hardpoint_paint', null),
  ],
};
const STATS = new Map<string, ComponentKeyStats>([
  ['SHLD_GODI_S01_AllStop_SCItem', stat({ shield: 3168 })],
  ['QDRV_WETK_S01_Beacon_SCItem', stat({ quantum: 161410896 })],
  ['POWR_AEGS_S01_Regulus_SCItem', stat({ power: 16 })],
  ['COOL_AEGS_S01_Bracer_SCItem', stat({ cooling: 34 })],
]);

describe('loadout callout set (#884)', () => {
  it('finds the five part types by class prefix and weapon port, skipping controllers and racks', () => {
    const parts = loadoutParts(GLADIUS);
    expect(parts['loadout.weapons']?.map((p) => p.port)).toEqual(['hardpoint_gun_nose', 'hardpoint_gun_left_wing', 'hardpoint_gun_right_wing']);
    expect(parts['loadout.shield']?.length).toBe(2);
    expect(parts['loadout.quantum']?.[0].port).toBe('hardpoint_quantum_drive');
    expect(parts['loadout.power']?.length).toBe(1);
    expect(parts['loadout.cooler']?.length).toBe(2);
  });

  it('anchors every value on its own mounts', () => {
    const ports = loadoutAnchorPorts(GLADIUS);
    expect(ports['loadout.shield']).toEqual(['hardpoint_shield_generator_left', 'hardpoint_shield_generator_right']);
    expect(ports['loadout.quantum']).toEqual(['hardpoint_quantum_drive']);
  });

  it('asks stats only for components, never for weapon mounts', () => {
    expect(loadoutComponentClasses(GLADIUS)).not.toContain('Mount_Gimbal_S3');
    expect(loadoutComponentClasses(GLADIUS)).toContain('QDRV_WETK_S01_Beacon_SCItem');
  });

  it('sums shields, power and cooling, takes the drive speed in km/s, counts weapons by size', () => {
    const vals = loadoutValues(GLADIUS, STATS);
    expect(vals.map((v) => v.key)).toEqual(['loadout.weapons', 'loadout.shield', 'loadout.quantum', 'loadout.power', 'loadout.cooler']);
    const by = Object.fromEntries(vals.map((v) => [v.key, v]));
    expect(valueText(by['loadout.weapons'])).toBe('3 × S3');
    expect(by['loadout.weapons'].value).toBe(9);
    expect(by['loadout.shield'].value).toBe(6336);
    expect(by['loadout.quantum']).toEqual(jasmine.objectContaining({ value: 161411, unit: 'km/s' }));
    expect(by['loadout.power'].value).toBe(16);
    expect(by['loadout.cooler'].value).toBe(68);
  });

  it('a missing part lets the next one move up into the three callouts', () => {
    const snub = { defaultLoadout: GLADIUS.defaultLoadout.filter((e) => !e.entityClassName?.startsWith('QDRV_')) };
    const { callouts, rest } = splitCallouts('ship', loadoutValues(snub, STATS));
    expect(callouts.map((c) => c.value.key).sort()).toEqual(['loadout.power', 'loadout.shield', 'loadout.weapons']);
    expect(rest.map((r) => r.key)).toEqual(['loadout.cooler']);
  });

  it('every loadout callout has a fallback zone, so none is left without an anchor', () => {
    const { callouts } = splitCallouts('ship', loadoutValues(GLADIUS, STATS));
    expect(callouts.length).toBe(3);
    for (const c of callouts) expect(c.anchor).toBeTruthy();
  });

  it('a component missing from the build yields no value, never a zero', () => {
    const vals = loadoutValues(GLADIUS, new Map());
    expect(vals.map((v) => v.key)).toEqual(['loadout.weapons']);
  });

  it('weaponText: mixed sizes as a range, unreadable sizes as a bare count', () => {
    expect(weaponText([2, 3, 3])).toBe('3 × S2–S3');
    expect(weaponText([3, null])).toBe('2');
  });

  it('compares with the class: more is better, fewer than two members gives no comparison', () => {
    const own = loadoutValues(GLADIUS, STATS);
    const [shield] = withLoadoutClassStats(
      own.filter((v) => v.key === 'loadout.shield'),
      [own, [{ key: 'loadout.shield', value: 7200, unit: 'hp' }]],
    );
    expect(shield).toEqual(jasmine.objectContaining({ classAvg: 6768, classMax: 7200, higherIsBetter: true }));
    const [alone] = withLoadoutClassStats(own.slice(0, 1), [own]);
    expect(alone.classAvg).toBeNull();
  });
});

describe('callout set selection (#884)', () => {
  const ship = (loadoutValues?: LandingItem['loadoutValues']) =>
    ({ category: 'ship', topValues: [{ key: 'hull.hp', value: 1, unit: 'hp' }], loadoutValues }) as LandingItem;

  it('flight is the default; loadout only where the ship has loadout values', () => {
    const it = ship([{ key: 'loadout.shield', value: 1, unit: 'hp' }]);
    expect(valuesForSet(it, 'flight')[0].key).toBe('hull.hp');
    expect(valuesForSet(it, 'loadout')[0].key).toBe('loadout.shield');
    expect(valuesForSet(ship([]), 'loadout')[0].key).toBe('hull.hp');
    expect(hasLoadoutSet(ship([]))).toBeFalse();
    expect(hasLoadoutSet({ ...ship([{ key: 'loadout.shield', value: 1, unit: 'hp' }]), category: 'tool' } as LandingItem)).toBeFalse();
  });

  it('parses only the two known sets', () => {
    expect(parseCalloutSet('loadout')).toBe('loadout');
    expect(parseCalloutSet('cargo')).toBeNull();
    expect(parseCalloutSet(null)).toBeNull();
  });
});
