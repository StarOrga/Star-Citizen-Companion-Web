import type { EquippedStat } from '../codex-equipped-stats';
import { calloutValuesOf } from './holo-callout-values';

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
