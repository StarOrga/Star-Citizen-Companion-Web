import {
  analyzeShipMounts,
  armorSlotsFromLoadout,
  computeFpsKpis,
  computeShipKpis,
  groupPortsBySize,
  roleSlotForAttachType,
  sortByRecency,
  withSelectedFirst,
  type EntityPayloadEntry,
} from './codex-landing-kpi';
import type { ShipPayload } from './codex.types';

// A trimmed real-world example (Avenger Stalker per the redesign spec): one S4
// nose gimbal + two S3 wing gimbals, all stock-empty, plus a fitted shield.
function avengerStalkerPayload(): ShipPayload {
  return {
    className: 'AEGS_Avenger_Stalker',
    guid: 'g',
    type: 't',
    recordTag: null,
    name: { de: 'Avenger Stalker', en: 'Avenger Stalker', key: '@x' },
    description: { de: '', en: '', key: '@x' },
    manufacturer: null,
    tags: [],
    iconPath: null,
    previewImage: null,
    source: { channel: 'LIVE', patch: '4.9.0', build: 'desktop' },
    entityKind: 'ship',
    role: null,
    crew: { size: null },
    vehicleName: { de: '', en: '', key: '@x' },
    dimensions: null,
    flight: {
      scmSpeed: null, maxSpeed: null, boostSpeed: null, pitch: null, yaw: null, roll: null,
    },
    itemPorts: [
      {
        portName: 'hardpoint_weapon_class2_nose', minSize: 4, maxSize: 4,
        types: ['WeaponGun'], flags: [],
      },
      {
        portName: 'hardpoint_weapon_gun_class1_left_wing', minSize: 3, maxSize: 3,
        types: ['WeaponGun'], flags: [],
      },
      {
        portName: 'hardpoint_weapon_gun_class1_right_wing', minSize: 3, maxSize: 3,
        types: ['WeaponGun'], flags: [],
      },
      {
        portName: 'hardpoint_shield_generator', minSize: 2, maxSize: 2,
        types: ['Shield'], flags: [],
      },
    ],
    defaultLoadout: [
      { itemPortName: 'hardpoint_weapon_class2_nose', entityClassName: null },
      { itemPortName: 'hardpoint_weapon_gun_class1_left_wing', entityClassName: null },
      { itemPortName: 'hardpoint_weapon_gun_class1_right_wing', entityClassName: null },
      { itemPortName: 'hardpoint_shield_generator', entityClassName: 'GATS_Shimmer' },
    ],
  } as ShipPayload;
}

function shieldPayloads(): Map<string, EntityPayloadEntry> {
  return new Map([
    [
      'GATS_Shimmer',
      {
        kind: 'component',
        payload: {
          name: { de: 'Shimmer', en: 'Shimmer', key: '@x' },
          kind: 'Shield',
          size: 2,
          grade: 'A',
          stats: { SCItemShieldGeneratorParams: { MaxShieldHealth: 2244 } },
        },
      },
    ],
  ]);
}

describe('analyzeShipMounts', () => {
  it('finds the real Avenger Stalker empty-mount set: S4 nose + 2× S3 wing, all stock-empty', () => {
    const analysis = analyzeShipMounts(avengerStalkerPayload());
    expect(analysis.weaponPorts.length).toBe(3);
    expect(analysis.emptyWeaponPorts.length).toBe(3);
    expect(analysis.emptyWeaponPorts.map((p) => p.maxSize).sort()).toEqual([3, 3, 4]);
  });

  it('does not count a fitted shield generator as an empty weapon mount', () => {
    const analysis = analyzeShipMounts(avengerStalkerPayload());
    expect(analysis.emptyWeaponPorts.some((p) => p.portName === 'hardpoint_shield_generator')).toBeFalse();
  });
});

describe('groupPortsBySize', () => {
  it('groups and orders by size descending: "1× S4 · 2× S3"', () => {
    expect(groupPortsBySize([{ size: 3 }, { size: 4 }, { size: 3 }])).toBe('1× S4 · 2× S3');
  });

  it('renders "0" for an empty set', () => {
    expect(groupPortsBySize([])).toBe('0');
  });
});

describe('computeShipKpis', () => {
  it('sums MaxShieldHealth across fitted shield generators (2× Shimmer = 4488)', () => {
    const doubleShield: ShipPayload = {
      ...avengerStalkerPayload(),
      defaultLoadout: [
        ...avengerStalkerPayload().defaultLoadout,
        { itemPortName: 'hardpoint_shield_generator_2', entityClassName: 'GATS_Shimmer' },
      ],
    };
    const rows = computeShipKpis(doubleShield, shieldPayloads());
    const shieldRow = rows.find((r) => r.labelKey === 'codex.landing.kpi.ship.shieldTotal');
    expect(shieldRow?.value).toBe('4,488 HP');
  });

  it('surfaces the empty-mount KPI warn-flagged with the real Avenger Stalker gap: 1× S4 + 2× S3', () => {
    const rows = computeShipKpis(avengerStalkerPayload(), shieldPayloads());
    const emptyRow = rows.find((r) => r.labelKey === 'codex.landing.kpi.ship.emptyMounts');
    expect(emptyRow?.value).toBe('1× S4 · 2× S3');
    expect(emptyRow?.warn).toBeTrue();
  });

  it('never emits a shield KPI when no component payload resolved it (best-effort degrade)', () => {
    const rows = computeShipKpis(avengerStalkerPayload(), new Map());
    expect(rows.some((r) => r.labelKey === 'codex.landing.kpi.ship.shieldTotal')).toBeFalse();
    // the mount analysis itself needs no component payloads — it still renders.
    expect(rows.some((r) => r.labelKey === 'codex.landing.kpi.ship.emptyMounts')).toBeTrue();
  });

  it('returns no ship KPIs at all for a null payload', () => {
    expect(computeShipKpis(null, new Map())).toEqual([]);
  });

  it('caps at 7 KPIs', () => {
    const rows = computeShipKpis(avengerStalkerPayload(), shieldPayloads());
    expect(rows.length).toBeLessThanOrEqual(7);
  });
});

