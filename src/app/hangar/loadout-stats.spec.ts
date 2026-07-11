import {
  computeLoadoutStats,
  findStat,
  mergeLoadout,
  toFiniteNumber,
  ResolvedLoadoutLine,
} from './loadout-stats';
import type { ComponentPayload, ShipPayload, WeaponPayload } from '../codex/codex.types';

function componentPayload(
  kind: ComponentPayload['kind'],
  stats: Record<string, Record<string, unknown>>,
): ComponentPayload {
  return {
    className: 'TEST_Component',
    guid: '0',
    type: 'EntityClassDefinition',
    recordTag: null,
    name: { de: 'Test', en: 'Test', key: '@test' },
    description: { de: '', en: '', key: '@test_desc' },
    manufacturer: null,
    tags: [],
    iconPath: null,
    previewImage: null,
    source: { channel: 'LIVE', patch: '4.x', build: 'test' },
    entityKind: 'component',
    kind,
    attachType: null,
    subType: null,
    size: 2,
    grade: 'A',
    stats: stats as ComponentPayload['stats'],
    itemPorts: [],
  };
}

function weaponPayload(size: number | null): WeaponPayload {
  return {
    className: 'TEST_Weapon',
    guid: '0',
    type: 'EntityClassDefinition',
    recordTag: null,
    name: { de: 'Waffe', en: 'Weapon', key: '@w' },
    description: { de: '', en: '', key: '@wd' },
    manufacturer: null,
    tags: [],
    iconPath: null,
    previewImage: null,
    source: { channel: 'LIVE', patch: '4.x', build: 'test' },
    entityKind: 'weapon',
    weaponClass: 'Ship',
    attachType: 'WeaponGun',
    subType: 'Gun',
    size,
    grade: null,
    weaponParams: {},
    itemPorts: [],
  };
}

describe('toFiniteNumber', () => {
  it('passes through finite numbers', () => {
    expect(toFiniteNumber(42)).toBe(42);
    expect(toFiniteNumber(0)).toBe(0);
  });

  it('coerces numeric strings', () => {
    expect(toFiniteNumber('3.5')).toBe(3.5);
  });

  it('rejects non-numeric values', () => {
    expect(toFiniteNumber('abc')).toBeNull();
    expect(toFiniteNumber(null)).toBeNull();
    expect(toFiniteNumber(undefined)).toBeNull();
    expect(toFiniteNumber(NaN)).toBeNull();
    expect(toFiniteNumber(Infinity)).toBeNull();
    expect(toFiniteNumber('')).toBeNull();
  });
});

describe('findStat', () => {
  const stats = {
    SCItemShieldGeneratorParams: { MaxShieldHealth: 4000, MaxShieldRegen: '220' },
    EntityComponentPowerConnection: { PowerBase: 10 },
  };

  it('finds a field in a struct matched by hint (case-insensitive)', () => {
    expect(findStat(stats, 'shield', ['MaxShieldHealth'])).toBe(4000);
  });

  it('matches field names case-insensitively and coerces strings', () => {
    expect(findStat(stats, 'shield', ['maxshieldregen'])).toBe(220);
  });

  it('tries fallback field names in order', () => {
    expect(findStat(stats, 'shield', ['DoesNotExist', 'MaxShieldHealth'])).toBe(4000);
  });

  it('returns null when the struct hint matches nothing', () => {
    expect(findStat(stats, 'quantum', ['jumpRange'])).toBeNull();
  });

  it('handles null/undefined stats', () => {
    expect(findStat(null, 'shield', ['x'])).toBeNull();
    expect(findStat(undefined, 'shield', ['x'])).toBeNull();
  });
});

