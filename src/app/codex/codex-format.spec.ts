import {
  ammoDamage,
  buildCompareTable,
  categorizePort,
  cleanLocaleValue,
  collectCompareAttributes,
  curateComponentStats,
  formatCraftTime,
  formatNumber,
  formatQuality,
  humanizeClassName,
  humanizeKey,
  isMeaningfulValue,
  isNoiseKey,
  meaningfulRows,
  summarizePorts,
  unescapeText,
  unitForField,
} from './codex-format';

describe('codex-format', () => {
  describe('unescapeText', () => {
    it('converts literal \\n escape sequences to real newlines', () => {
      expect(unescapeText('Manufacturer: MISC\\nFocus: Freight')).toBe(
        'Manufacturer: MISC\nFocus: Freight',
      );
    });
    it('handles \\r\\n and double blank lines', () => {
      expect(unescapeText('a\\r\\nb\\n\\nc')).toBe('a\nb\n\nc');
    });
    it('returns empty for nullish', () => {
      expect(unescapeText(null)).toBe('');
      expect(unescapeText(undefined)).toBe('');
    });
  });

  describe('cleanLocaleValue', () => {
    it('drops unresolved @-keys and placeholders', () => {
      expect(cleanLocaleValue('@item_Name_SHLD_ASAS')).toBe('');
      expect(cleanLocaleValue('@LOC_EMPTY')).toBe('');
      expect(cleanLocaleValue('')).toBe('');
      expect(cleanLocaleValue(null)).toBe('');
    });
    it('keeps real values and honours the fallback', () => {
      expect(cleanLocaleValue('Mirage Shield')).toBe('Mirage Shield');
      expect(cleanLocaleValue('@x', 'Fallback')).toBe('Fallback');
    });
  });

  describe('humanizeClassName', () => {
    it('un-snake-cases and spaces a raw class name', () => {
      expect(humanizeClassName('AMRS_LaserCannon_S3_AMMO')).toBe('AMRS Laser Cannon S3 AMMO');
    });
    it('strips engine suffixes', () => {
      expect(humanizeClassName('SHLD_ASAS_S01_Mirage_SCItem')).toBe('SHLD ASAS S01 Mirage');
    });
    it('returns empty for nullish', () => {
      expect(humanizeClassName(null)).toBe('');
      expect(humanizeClassName('')).toBe('');
    });
  });

  describe('humanizeKey', () => {
    it('splits camelCase and PascalCase', () => {
      expect(humanizeKey('MaxShieldHealth')).toBe('Max Shield Health');
      expect(humanizeKey('jumpRange')).toBe('Jump Range');
    });
    it('strips struct wrappers', () => {
      expect(humanizeKey('SCItemShieldGeneratorParams')).toBe('Shield Generator');
    });
    it('keeps known acronyms upper-cased', () => {
      expect(humanizeKey('scmSpeed')).toBe('SCM Speed');
    });
    it('separates digits', () => {
      expect(humanizeKey('size3')).toBe('Size 3');
    });
  });

  describe('formatNumber', () => {
    it('groups thousands and rounds to 2 decimals', () => {
      expect(formatNumber(2244)).toBe('2,244');
      expect(formatNumber(5.829999)).toBe('5.83');
    });
    it('uses comma thousands + period decimal regardless of host locale', () => {
      // Regression: toLocaleString could emit German "1.196" — manual format
      // must always produce the English presentation.
      expect(formatNumber(1196.31005859375)).toBe('1,196.31');
      expect(formatNumber(1113.800048828125)).toBe('1,113.8');
      expect(formatNumber(1650)).toBe('1,650');
      expect(formatNumber(1000000)).toBe('1,000,000');
    });
    it('trims trailing-zero decimals and handles negatives', () => {
      expect(formatNumber(5.5)).toBe('5.5');
      expect(formatNumber(5.0)).toBe('5');
      expect(formatNumber(-1234.5)).toBe('-1,234.5');
      expect(formatNumber(0)).toBe('0');
    });
    it('renders FLT_MAX sentinels as ∞', () => {
      expect(formatNumber(3.4028e38)).toBe('∞');
    });
  });

  describe('isMeaningfulValue', () => {
    it('rejects noise (null, empty, @keys, paths, guids, booleans)', () => {
      expect(isMeaningfulValue(null)).toBe(false);
      expect(isMeaningfulValue('')).toBe(false);
      expect(isMeaningfulValue('@LOC_EMPTY')).toBe(false);
      expect(isMeaningfulValue('materials/effects/x.mtl')).toBe(false);
      expect(isMeaningfulValue('83004a4e-419e-12b3-11fc-69442d4cc99d')).toBe(false);
      expect(isMeaningfulValue(true)).toBe(false);
      expect(isMeaningfulValue('None')).toBe(false);
    });
    it('accepts real numbers and strings', () => {
      expect(isMeaningfulValue(494)).toBe(true);
      expect(isMeaningfulValue('Medium')).toBe(true);
    });
  });

  describe('unitForField', () => {
    it('maps unambiguous fields to units, leaves the rest undefined', () => {
      expect(unitForField('MaxShieldHealth')).toBe('HP');
      expect(unitForField('scmSpeed')).toBe('m/s');
      expect(unitForField('fireRate')).toBe('rpm');
      expect(unitForField('DecayRatio')).toBeUndefined();
    });
  });

  describe('curateComponentStats', () => {
    it('attaches units to known fields', () => {
      const rows = curateComponentStats({
        SCItemShieldGeneratorParams: { MaxShieldHealth: 2244 },
      });
      expect(rows.find((r) => r.key === 'Max Shield Health')?.unit).toBe('HP');
    });
    it('keeps SCItem*Params + Health, drops engine noise', () => {
      const stats = {
        SCItemShieldGeneratorParams: { MaxShieldHealth: 2244, MaxShieldRegen: 494 },
        SARDataComponentParams: { title1: '@LOC_EMPTY', description: '@LOC_EMPTY' },
        SHealthComponentParams: { Health: 170, SerializedDamageMapPath: '' },
        InteriorMapEntityVisiblityEntityComponentParams: { show: true },
      };
      const rows = curateComponentStats(stats);
      const labels = rows.map((r) => r.key);
      expect(labels).toContain('Max Shield Health');
      expect(labels).toContain('Health');
      expect(labels).not.toContain('Title1');
      expect(rows.find((r) => r.key === 'Max Shield Health')?.value).toBe('2,244');
    });
  });

  describe('isNoiseKey', () => {
    it('flags engine/presentation field names', () => {
      expect(isNoiseKey('geometryTags')).toBe(true);
      expect(isNoiseKey('displayThumbnail')).toBe(true);
      expect(isNoiseKey('UIIconType')).toBe(true);
      expect(isNoiseKey('audioParams')).toBe(true);
    });
    it('keeps real stat names', () => {
      expect(isNoiseKey('muzzleVelocity')).toBe(false);
      expect(isNoiseKey('MaxShieldHealth')).toBe(false);
      expect(isNoiseKey('fireRate')).toBe(false);
    });
  });

  describe('meaningfulRows', () => {
    it('filters config + engine-metadata noise from a flat record', () => {
      const rows = meaningfulRows({
        fireOnAim: false, // boolean → dropped
        geometryTags: 'White01', // noise key → dropped
        muzzleVelocity: 1450, // real stat → kept
      });
      const labels = rows.map((r) => r.key);
      expect(labels).toContain('Muzzle Velocity');
      expect(labels).not.toContain('Geometry Tags');
      expect(labels).not.toContain('Fire On Aim');
    });
  });

  describe('ammoDamage', () => {
    it('falls back to raw.projectileParams.damage when impactDamage is null', () => {
      const payload = {
        impactDamage: null,
        raw: { projectileParams: { damage: { DamageEnergy: 273.13, DamagePhysical: 0 } } },
      };
      const dmg = ammoDamage(payload);
      expect(dmg.length).toBe(1);
      expect(dmg[0]).toEqual({ channel: 'energy', value: 273.13 });
    });
    it('prefers promoted impactDamage', () => {
      const dmg = ammoDamage({ impactDamage: { physical: 50, energy: null } });
      expect(dmg).toEqual([{ channel: 'physical', value: 50 }]);
    });
  });

  describe('summarizePorts', () => {
    it('counts role-defining categories, omits systems/other noise', () => {
      const ports = [
        { types: ['WeaponGun'], portName: 'hp_w1' },
        { types: ['WeaponGun'], portName: 'hp_w2' },
        { types: ['Missile'], portName: 'hp_m1' },
        { types: ['Shield'], portName: 'hp_s1' },
        { types: ['Seat'], portName: 'hp_seat' },
        { types: [], portName: 'hardpoint_door' },
      ];
      const sum = summarizePorts(ports);
      expect(sum).toEqual([
        { category: 'weapons', count: 2 },
        { category: 'missiles', count: 1 },
        { category: 'defense', count: 1 },
      ]);
    });
    it('returns empty for a ship with only structural ports', () => {
      expect(summarizePorts([{ types: ['Seat'], portName: 'x' }])).toEqual([]);
    });
  });

  describe('collectCompareAttributes', () => {
    it('collects common + kind-specific attrs for a ship', () => {
      const attrs = collectCompareAttributes({
        kind: 'ship',
        payload: { manufacturer: { name: { en: 'Aegis Dynamics' } }, dimensions: { length: 20, width: 18, height: 5 } },
        row: { crew_size: 1, manufacturer_code: 'AEGS' },
        ports: [{ types: ['WeaponGun'], portName: 'w1' }, { types: ['Shield'], portName: 's1' }],
      });
      const byId = Object.fromEntries(attrs.map((a) => [a.id, a.value]));
      expect(byId['manufacturer']).toBe('Aegis Dynamics');
      expect(byId['crew']).toBe('1');
      expect(byId['hp_weapons']).toBe('1');
      expect(byId['hp_defense']).toBe('1');
    });
    it('uses manufacturer code when payload name is absent', () => {
      const attrs = collectCompareAttributes({ kind: 'weapon', payload: {}, row: { manufacturer_code: 'BEHR' }, ports: [] });
      expect(attrs.find((a) => a.id === 'manufacturer')?.value).toBe('BEHR');
    });
  });

  describe('buildCompareTable', () => {
    it('unions attribute ids across columns, fills gaps with null', () => {
      const cols = [
        { key: 'a', name: 'A', kind: 'weapon', className: 'A' },
        { key: 'b', name: 'B', kind: 'weapon', className: 'B' },
      ];
      const rows = buildCompareTable(cols, [
        [{ id: 'size', labelKey: 'k.size', value: 'S3' }, { id: 'grade', labelKey: 'k.grade', value: 'A' }],
        [{ id: 'size', labelKey: 'k.size', value: 'S5' }],
      ]);
      const size = rows.find((r) => r.id === 'size');
      const grade = rows.find((r) => r.id === 'grade');
      expect(size?.values).toEqual(['S3', 'S5']);
      expect(grade?.values).toEqual(['A', null]); // B has no grade
      expect(rows.map((r) => r.id)).toEqual(['size', 'grade']); // first-seen order
    });
  });

  describe('formatCraftTime', () => {
    it('returns null for nullish / negative input', () => {
      expect(formatCraftTime(null)).toBeNull();
      expect(formatCraftTime(undefined)).toBeNull();
      expect(formatCraftTime(-1)).toBeNull();
    });
    it('formats zero seconds', () => {
      expect(formatCraftTime(0)).toBe('0 s');
    });
    it('formats seconds only', () => {
      expect(formatCraftTime(45)).toBe('45 s');
    });
    it('formats minutes + seconds', () => {
      expect(formatCraftTime(90)).toBe('1 m 30 s');
    });
    it('formats whole minutes (no seconds part)', () => {
      expect(formatCraftTime(120)).toBe('2 m');
    });
    it('formats hours only', () => {
      expect(formatCraftTime(3600)).toBe('1 h');
    });
    it('formats hours + minutes + seconds', () => {
      expect(formatCraftTime(3661)).toBe('1 h 1 m 1 s');
    });
    it('rounds fractional seconds', () => {
      expect(formatCraftTime(45.6)).toBe('46 s');
    });
  });

  describe('formatQuality', () => {
    it('converts 0–1 fraction to percent string', () => {
      expect(formatQuality(0.5)).toBe('50 %');
      expect(formatQuality(1)).toBe('100 %');
      expect(formatQuality(0)).toBe('0 %');
    });
    it('returns n/a for nullish', () => {
      expect(formatQuality(null)).toBe('n/a');
      expect(formatQuality(undefined)).toBe('n/a');
    });
  });

  describe('categorizePort', () => {
    it('classifies by accepted type', () => {
      expect(categorizePort(['WeaponGun'], null)).toBe('weapons');
      expect(categorizePort(['QuantumDrive'], null)).toBe('propulsion');
      expect(categorizePort(['Shield'], null)).toBe('defense');
    });
    it('falls back to port-name keywords', () => {
      expect(categorizePort([], 'hardpoint_thruster_main_left')).toBe('propulsion');
      expect(categorizePort([], 'hardpoint_shield_generator_left')).toBe('defense');
    });
    it('defaults to other', () => {
      expect(categorizePort([], 'hardpoint_mystery')).toBe('other');
    });
  });
});
