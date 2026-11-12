import type { EquippedStat } from '../codex-equipped-stats';
import { calloutValuesOf, partTypeKey, shortStatKey } from './holo-callout-values';

describe('partTypeKey', () => {
  it('names the weapon class from the gun, not the category', () => {
    expect(partTypeKey('weapons', 'BEHR_BallisticGatling_S3')).toBe('codex.holo.partType.gatling');
    expect(partTypeKey('weapons', 'AMRS_LaserCannon_S3')).toBe('codex.holo.partType.laserCannon');
    expect(partTypeKey('weapons', 'KLWE_LaserRepeater_S3')).toBe('codex.holo.partType.laserRepeater');
  });

  it('names a component by its item type', () => {
    expect(partTypeKey('coolers', 'COOL_AEGS_S01_Bracer')).toBe('codex.holo.partType.cooler');
    expect(partTypeKey('missiles', 'MRCK_S03_AEGS_Gladius')).toBe('codex.holo.partType.missileRack');
  });

  it('leaves an unknown weapon to the category fallback', () => {
    expect(partTypeKey('weapons', 'Mount_Gimbal_S3')).toBeNull();
    expect(partTypeKey(null, null)).toBeNull();
  });

  it('short labels live under codex.holo.statShort', () => {
    expect(shortStatKey('codex.equipped.alphaDamage')).toBe('codex.holo.statShort.alphaDamage');
  });
});

const stat = (k: string, value = 100): EquippedStat => ({ labelKey: `codex.equipped.${k}`, value, format: 'int' });
const label = (k: string): string => k.slice(k.lastIndexOf('.') + 1);

describe('calloutValuesOf', () => {
  it('leads a weapon with DPS, alpha and fire rate whatever order the extract lists them', () => {
    const out = calloutValuesOf('weapons', [stat('range'), stat('fireRate'), stat('alphaDamage'), stat('dps')], 3, 'A', label, 'size', 'grade');
    expect(out.map((v) => v.label)).toEqual(['dps', 'alphaDamage', 'fireRate']);
  });

  it('leads a shield with HP and regen, a cooler with its cooling rate', () => {
    expect(calloutValuesOf('shields', [stat('health'), stat('shieldRegen'), stat('shieldHp')], 1, null, label, 's', 'g').map((v) => v.label)).toEqual(['shieldHp', 'shieldRegen', 'health']);
    expect(calloutValuesOf('coolers', [stat('powerDraw'), stat('coolingRate')], 2, null, label, 's', 'g')[0].label).toBe('coolingRate');
  });

  it('fills a part with few stats with its size and grade, and never exceeds three', () => {
    expect(calloutValuesOf('coolers', [stat('coolingRate')], 2, 'B', label, 'size', 'grade')).toEqual([
      { label: 'coolingRate', value: '100' },
      { label: 'size', value: 'S2' },
      { label: 'grade', value: 'B' },
    ]);
    expect(calloutValuesOf(null, [stat('a'), stat('b'), stat('c'), stat('d')], 1, 'A', label, 's', 'g').length).toBe(3);
  });
});
