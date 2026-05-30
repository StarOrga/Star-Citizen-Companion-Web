import {
  ammoDamage,
  categorizePort,
  curateComponentStats,
  formatNumber,
  humanizeKey,
  isMeaningfulValue,
  meaningfulRows,
  unescapeText,
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

  describe('curateComponentStats', () => {
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

  describe('meaningfulRows', () => {
    it('filters config noise from a flat record', () => {
      const rows = meaningfulRows({ fireOnAim: false, geometryTags: 'White01', supplementaryFireTime: 0 });
      // booleans dropped, 0 kept (it is a finite number) — only string + numeric survive
      expect(rows.map((r) => r.key)).toContain('Geometry Tags');
      expect(rows.find((r) => r.key === 'Fire On Aim')).toBeUndefined();
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
