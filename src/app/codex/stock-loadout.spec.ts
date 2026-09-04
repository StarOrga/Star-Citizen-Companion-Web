import { ItemPort, LoadoutEntry } from './codex.types';
import { CarriedEntity, carriedByPort, carriedSlots, stockLoadoutClassNames } from './stock-loadout';

// The shape the uploader emits for a Nomad gun mount: the gimbal bolts to the
// hull, the repeater sits in the gimbal's own sub-port.
const GUN_MOUNT: LoadoutEntry = {
  itemPortName: 'hardpoint_weapon_top_left',
  entityClassName: 'Mount_Gimbal_S3',
  entries: [{ itemPortName: 'hardpoint_class_2', entityClassName: 'KLWE_LaserRepeater_S3' }],
};

const MISSILE_RACK: LoadoutEntry = {
  itemPortName: 'hardpoint_missiles_wing_left',
  entityClassName: 'MRCK_S04_CNOU_Quad_S02_Left',
  entries: [
    { itemPortName: 'missile_01_attach', entityClassName: 'MISL_S02_A' },
    { itemPortName: 'missile_02_attach', entityClassName: 'MISL_S02_B' },
  ],
};

describe('carriedByPort', () => {
  it('maps a mount sub-port to the item the stock loadout puts in it', () => {
    expect([...carriedByPort(GUN_MOUNT)]).toEqual([
      ['hardpoint_class_2', 'KLWE_LaserRepeater_S3'],
    ]);
  });

  it('keeps every station of a rack, in order', () => {
    expect([...carriedByPort(MISSILE_RACK).keys()]).toEqual([
      'missile_01_attach',
      'missile_02_attach',
    ]);
  });

  it('is empty for an extract with no nested fit — "unknown", not "empty"', () => {
    const old: LoadoutEntry = { itemPortName: 'hardpoint_weapon_top_left', entityClassName: 'Mount_Gimbal_S3' };
    expect(carriedByPort(old).size).toBe(0);
    expect(carriedByPort(null).size).toBe(0);
    expect(carriedByPort(undefined).size).toBe(0);
  });

  it('skips sub-entries with no port or no occupant', () => {
    const entry: LoadoutEntry = {
      itemPortName: 'p',
      entityClassName: 'M',
      entries: [
        { itemPortName: null, entityClassName: 'X' },
        { itemPortName: 'empty_slot', entityClassName: null },
        { itemPortName: '  ', entityClassName: 'Y' },
        { itemPortName: 'good', entityClassName: 'Z' },
      ],
    };
    expect([...carriedByPort(entry)]).toEqual([['good', 'Z']]);
  });

  it('does not reach past the direct children', () => {
    const nested: LoadoutEntry = {
      itemPortName: 'hardpoint_turret',
      entityClassName: 'Turret',
      entries: [
        {
          itemPortName: 'turret_weapon',
          entityClassName: 'Mount',
          entries: [{ itemPortName: 'gun_seat', entityClassName: 'Gun' }],
        },
      ],
    };
    expect([...carriedByPort(nested).keys()]).toEqual(['turret_weapon']);
  });
});

describe('stockLoadoutClassNames', () => {
  it('collects sub-items as well as top-level ones', () => {
    expect(stockLoadoutClassNames([GUN_MOUNT])).toEqual([
      'Mount_Gimbal_S3',
      'KLWE_LaserRepeater_S3',
    ]);
  });

  it('dedupes: three identical mounts resolve once', () => {
    expect(stockLoadoutClassNames([GUN_MOUNT, GUN_MOUNT, GUN_MOUNT])).toEqual([
      'Mount_Gimbal_S3',
      'KLWE_LaserRepeater_S3',
    ]);
  });

  it('drops stock-empty ports', () => {
    const entries: LoadoutEntry[] = [
      { itemPortName: 'hardpoint_cockpit_flair', entityClassName: null },
      { itemPortName: 'hardpoint_radar', entityClassName: 'RADR_S01' },
    ];
    expect(stockLoadoutClassNames(entries)).toEqual(['RADR_S01']);
  });

  it('survives a missing or malformed loadout', () => {
    expect(stockLoadoutClassNames(null)).toEqual([]);
    expect(stockLoadoutClassNames(undefined)).toEqual([]);
    expect(stockLoadoutClassNames([])).toEqual([]);
  });

  it('stops on a cyclic payload instead of hanging', () => {
    const cyclic = { itemPortName: 'p', entityClassName: 'A' } as LoadoutEntry;
    cyclic.entries = [cyclic];
    expect(stockLoadoutClassNames([cyclic])).toEqual(['A']);
  });
});