describe('armorSlotsFromLoadout + computeFpsKpis', () => {
  it('reports 3/6 slots filled for the Prospector Suit gap scenario (helmet/torso/legs only)', () => {
    const slots = armorSlotsFromLoadout([
      { slot: 'helmet', className: 'P4-AR_Ballistic' },
      { slot: 'core', className: 'Outland_Miner_Torso' },
      { slot: 'legs', className: 'Novikov_Legschutz' },
      { slot: 'arms', className: null },
      { slot: 'undersuit', className: null },
      { slot: 'backpack', className: null },
    ]);
    const rows = computeFpsKpis(slots, new Map(), new Map([['Char_Armor_Arms', 1779], ['Char_Armor_Undersuit', 867], ['Char_Armor_Backpack', 540]]));
    const slotsRow = rows.find((r) => r.labelKey === 'codex.landing.kpi.fps.slotsFilled');
    expect(slotsRow?.value).toBe('3 / 6');
  });

  it('never fabricates Stealth/Rüstung/Waffengewalt — always emits the two honest gap markers', () => {
    const slots = armorSlotsFromLoadout([]);
    const rows = computeFpsKpis(slots, new Map(), new Map());
    const gaps = rows.filter((r) => r.gap);
    expect(gaps.length).toBe(2);
    expect(gaps.every((g) => g.value === '—')).toBeTrue();
  });

  it('caps at 7 KPIs', () => {
    const slots = armorSlotsFromLoadout([
      { slot: 'helmet', className: 'A' },
      { slot: 'core', className: 'B' },
      { slot: 'arms', className: 'C' },
      { slot: 'legs', className: 'D' },
      { slot: 'undersuit', className: 'E' },
      { slot: 'backpack', className: 'F' },
    ]);
    const resolved = new Map(
      ['A', 'B', 'C', 'D', 'E', 'F'].map((cn) => [cn, { grade: 'B', manufacturerCode: 'RSI' }]),
    );
    const rows = computeFpsKpis(slots, resolved, new Map());
    expect(rows.length).toBeLessThanOrEqual(7);
  });
});

describe('sortByRecency', () => {
  it('orders by updatedAt descending (newest first)', () => {
    const items = [
      { id: 'a', updatedAt: '2026-08-01T00:00:00Z' },
      { id: 'b', updatedAt: '2026-08-10T00:00:00Z' },
      { id: 'c', updatedAt: '2026-08-05T00:00:00Z' },
    ];
    expect(sortByRecency(items).map((i) => i.id)).toEqual(['b', 'c', 'a']);
  });
});

// Admin feedback 34505d70 ("2A"): the standalone /hangar/loadout/:id editor was
// retired, so "which set am I looking at" moved into the Codex landing's URL
// (`?set=`). Position 0 of this list IS the active set, which makes the
// reordering below the whole selection mechanism — worth locking down.
describe('withSelectedFirst', () => {
  const sets = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];

  it('leaves the order alone when nothing is selected', () => {
    expect(withSelectedFirst(sets, null).map((s) => s.id)).toEqual(['a', 'b', 'c']);
  });

  it('pulls the named set to the front and keeps the rest in order', () => {
    expect(withSelectedFirst(sets, 'c').map((s) => s.id)).toEqual(['c', 'a', 'b']);
  });

  it('is a no-op for the set that already leads', () => {
    expect(withSelectedFirst(sets, 'a').map((s) => s.id)).toEqual(['a', 'b', 'c']);
  });

  it('ignores an id that no longer resolves, rather than emptying the zone', () => {
    // A bookmark from the retired editor pointing at a deleted set.
    expect(withSelectedFirst(sets, 'gone').map((s) => s.id)).toEqual(['a', 'b', 'c']);
  });

  it('never hands back the caller array', () => {
    expect(withSelectedFirst(sets, 'b')).not.toBe(sets as unknown as { id: string }[]);
  });
});

describe('roleSlotForAttachType', () => {
  it('maps every anatomical attach_type to the role slot the set stores', () => {
    expect(roleSlotForAttachType('Char_Armor_Helmet')).toBe('helmet');
    expect(roleSlotForAttachType('Char_Armor_Torso')).toBe('core');
    expect(roleSlotForAttachType('Char_Armor_Backpack')).toBe('backpack');
  });

  it('refuses everything else, so the equip control cannot invent a slot', () => {
    // Ship hull armour — deliberately NOT a personal-armour attach type.
    expect(roleSlotForAttachType('Armor')).toBeNull();
    expect(roleSlotForAttachType(null)).toBeNull();
    expect(roleSlotForAttachType('')).toBeNull();
  });
});
