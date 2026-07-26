import {
  alphaDamage,
  ammoClassNameFor,
  ammoClassNamesFor,
  commonPortLabel,
  damageChannelsOf,
  damagePerSecond,
  equippedStats,
  equippedTypeLabel,
  formatEquippedStat,
  groupIdenticalSlots,
  impactDamageChannels,
  isWeaponMountPort,
  MAX_STATS_PER_SLOT,
  penetrationDistance,
  projectileRange,
  sizeBadge,
  weaponStatsUnavailable,
  type EquippedStat,
} from './codex-equipped-stats';

// Fixtures below are trimmed copies of REAL 4.9.0 catalog payloads, so the
// expectations double as a regression guard on the extract's actual shape.

/** KLWE_LaserRepeater_S3 — the CF-337 Panther Repeater, as extracted. */
const PANTHER_WEAPON = {
  entityKind: 'weapon',
  className: 'KLWE_LaserRepeater_S3',
  subType: 'Gun',
  attachType: 'WeaponGun',
  size: 3,
  // Every ship weapon in 4.9.0 ships these as zero/null — the extractor does
  // not resolve fire actions yet.
  weaponParams: {
    fireRate: 0,
    projectilesPerShot: 0,
    ammoContainerRecord: null,
    heatPerShot: 0,
  },
};

/** KLWE_LaserRepeater_S3_AMMO — the matching projectile record. */
const PANTHER_AMMO = {
  className: 'KLWE_LaserRepeater_S3_AMMO',
  speed: 1480,
  lifetime: 1.3,
  size: 3,
  impactDamage: {
    energy: 43.65,
    physical: null,
    distortion: null,
    thermal: null,
    biochemical: null,
    stun: null,
  },
  // The extractor promotes speed/lifetime/damage but leaves everything else in
  // `raw` — armour penetration only exists down there.
  raw: {
    projectileParams: {
      penetrationParams: { farRadius: 0, nearRadius: 0, basePenetrationDistance: 0.085 },
    },
  },
};

const SHIELD = {
  entityKind: 'component',
  kind: 'Shield',
  stats: {
    SCItemShieldGeneratorParams: {
      MaxShieldHealth: 194400,
      MaxShieldRegen: 14256,
      DamagedRegenDelay: 5.55,
      DownedRegenDelay: 11.1,
    },
    SHealthComponentParams: { Health: 8000 },
  },
};

/** Coolers genuinely carry no cooling rate in the extract. */
const COOLER = {
  entityKind: 'component',
  kind: 'Cooler',
  stats: { SHealthComponentParams: { Health: 3200 } },
};

