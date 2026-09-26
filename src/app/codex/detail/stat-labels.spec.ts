import { StatRow } from '../codex-format';
import { isEngineInternalStatLabel, statLabelI18nKey, toDisplayStatRows } from './stat-labels';

describe('stat-labels (AUD-060)', () => {
  describe('statLabelI18nKey', () => {
    it('maps a known leaf label to its i18n key', () => {
      expect(statLabelI18nKey('Health')).toBe('codex.stat.health');
    });

    it('maps a known label under a struct prefix by its leaf', () => {
      expect(statLabelI18nKey('Radiation Resistance.Maximum Radiation Capacity')).toBe(
        'codex.stat.radiationCapacityMax',
      );
    });

    it('is case-insensitive', () => {
      expect(statLabelI18nKey('health')).toBe('codex.stat.health');
    });

    it('returns undefined for an uncatalogued label (caller keeps the humanized fallback)', () => {
      expect(statLabelI18nKey('Some未知 Field')).toBeUndefined();
    });
  });

  describe('isEngineInternalStatLabel', () => {
    it('flags the "Hit Effect Lib Name" finding from AUD-060', () => {
      expect(isEngineInternalStatLabel('Hit Effect Lib Name')).toBe(true);
    });

    it('flags the "Other Params.Animspeed" finding from AUD-060', () => {
      expect(isEngineInternalStatLabel('Other Params.Animspeed')).toBe(true);
    });

    it('does not flag an ordinary catalogued stat', () => {
      expect(isEngineInternalStatLabel('Max Shield Health')).toBe(false);
    });
  });

  describe('toDisplayStatRows', () => {
    const rows: StatRow[] = [
      { key: 'Health', value: '450', unit: 'HP' },
      { key: 'Radiation Resistance.Maximum Radiation Capacity', value: '12' },
      { key: 'Hit Effect Lib Name', value: 'playerhits_armour_light' },
      { key: 'Other Params.Animspeed', value: '1' },
      { key: 'Some Uncatalogued Field', value: '3' },
    ];

    it('drops engine-internal rows entirely', () => {
      const out = toDisplayStatRows(rows);
      expect(out.some((r) => r.key === 'Hit Effect Lib Name')).toBe(false);
      expect(out.some((r) => r.key === 'Other Params.Animspeed')).toBe(false);
    });

    it('attaches the i18n key for catalogued labels', () => {
      const out = toDisplayStatRows(rows);
      expect(out.find((r) => r.key === 'Health')?.i18nKey).toBe('codex.stat.health');
      expect(out.find((r) => r.key === 'Radiation Resistance.Maximum Radiation Capacity')?.i18nKey).toBe(
        'codex.stat.radiationCapacityMax',
      );
    });

    it('keeps the humanized fallback (no i18nKey) for an uncatalogued, non-internal label', () => {
      const out = toDisplayStatRows(rows);
      const fallback = out.find((r) => r.key === 'Some Uncatalogued Field');
      expect(fallback).toBeTruthy();
      expect(fallback?.i18nKey).toBeUndefined();
    });

    it('preserves value and unit untouched', () => {
      const out = toDisplayStatRows(rows);
      const health = out.find((r) => r.key === 'Health');
      expect(health?.value).toBe('450');
      expect(health?.unit).toBe('HP');
    });
  });

  // Keys copied from the live walk of build 4.9 (helmet, undersuit, quantum drive).
  describe('real grids from build 4.9', () => {
    it('hides the helmet lamp, camera, inspect and constraint plumbing', () => {
      for (const key of [
        'Other Params.Fov',
        'Legacy Params.Diffuse Mult',
        'Local Player Params.Shadow Quality Cap',
        'DOF Blur Amount',
        'Max FOV',
        'Inspect Rotate Limits X.Y',
        'Top Constraint Offset',
        'Transparency Post Effects Exclusion Region',
        'Params.VFX Pinch Max Velocity',
        'Params.Shader Node Engage Velocity',
        'Legacy Thrust Params.Boost Scale',
        'Ammo Class Name',
      ]) {
        expect(isEngineInternalStatLabel(key)).withContext(key).toBeTrue();
      }
    });

    it('drops a row whose value is an unresolved engine pointer', () => {
      const out = toDisplayStatRows([{ key: 'Spline Jump Params.Idle State', value: '_PointsTo_:ptr:1' }]);
      expect(out).toEqual([]);
    });

    it('translates the player-facing stats by full path or leaf', () => {
      expect(statLabelI18nKey('Temperature Resistance.Max Resistance')).toBe('codex.stat.temperatureMax');
      expect(statLabelI18nKey('Flight.g Force Resistance')).toBe('codex.stat.gForceResistance');
      expect(statLabelI18nKey('Params.Drive Speed')).toBe('codex.stat.driveSpeed');
      expect(statLabelI18nKey('Spline Jump Params.Drive Speed')).toBe('codex.stat.splineDriveSpeed');
      expect(statLabelI18nKey('Stun Params.Max Stun Time')).toBe('codex.stat.stunMaxTime');
    });

    it('keeps a stat that only sounds technical', () => {
      expect(isEngineInternalStatLabel('Radiation Resistance.Radiation Dissipation Rate')).toBeFalse();
      expect(isEngineInternalStatLabel('Duration')).toBeFalse();
    });
  });
});