describe('computeLoadoutStats', () => {
  it('sums shield HP and regen across multiple shields', () => {
    const lines: ResolvedLoadoutLine[] = [
      {
        portName: 'shield_1',
        className: 'S1',
        kind: 'component',
        payload: componentPayload('Shield', {
          SCItemShieldGeneratorParams: { MaxShieldHealth: 3000, MaxShieldRegen: 100 },
        }),
      },
      {
        portName: 'shield_2',
        className: 'S2',
        kind: 'component',
        payload: componentPayload('Shield', {
          SCItemShieldGeneratorParams: { MaxShieldHealth: 2000, MaxShieldRegen: 50 },
        }),
      },
    ];
    const stats = computeLoadoutStats(lines);
    expect(stats.shieldHp).toBe(5000);
    expect(stats.shieldRegen).toBe(150);
  });

  it('extracts quantum drive figures', () => {
    const lines: ResolvedLoadoutLine[] = [
      {
        portName: 'qd',
        className: 'QD1',
        kind: 'component',
        payload: componentPayload('QuantumDrive', {
          SCItemQuantumDriveParams: {
            jumpRange: 583000000,
            quantumFuelRequirement: 583,
            driveSpeed: 283000,
          },
        }),
      },
    ];
    const stats = computeLoadoutStats(lines);
    expect(stats.quantum.jumpRangeMm).toBe(583000000);
    expect(stats.quantum.fuelCapacity).toBe(583);
    expect(stats.quantum.driveSpeedMs).toBe(283000);
  });

  it('drops the FLT_MAX jump-range sentinel instead of rendering infinity', () => {
    // CryEngine emits FLT_MAX (~3.4e38) for "unset/unlimited" — observed live
    // on QDRV_TARS_S01_Expedition (rendered as "∞ Gm" without the guard).
    const lines: ResolvedLoadoutLine[] = [
      {
        portName: 'qd',
        className: 'QD1',
        kind: 'component',
        payload: componentPayload('QuantumDrive', {
          SCItemQuantumDriveParams: {
            jumpRange: 3.4028230607370965e38,
            quantumFuelRequirement: 0.0098,
          },
        }),
      },
    ];
    const stats = computeLoadoutStats(lines);
    expect(stats.quantum.jumpRangeMm).toBeNull();
    expect(stats.quantum.fuelCapacity).toBe(0.0098);
  });

  it('groups weapons by size and counts kinds', () => {
    const lines: ResolvedLoadoutLine[] = [
      { portName: 'g1', className: 'W1', kind: 'weapon', payload: weaponPayload(3) },
      { portName: 'g2', className: 'W2', kind: 'weapon', payload: weaponPayload(3) },
      { portName: 'g3', className: 'W3', kind: 'weapon', payload: weaponPayload(2) },
      { portName: 'g4', className: 'W4', kind: 'weapon', payload: weaponPayload(null) },
    ];
    const stats = computeLoadoutStats(lines);
    expect(stats.weaponCount).toBe(4);
    expect(stats.weaponsBySize).toEqual({ '3': 2, '2': 1, '?': 1 });
    expect(stats.countsByKind['weapon']).toBe(4);
  });

  it('keeps nulls (never NaN) when nothing resolves', () => {
    const lines: ResolvedLoadoutLine[] = [
      { portName: 'x', className: 'U1', kind: 'item', payload: null },
    ];
    const stats = computeLoadoutStats(lines);
    expect(stats.shieldHp).toBeNull();
    expect(stats.shieldRegen).toBeNull();
    expect(stats.quantum.jumpRangeMm).toBeNull();
    expect(stats.totalAssigned).toBe(1);
  });
});

describe('mergeLoadout', () => {
  const ship = {
    defaultLoadout: [
      { itemPortName: 'gun_left', entityClassName: 'STOCK_GUN' },
      { itemPortName: 'shield', entityClassName: 'STOCK_SHIELD' },
      { itemPortName: 'empty_rack', entityClassName: null },
    ],
  } as unknown as ShipPayload;

  it('replaces stock entries on overridden ports', () => {
    const merged = mergeLoadout(ship, [
      { portName: 'gun_left', className: 'CUSTOM_GUN', kind: 'weapon' },
    ]);
    expect(merged).toContain(
      jasmine.objectContaining({ portName: 'gun_left', className: 'CUSTOM_GUN' }),
    );
    expect(merged).toContain(
      jasmine.objectContaining({ portName: 'shield', className: 'STOCK_SHIELD' }),
    );
    expect(merged.length).toBe(2);
  });

  it('appends overrides for ports without stock entries', () => {
    const merged = mergeLoadout(ship, [
      { portName: 'empty_rack', className: 'NEW_RACK', kind: 'item' },
    ]);
    expect(merged).toContain(
      jasmine.objectContaining({ portName: 'empty_rack', className: 'NEW_RACK' }),
    );
  });

  it('handles a null ship payload (overrides only)', () => {
    const merged = mergeLoadout(null, [
      { portName: 'p', className: 'X', kind: 'item' },
    ]);
    expect(merged.length).toBe(1);
  });
});
