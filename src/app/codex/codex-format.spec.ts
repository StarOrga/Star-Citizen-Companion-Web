import {
  ammoDamage,
  buildCompareTable,
  categorizePort,
  classifyStatPurpose,
  cleanLocaleValue,
  collectCompareAttributes,
  comparePatchVersion,
  computeStatDeltas,
  curateComponentStats,
  flattenSpec,
  formatCraftTime,
  formatNumber,
  formatQuality,
  groupCompareRows,
  groupStatRows,
  humanizeBlueprintCategory,
  humanizeBlueprintName,
  humanizeClassName,
  humanizeKey,
  isCatalogStale,
  isMeaningfulValue,
  isNoiseKey,
  meaningfulRows,
  rowHasDifferences,
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

  describe('humanizeBlueprintName', () => {
    it('drops the BP_CRAFT_ prefix every blueprint carries', () => {
      expect(humanizeBlueprintName('BP_CRAFT_APAR_MassDriver_S2')).toBe('APAR Mass Driver S2');
    });
    it('leaves a class name without the prefix alone', () => {
      expect(humanizeBlueprintName('AMRS_LaserCannon_S3')).toBe('AMRS Laser Cannon S3');
    });
    it('returns empty for nullish', () => {
      expect(humanizeBlueprintName(null)).toBe('');
      expect(humanizeBlueprintName('')).toBe('');
    });
  });

  describe('humanizeBlueprintCategory', () => {
    it('splits an acronym from the word that follows it', () => {
      expect(humanizeBlueprintCategory('FPSArmours')).toBe('FPS Armours');
      expect(humanizeBlueprintCategory('FPSWeapons')).toBe('FPS Weapons');
    });
    it('splits PascalCase and keeps size tokens attached to their word', () => {
      expect(humanizeBlueprintCategory('VehicleComponentS1')).toBe('Vehicle Component S1');
      expect(humanizeBlueprintCategory('VehicleWeaponsS6')).toBe('Vehicle Weapons S6');
      expect(humanizeBlueprintCategory('MissionItem')).toBe('Mission Item');
    });
    it('returns empty for nullish', () => {
      expect(humanizeBlueprintCategory(null)).toBe('');
      expect(humanizeBlueprintCategory('')).toBe('');
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

    // A ship must not look armed with things that cannot shoot: the fire-group
    // controller module and the interior rack holding the crew's personal FPS
    // weapons both have "weapon" in the port name but are not armament.
    it('keeps controllers and FPS weapon racks out of the weapons cluster', () => {
      expect(categorizePort([], 'hardpoint_controller_weapon')).toBe('avionics');
      expect(categorizePort(['WeaponController'], 'hardpoint_controller_weapon')).toBe('avionics');
      expect(categorizePort([], 'hardpoint_weapon_rack_01')).toBe('systems');
    });

    it('clusters every controller module under avionics, whatever it controls', () => {
      expect(categorizePort(['ShieldController'], 'hardpoint_controller_shield')).toBe('avionics');
      expect(categorizePort(['EnergyController'], 'hardpoint_controller_energy')).toBe('avionics');
    });

    it('still classifies real gun mounts as weapons', () => {
      expect(categorizePort([], 'hardpoint_weapon_top_left')).toBe('weapons');
      expect(categorizePort([], 'hardpoint_turret')).toBe('weapons');
    });
  });

  describe('classifyStatPurpose', () => {
    it('classifies by label keywords in priority order', () => {
      expect(classifyStatPurpose('Max Shield Health')).toBe('defense');
      expect(classifyStatPurpose('Muzzle Velocity')).toBe('offense'); // muzzle wins over m/s
      expect(classifyStatPurpose('Damage Energy')).toBe('offense'); // damage wins over powerThermal
      expect(classifyStatPurpose('SCM Speed')).toBe('mobility');
      expect(classifyStatPurpose('Power Draw')).toBe('powerThermal');
      expect(classifyStatPurpose('Cargo Capacity')).toBe('capacity');
      expect(classifyStatPurpose('Spread Min')).toBe('handling');
    });
    it('lets the rpm unit override keywords, falls back to unit then general', () => {
      expect(classifyStatPurpose('Rounds Per Minute', 'rpm')).toBe('offense'); // rpm beats 'rounds'
      expect(classifyStatPurpose('Max Rounds')).toBe('capacity'); // ammo count without rpm
      expect(classifyStatPurpose('Grade')).toBe('general');
    });
  });

  describe('groupStatRows', () => {
    it('buckets rows by purpose in display order, omitting empty buckets', () => {
      const groups = groupStatRows([
        { key: 'Cargo Capacity', value: '96' },
        { key: 'Max Shield Health', value: '2,244', unit: 'HP' },
        { key: 'Damage Energy', value: '273' },
      ]);
      expect(groups.map((g) => g.purpose)).toEqual(['offense', 'defense', 'capacity']);
      expect(groups[1].rows[0].key).toBe('Max Shield Health');
    });
    it('returns a single general bucket for unclassifiable rows', () => {
      const groups = groupStatRows([{ key: 'Grade', value: 'A' }]);
      expect(groups).toEqual([{ purpose: 'general', rows: [{ key: 'Grade', value: 'A' }] }]);
    });
  });

  describe('buildCompareTable groups + delta bars', () => {
    const cols = [
      { key: 'a', name: 'A', kind: 'component', className: 'A' },
      { key: 'b', name: 'B', kind: 'component', className: 'B' },
    ];
    it('carries the first-seen group onto the row', () => {
      const rows = buildCompareTable(cols, [
        [{ id: 'cs_Max Shield Health', label: 'Max Shield Health', value: '2,244 HP', group: 'defense' }],
        [{ id: 'cs_Max Shield Health', label: 'Max Shield Health', value: '1,800 HP', group: 'defense' }],
      ]);
      expect(rows[0].group).toBe('defense');
    });
    it('emits barPct as % of the row max for ranked rows', () => {
      const rows = buildCompareTable(cols, [
        [{ id: 'x', label: 'X', value: '100' }],
        [{ id: 'x', label: 'X', value: '50' }],
      ]);
      expect(rows[0].barPct).toEqual([100, 50]);
      expect(rows[0].highlight).toEqual(['best', 'worst']);
    });
    it('leaves unrankable rows without bars', () => {
      const rows = buildCompareTable(cols, [
        [{ id: 'g', label: 'Grade', value: 'A' }],
        [{ id: 'g', label: 'Grade', value: 'B' }],
      ]);
      expect(rows[0].barPct).toEqual([null, null]);
    });
  });

  describe('groupCompareRows', () => {
    const row = (id: string, group: string | undefined, values: (string | null)[]) => ({
      id, label: id, group, values,
      highlight: values.map(() => null),
      barPct: values.map(() => null),
    });
    it('orders identity first, then purpose buckets; unknown → general', () => {
      const grouped = groupCompareRows([
        row('dmg', 'offense', ['1', '2']),
        row('mfr', 'identity', ['AEGS', 'BEHR']),
        row('misc', undefined, ['x', 'y']),
      ]);
      expect(grouped.map((g) => g.group)).toEqual(['identity', 'offense', 'general']);
    });
  });

  describe('rowHasDifferences', () => {
    const mk = (values: (string | null)[]) => ({
      id: 'x', label: 'X', values,
      highlight: values.map(() => null), barPct: values.map(() => null),
    });
    it('detects differing and missing values', () => {
      expect(rowHasDifferences(mk(['1', '2']))).toBe(true);
      expect(rowHasDifferences(mk(['1', null]))).toBe(true);
      expect(rowHasDifferences(mk(['1', '1']))).toBe(false);
    });
  });

  describe('computeStatDeltas', () => {
    it('joins by label, computes % change, sorts by impact', () => {
      const deltas = computeStatDeltas(
        [
          { key: 'Max Shield Health', value: '2,000', unit: 'HP' },
          { key: 'Max Shield Regen', value: '400', unit: 'HP/s' },
          { key: 'Grade', value: 'B' },
        ],
        [
          { key: 'Max Shield Health', value: '2,400', unit: 'HP' },
          { key: 'Max Shield Regen', value: '380', unit: 'HP/s' },
          { key: 'Grade', value: 'A' },
        ],
      );
      expect(deltas[0]).toEqual(
        jasmine.objectContaining({ key: 'Max Shield Health', pct: 20 }),
      );
      expect(deltas[1]).toEqual(
        jasmine.objectContaining({ key: 'Max Shield Regen', pct: -5 }),
      );
      // Non-numeric change is kept (pct null) but sorted last.
      expect(deltas[2]).toEqual(
        jasmine.objectContaining({ key: 'Grade', from: 'B', to: 'A', pct: null }),
      );
    });
    it('skips identical values and stats only one side has', () => {
      const deltas = computeStatDeltas(
        [{ key: 'Health', value: '170' }, { key: 'Only Installed', value: '5' }],
        [{ key: 'Health', value: '170' }, { key: 'Only Candidate', value: '9' }],
      );
      expect(deltas).toEqual([]);
    });
    it('caps the list at the limit', () => {
      const installed = Array.from({ length: 10 }, (_, i) => ({ key: `S${i}`, value: '10' }));
      const candidate = Array.from({ length: 10 }, (_, i) => ({ key: `S${i}`, value: String(20 + i) }));
      expect(computeStatDeltas(installed, candidate, 4).length).toBe(4);
    });
  });

  describe('flattenSpec', () => {
    it('sections top-level scalars and nested structs, skipping rendered keys', () => {
      const sections = flattenSpec({
        className: 'AEGS_Gladius', // skipped (rendered elsewhere)
        name: { de: 'x', en: 'x', key: 'k' }, // skipped
        role: 'Fighter',
        crew: { size: 1 },
        stats: { SCItemShieldGeneratorParams: { MaxShieldHealth: 2244 } },
      });
      const titles = sections.map((s) => s.title);
      expect(titles[0]).toBe(''); // top-level scalars first
      expect(sections[0].rows).toContain(jasmine.objectContaining({ key: 'Role', value: 'Fighter' }));
      expect(titles).toContain('Crew');
      expect(titles).toContain('Stats');
      const stats = sections.find((s) => s.title === 'Stats')!;
      expect(stats.rows).toContain(
        jasmine.objectContaining({ key: 'Max Shield Health', value: '2,244', unit: 'HP' }),
      );
    });
    it('returns empty for non-object payloads', () => {
      expect(flattenSpec(null)).toEqual([]);
      expect(flattenSpec('x')).toEqual([]);
      expect(flattenSpec([1, 2])).toEqual([]);
    });
  });

  describe('comparePatchVersion', () => {
    it('orders numeric patch versions correctly (not lexically)', () => {
      expect(comparePatchVersion('4.8.0', '4.10.0')).toBe(-1); // 8 < 10 (lexical would be wrong)
      expect(comparePatchVersion('4.10.0', '4.8.0')).toBe(1);
      expect(comparePatchVersion('4.8.0', '4.8.0')).toBe(0);
    });
    it('treats missing trailing groups as zero', () => {
      expect(comparePatchVersion('4', '4.0.0')).toBe(0);
      expect(comparePatchVersion('4.8', '4.8.1')).toBe(-1);
    });
    it('sorts a fuzzy "4.x" seed below a real 4.8.0', () => {
      expect(comparePatchVersion('4.x', '4.8.0')).toBe(-1);
      expect(comparePatchVersion('4.8.0', '4.x')).toBe(1);
    });
    it('ignores non-numeric decoration and nullish input', () => {
      expect(comparePatchVersion('4.8.0-LIVE.9876543', '4.8.0')).toBe(1); // trailing build number counts
      expect(comparePatchVersion(null, undefined)).toBe(0);
      expect(comparePatchVersion('', '4.8.0')).toBe(-1);
    });
  });

  describe('isCatalogStale', () => {
    it('is stale when a newer patch is live than the build', () => {
      expect(isCatalogStale('4.8.0', '4.x')).toBe(true);
      expect(isCatalogStale('4.10.0', '4.8.0')).toBe(true);
    });
    it('is not stale when equal or older, or when either side is unknown', () => {
      expect(isCatalogStale('4.8.0', '4.8.0')).toBe(false);
      expect(isCatalogStale('4.7.0', '4.8.0')).toBe(false);
      expect(isCatalogStale(null, '4.8.0')).toBe(false);
      expect(isCatalogStale('4.8.0', null)).toBe(false);
    });
  });
});