describe('codex-equipped-stats', () => {
  describe('ammoClassNameFor', () => {
    it('applies the <weaponClass>_AMMO convention', () => {
      expect(ammoClassNameFor('KLWE_LaserRepeater_S3')).toBe('KLWE_LaserRepeater_S3_AMMO');
    });
    it('returns null for missing or blank names', () => {
      expect(ammoClassNameFor(null)).toBeNull();
      expect(ammoClassNameFor('   ')).toBeNull();
    });
    it('de-duplicates a batch', () => {
      expect(ammoClassNamesFor(['A', 'A', null, 'B'])).toEqual(['A_AMMO', 'B_AMMO']);
    });
  });

  describe('impactDamageChannels', () => {
    it('reads the promoted impactDamage set, skipping empty channels', () => {
      expect(impactDamageChannels(PANTHER_AMMO)).toEqual([{ channel: 'energy', value: 43.65 }]);
    });

    it('falls back to raw projectileParams damage', () => {
      const rows = impactDamageChannels({
        raw: { projectileParams: { damage: { DamagePhysical: 52, DamageEnergy: 0 } } },
      });
      expect(rows).toEqual([{ channel: 'physical', value: 52 }]);
    });

    it('sums nothing when every channel is zero or null', () => {
      expect(impactDamageChannels({ impactDamage: { energy: 0, physical: null } })).toEqual([]);
      expect(alphaDamage({ impactDamage: { energy: 0 } })).toBeNull();
    });
  });

  describe('alphaDamage', () => {
    it('totals every damaging channel', () => {
      expect(alphaDamage({ impactDamage: { energy: 100, physical: 100 } })).toBe(200);
    });
  });

  describe('projectileRange', () => {
    it('derives range as speed x lifetime', () => {
      expect(projectileRange(1480, 1.3)).toBeCloseTo(1924, 6);
    });
    it('returns null when either input is missing or zero', () => {
      expect(projectileRange(1480, null)).toBeNull();
      expect(projectileRange(null, 1.3)).toBeNull();
      expect(projectileRange(1480, 0)).toBeNull();
    });
  });

  describe('damagePerSecond', () => {
    it('multiplies alpha damage by shots per second', () => {
      expect(damagePerSecond(43.65, 720)).toBeCloseTo(523.8, 6);
    });
    it('is null while the extract has no fire rate (the state today)', () => {
      expect(damagePerSecond(43.65, 0)).toBeNull();
      expect(damagePerSecond(43.65, null)).toBeNull();
    });
  });

  describe('penetrationDistance', () => {
    it('digs armour penetration out of the untouched raw projectile params', () => {
      expect(penetrationDistance(PANTHER_AMMO)).toBeCloseTo(0.085, 6);
    });
    it('is null when there is no ammo or no penetration block', () => {
      expect(penetrationDistance(undefined)).toBeNull();
      expect(penetrationDistance({ raw: { projectileParams: {} } })).toBeNull();
      expect(
        penetrationDistance({
          raw: { projectileParams: { penetrationParams: { basePenetrationDistance: 0 } } },
        }),
      ).toBeNull();
    });
  });

  describe('damageChannelsOf', () => {
    it('names the projectile damage type, strongest channel first', () => {
      expect(damageChannelsOf(PANTHER_WEAPON, PANTHER_AMMO)).toEqual(['energy']);
      expect(
        damageChannelsOf(null, { impactDamage: { energy: 10, distortion: 90 } }),
      ).toEqual(['distortion', 'energy']);
    });

    it('falls back to a weapon that carries its own impact damage', () => {
      expect(damageChannelsOf({ impactDamage: { physical: 12 } }, undefined)).toEqual(['physical']);
    });

    it('stays empty for mounts and unresolved occupants', () => {
      expect(damageChannelsOf({ entityKind: 'weapon', subType: 'GunTurret' }, undefined)).toEqual([]);
      expect(damageChannelsOf(null, null)).toEqual([]);
    });
  });

  describe('equippedTypeLabel', () => {
    it('says what a weapon is, readably', () => {
      expect(equippedTypeLabel({ kind: 'weapon', payload: PANTHER_WEAPON })).toBe('Gun');
      expect(
        equippedTypeLabel({
          kind: 'weapon',
          payload: { entityKind: 'weapon', subType: 'CountermeasureLauncher' },
        }),
      ).toBe('Countermeasure Launcher');
    });

    it('prefers a component kind over its subType', () => {
      expect(
        equippedTypeLabel({
          kind: 'component',
          payload: { entityKind: 'component', kind: 'QuantumDrive', subType: 'UNDEFINED' },
        }),
      ).toBe('Quantum Drive');
    });

    it('falls back to attachType when the subType is the UNDEFINED placeholder', () => {
      expect(
        equippedTypeLabel({
          kind: 'item',
          payload: { entityKind: 'item', subType: 'UNDEFINED', attachType: 'Radar' },
        }),
      ).toBe('Radar');
      expect(
        equippedTypeLabel({
          kind: 'item',
          payload: { entityKind: 'item', subType: 'MidRangeRadar' },
        }),
      ).toBe('Mid Range Radar');
    });

    it('returns null rather than a placeholder when nothing identifies the item', () => {
      expect(
        equippedTypeLabel({ kind: 'item', payload: { entityKind: 'item', subType: 'UNDEFINED' } }),
      ).toBeNull();
      expect(equippedTypeLabel({ kind: null, payload: null })).toBeNull();
    });
  });

  describe('equippedStats — weapons', () => {
    it('shows the projectile stats we really have and omits the ones we do not', () => {
      const rows = equippedStats({
        kind: 'weapon',
        payload: PANTHER_WEAPON,
        ammoPayload: PANTHER_AMMO,
      });
      const byKey = new Map(rows.map((r) => [r.labelKey, r]));
      expect(byKey.get('codex.equipped.alphaDamage')?.value).toBeCloseTo(43.65, 6);
      expect(byKey.get('codex.equipped.projectileSpeed')?.value).toBe(1480);
      expect(byKey.get('codex.equipped.range')?.value).toBeCloseTo(1924, 6);
      expect(byKey.get('codex.equipped.penetration')?.value).toBeCloseTo(0.085, 6);
      // fireRate is 0 in the extract → neither a fire-rate nor a DPS row.
      expect(byKey.has('codex.equipped.fireRate')).toBe(false);
      expect(byKey.has('codex.equipped.dps')).toBe(false);
    });

    it('marks derived rows so the UI can flag them', () => {
      const rows = equippedStats({
        kind: 'weapon',
        payload: PANTHER_WEAPON,
        ammoPayload: PANTHER_AMMO,
      });
      expect(rows.find((r) => r.labelKey === 'codex.equipped.range')?.derived).toBe(true);
      expect(rows.find((r) => r.labelKey === 'codex.equipped.alphaDamage')?.derived).toBeUndefined();
    });

    it('computes DPS as soon as a real fire rate arrives', () => {
      const rows = equippedStats({
        kind: 'weapon',
        payload: { ...PANTHER_WEAPON, weaponParams: { fireRate: 720 } },
        ammoPayload: PANTHER_AMMO,
      });
      const dps = rows.find((r) => r.labelKey === 'codex.equipped.dps');
      expect(dps?.value).toBeCloseTo(523.8, 6);
    });

    it('never emits a shield row for a weapon', () => {
      const rows = equippedStats({ kind: 'weapon', payload: PANTHER_WEAPON, ammoPayload: PANTHER_AMMO });
      expect(rows.some((r) => r.labelKey.includes('shield'))).toBe(false);
    });

    it('reports a gun with no resolvable stats instead of rendering a bare row', () => {
      const item = { kind: 'weapon', payload: PANTHER_WEAPON, ammoPayload: undefined };
      expect(equippedStats(item)).toEqual([]);
      expect(weaponStatsUnavailable(item)).toBe(true);
    });

    it('does not flag mounts (turrets/racks) as missing stats', () => {
      const turret = {
        kind: 'weapon',
        payload: { entityKind: 'weapon', subType: 'GunTurret', weaponParams: {} },
      };
      expect(weaponStatsUnavailable(turret)).toBe(false);
    });
  });

  describe('equippedStats — components', () => {
    it('gives a shield HP, regen and its delays — and no DPS', () => {
      const rows = equippedStats({ kind: 'component', payload: SHIELD });
      const keys = rows.map((r) => r.labelKey);
      expect(keys).toContain('codex.equipped.shieldHp');
      expect(keys).toContain('codex.equipped.shieldRegen');
      expect(keys).toContain('codex.equipped.regenDelay');
      expect(keys).not.toContain('codex.equipped.dps');
      expect(keys).not.toContain('codex.equipped.alphaDamage');
    });

    it('falls back to durability alone for kinds the extract has no params for', () => {
      expect(equippedStats({ kind: 'component', payload: COOLER })).toEqual([
        { labelKey: 'codex.equipped.health', value: 3200, format: 'int' },
      ]);
    });

    it('drops the FLT_MAX sentinel instead of printing an infinite jump range', () => {
      const rows = equippedStats({
        kind: 'component',
        payload: {
          entityKind: 'component',
          kind: 'QuantumDrive',
          stats: {
            SCItemQuantumDriveParams: {
              jumpRange: 3.4028230607370965e38,
              'params.driveSpeed': 196000000,
            },
          },
        },
      });
      const keys = rows.map((r) => r.labelKey);
      expect(keys).not.toContain('codex.equipped.jumpRange');
      expect(keys).toContain('codex.equipped.driveSpeed');
    });

    it('emits nothing for plain items such as controllers', () => {
      expect(equippedStats({ kind: 'item', payload: { entityKind: 'item', size: 1 } })).toEqual([]);
      expect(equippedStats({ kind: null, payload: null })).toEqual([]);
    });

    it('caps the rows so a hardpoint row stays readable', () => {
      expect(equippedStats({ kind: 'component', payload: SHIELD }).length).toBeLessThanOrEqual(
        MAX_STATS_PER_SLOT,
      );
      expect(
        equippedStats({ kind: 'weapon', payload: PANTHER_WEAPON, ammoPayload: PANTHER_AMMO }).length,
      ).toBeLessThanOrEqual(MAX_STATS_PER_SLOT);
    });
  });

  describe('formatEquippedStat', () => {
    const fmt = (format: EquippedStat['format'], value: number) =>
      formatEquippedStat({ labelKey: 'x', value, format });

    it('renders each format with its physical unit', () => {
      expect(fmt('int', 194400)).toBe('194,400');
      expect(fmt('dec', 43.65)).toBe('43.65');
      expect(fmt('perSec', 14256)).toBe('14,256/s');
      expect(fmt('seconds', 5.55)).toBe('5.55 s');
      expect(fmt('metres', 1924)).toBe('1,924 m');
      expect(fmt('metresDec', 0.085)).toBe('0.09 m'); // would round to "0 m" as 'metres'
      expect(fmt('mps', 1480)).toBe('1,480 m/s');
      expect(fmt('scu', 1.6)).toBe('1.6 SCU');
      expect(fmt('percent', 0.25)).toBe('25 %');
    });

    it('scales large engine units into readable ones', () => {
      expect(fmt('gm', 340_000_000)).toBe('340 Gm'); // metres → Gm
      expect(fmt('kms', 196_000_000)).toBe('196,000 km/s'); // m/s → km/s
      expect(fmt('kn', 1_587_318)).toBe('1,587 kN'); // newtons → kN
    });
  });

  describe('groupIdenticalSlots', () => {
    const slot = (className: string | null, size: number | null, grade = 'A') => ({
      className,
      size,
      grade,
    });

    it('collapses identical occupants and preserves first-seen order', () => {
      const groups = groupIdenticalSlots([
        slot('THRUSTER', 1),
        slot('THRUSTER', 1),
        slot('THRUSTER', 1),
        slot('GUN', 3),
      ]);
      expect(groups.map((g) => [g.slot.className, g.count])).toEqual([
        ['THRUSTER', 3],
        ['GUN', 1],
      ]);
      expect(groups[0].ports.length).toBe(3);
    });

    it('keeps items apart when size or grade differ', () => {
      const groups = groupIdenticalSlots([slot('GUN', 3, 'A'), slot('GUN', 3, 'B'), slot('GUN', 2)]);
      expect(groups.length).toBe(3);
    });

    it('never groups an empty port with a filled one', () => {
      const groups = groupIdenticalSlots([slot(null, null), slot('GUN', 3), slot(null, null)]);
      expect(groups.map((g) => g.count)).toEqual([2, 1]);
      expect(groups[0].slot.className).toBeNull();
    });
  });

  describe('sizeBadge', () => {
    it('reads "3x S3" for three identical size-3 mounts', () => {
      expect(sizeBadge(3, 3)).toBe('3× S3');
    });
    it('drops the multiplier for a single mount', () => {
      expect(sizeBadge(1, 3)).toBe('S3');
    });
    it('never guesses a size the extract does not have', () => {
      expect(sizeBadge(1, null)).toBeNull();
      expect(sizeBadge(3, null)).toBe('3×');
    });
  });

  describe('commonPortLabel', () => {
    it('never claims N copies of one specific mount, and keeps the positions', () => {
      expect(
        commonPortLabel([
          'Hardpoint Weapon Top Left',
          'Hardpoint Weapon Top Right',
          'Hardpoint Weapon Bottom',
        ]),
      ).toBe('Hardpoint Weapon (Top Left / Top Right / Bottom)');
      expect(
        commonPortLabel(['Hardpoint Weapon Left Wing', 'Hardpoint Weapon Right Wing']),
      ).toBe('Hardpoint Weapon (Left Wing / Right Wing)');
    });

    it('drops the position list once it stops being readable', () => {
      const mav = [
        'Thruster Mav Left Front Top',
        'Thruster Mav Left Front Bot',
        'Thruster Mav Right Rear Top',
        'Thruster Mav Right Rear Bot',
      ];
      expect(commonPortLabel(mav)).toBe('Thruster Mav');
    });

    it('keeps the full label when every port really is named the same', () => {
      expect(commonPortLabel(['Hardpoint Shield Generator', 'Hardpoint Shield Generator'])).toBe(
        'Hardpoint Shield Generator',
      );
    });

    it('passes a single label through unchanged', () => {
      expect(commonPortLabel(['Hardpoint Turret'])).toBe('Hardpoint Turret');
      expect(commonPortLabel([])).toBe('');
    });

    it('falls back to the first label when nothing is shared', () => {
      expect(commonPortLabel(['Alpha Port', 'Beta Port'])).toBe('Alpha Port');
    });
  });

  describe('isWeaponMountPort', () => {
    it('accepts real gun and turret mounts', () => {
      expect(isWeaponMountPort('hardpoint_weapon_top_left')).toBe(true);
      expect(isWeaponMountPort('hardpoint_turret')).toBe(true);
    });
    it('rejects the fire-group controller and the interior FPS weapon rack', () => {
      expect(isWeaponMountPort('hardpoint_controller_weapon')).toBe(false);
      expect(isWeaponMountPort('hardpoint_weapon_rack_01')).toBe(false);
    });
    it('rejects non-weapon ports and blanks', () => {
      expect(isWeaponMountPort('hardpoint_shield_generator_02')).toBe(false);
      expect(isWeaponMountPort(null)).toBe(false);
    });
  });
});