describe('carriedSlots', () => {
  const port = (portName: string, types: string[], size: number | null = null): ItemPort => ({
    portName,
    minSize: size,
    maxSize: size,
    types,
    flags: [],
  });

  const CATALOG: Record<string, CarriedEntity> = {
    KLWE_LaserRepeater_S3: { kind: 'weapon', size: 3, displayName: 'CF-337 Panther Repeater' },
    MISL_S02_A: { kind: 'weapon', size: 2, displayName: 'Strike Force' },
    MISL_S02_B: { kind: 'weapon', size: 2, displayName: 'Arrester' },
  };
  const resolve = (cn: string): CarriedEntity | undefined => CATALOG[cn];
  const humanize = (p: string | null): string => p ?? '—';

  it('names the gun that sits inside a gun mount', () => {
    const slots = carriedSlots(
      [port('hardpoint_class_2', ['WeaponGun'], 3)],
      new Map([['hardpoint_class_2', 'KLWE_LaserRepeater_S3']]),
      resolve,
      humanize,
    );
    expect(slots.length).toBe(1);
    expect(slots[0].className).toBe('KLWE_LaserRepeater_S3');
    expect(slots[0].name).toBe('CF-337 Panther Repeater');
    expect(slots[0].kind).toBe('weapon');
    expect(slots[0].count).toBe(1);
  });

  it('keeps the sized placeholder when the extract knows no occupant', () => {
    const slots = carriedSlots([port('hardpoint_class_2', ['WeaponGun'], 3)], new Map(), resolve, humanize);
    expect(slots.length).toBe(1);
    expect(slots[0].className).toBeNull();
    expect(slots[0].name).toBeNull();
    expect(slots[0].size).toBe(3);
  });

  it('collapses four identical missiles into one 4x row', () => {
    const ports = [1, 2, 3, 4].map((i) => port(`missile_0${i}_attach`, ['Missile'], 2));
    const carried = new Map(ports.map((p) => [p.portName!, 'MISL_S02_A']));
    const slots = carriedSlots(ports, carried, resolve, humanize);
    expect(slots.length).toBe(1);
    expect(slots[0].count).toBe(4);
  });

  it('keeps every raw member port of a grouped row (R5) so one of several can still be addressed', () => {
    const ports = [1, 2, 3].map((i) => port(`gun_seat_0${i}`, ['WeaponGun'], 3));
    const carried = new Map(ports.map((p) => [p.portName!, 'KLWE_LaserRepeater_S3']));
    const slots = carriedSlots(ports, carried, resolve, humanize);
    expect(slots.length).toBe(1);
    expect(slots[0].rawPorts).toEqual(['gun_seat_01', 'gun_seat_02', 'gun_seat_03']);
    expect(slots[0].rawTypes).toEqual(['WeaponGun']);
  });

  it('records the single raw port of an ungrouped row', () => {
    const slots = carriedSlots(
      [port('hardpoint_class_2', ['WeaponGun'], 3)],
      new Map([['hardpoint_class_2', 'KLWE_LaserRepeater_S3']]),
      resolve,
      humanize,
    );
    expect(slots[0].rawPorts).toEqual(['hardpoint_class_2']);
  });

  it('does NOT collapse a mixed load into one row', () => {
    const ports = [1, 2].map((i) => port(`missile_0${i}_attach`, ['Missile'], 2));
    const carried = new Map([
      ['missile_01_attach', 'MISL_S02_A'],
      ['missile_02_attach', 'MISL_S02_B'],
    ]);
    const slots = carriedSlots(ports, carried, resolve, humanize);
    expect(slots.map((s) => s.className)).toEqual(['MISL_S02_A', 'MISL_S02_B']);
  });

  it('matches the sub-port name case-insensitively', () => {
    const slots = carriedSlots(
      [port('Hardpoint_Class_2', ['WeaponGun'], 3)],
      new Map([['hardpoint_class_2', 'KLWE_LaserRepeater_S3']]),
      resolve,
      humanize,
    );
    expect(slots[0].className).toBe('KLWE_LaserRepeater_S3');
  });

  it('skips an untyped sub-port only while nothing is installed in it', () => {
    const ports = [port('untyped_empty', []), port('untyped_filled', [])];
    const bare = carriedSlots(ports, new Map(), resolve, humanize);
    expect(bare).toEqual([]);
    const filled = carriedSlots(
      ports,
      new Map([['untyped_filled', 'MISL_S02_A']]),
      resolve,
      humanize,
    );
    expect(filled.map((s) => s.className)).toEqual(['MISL_S02_A']);
    expect(filled[0].typeLabel).toBeNull();
  });

  it('still lists an item installed in a sub-port the occupant never declares', () => {
    const slots = carriedSlots(
      [port('declared', ['WeaponGun'], 3)],
      new Map([['undeclared', 'KLWE_LaserRepeater_S3']]),
      resolve,
      humanize,
    );
    expect(slots.map((s) => s.className)).toEqual([null, 'KLWE_LaserRepeater_S3']);
  });

  it('falls back to the class name when the catalog has no display name', () => {
    const slots = carriedSlots(
      [port('p', ['WeaponGun'], 3)],
      new Map([['p', 'UNKNOWN_CLASS']]),
      resolve,
      humanize,
    );
    expect(slots[0].name).toBe('UNKNOWN_CLASS');
    expect(slots[0].kind).toBeNull();
  });

  it('takes the occupant size when the sub-port accepts a range', () => {
    const ranged: ItemPort = { portName: 'p', minSize: 1, maxSize: 3, types: ['Missile'], flags: [] };
    const slots = carriedSlots([ranged], new Map([['p', 'MISL_S02_A']]), resolve, humanize);
    expect(slots[0].size).toBe(2);
  });

  it('yields nothing for an item with no ports and no stock fit', () => {
    expect(carriedSlots(undefined, new Map(), resolve, humanize)).toEqual([]);
    expect(carriedSlots([], new Map(), resolve, humanize)).toEqual([]);
  });
});
