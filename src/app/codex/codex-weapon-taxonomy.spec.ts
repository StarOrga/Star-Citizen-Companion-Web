import {
  WEAPON_SUPER_GROUPS,
  WeaponFacetRow,
  countWeaponGroups,
  weaponGroupKey,
  weaponGroupQuery,
  weaponSubGroupOf,
  weaponSuperGroup,
  weaponSuperGroupOf,
} from './codex-weapon-taxonomy';

function facet(
  weaponClass: string | null,
  attachType: string | null,
  subType: string | null,
  isVariant = false,
): WeaponFacetRow {
  return { weaponClass, attachType, subType, isVariant };
}

describe('codex weapon taxonomy', () => {
  it('splits the catalog into exactly the two super categories the data has', () => {
    expect(WEAPON_SUPER_GROUPS.map((g) => g.id)).toEqual(['fps', 'ship']);
    expect(WEAPON_SUPER_GROUPS.map((g) => g.weaponClass)).toEqual(['FPS', 'Ship']);
  });

  it('gives every super category exactly one catch-all bucket', () => {
    for (const sup of WEAPON_SUPER_GROUPS) {
      expect(sup.subGroups.filter((s) => s.rest).length).toBe(1);
    }
  });

  it('maps a row to its super category by weapon_class', () => {
    expect(weaponSuperGroupOf(facet('FPS', null, 'Small'))?.id).toBe('fps');
    expect(weaponSuperGroupOf(facet('Ship', 'WeaponGun', 'Gun'))?.id).toBe('ship');
    expect(weaponSuperGroupOf(facet(null, null, null))).toBeNull();
  });

  it('cuts FPS gear by sub_type — the carry class CIG ships', () => {
    const fps = weaponSuperGroup('fps')!;
    expect(weaponSubGroupOf(fps, facet('FPS', 'WeaponPersonal', 'Small'))).toBe('sidearm');
    expect(weaponSubGroupOf(fps, facet('FPS', 'WeaponPersonal', 'Medium'))).toBe('primary');
    expect(weaponSubGroupOf(fps, facet('FPS', 'WeaponPersonal', 'Large'))).toBe('heavy');
    expect(weaponSubGroupOf(fps, facet('FPS', 'WeaponPersonal', 'Knife'))).toBe('melee');
    expect(weaponSubGroupOf(fps, facet('FPS', 'WeaponPersonal', 'Grenade'))).toBe('throwable');
    expect(weaponSubGroupOf(fps, facet('FPS', 'WeaponPersonal', 'Gadget'))).toBe('gadget');
  });

  it('cuts ship weapons by attach_type — the hardpoint contract, not the mount shape', () => {
    const ship = weaponSuperGroup('ship')!;
    expect(weaponSubGroupOf(ship, facet('Ship', 'WeaponGun', 'Gun'))).toBe('gun');
    // Every turret mount shape (Ball/Top/Canard/PDC/…) collapses into one bucket.
    expect(weaponSubGroupOf(ship, facet('Ship', 'Turret', 'BallTurret'))).toBe('turret');
    expect(weaponSubGroupOf(ship, facet('Ship', 'Turret', 'PDCTurret'))).toBe('turret');
    expect(weaponSubGroupOf(ship, facet('Ship', 'MissileLauncher', 'MissileRack'))).toBe('missile');
    expect(weaponSubGroupOf(ship, facet('Ship', 'WeaponDefensive', 'CountermeasureLauncher')))
      .toBe('countermeasure');
    expect(weaponSubGroupOf(ship, facet('Ship', 'WeaponMining', 'Gun'))).toBe('mining');
    expect(weaponSubGroupOf(ship, facet('Ship', 'TractorBeam', 'UNDEFINED'))).toBe('utility');
    expect(weaponSubGroupOf(ship, facet('Ship', 'SalvageHead', 'UNDEFINED'))).toBe('utility');
  });

  it('never loses a record: unmapped and NULL fields land in the catch-all', () => {
    const fps = weaponSuperGroup('fps')!;
    const ship = weaponSuperGroup('ship')!;
    expect(weaponSubGroupOf(fps, facet('FPS', 'WeaponPersonal', 'Weapon'))).toBe('other');
    expect(weaponSubGroupOf(fps, facet('FPS', 'WeaponPersonal', null))).toBe('other');
    expect(weaponSubGroupOf(ship, facet('Ship', null, null))).toBe('other');
  });

  it('narrows to the super category alone when no sub category is picked', () => {
    expect(weaponGroupQuery('fps', '')).toEqual({ weaponClass: 'FPS' });
    expect(weaponGroupQuery('ship', '')).toEqual({ weaponClass: 'Ship' });
  });

  it('returns no filter at all for "all weapons"', () => {
    expect(weaponGroupQuery('', '')).toEqual({});
    expect(weaponGroupQuery('nonsense', 'gun')).toEqual({});
  });

  it('translates a sub category into a server-side value set', () => {
    expect(weaponGroupQuery('ship', 'utility')).toEqual({
      weaponClass: 'Ship',
      attachTypeIn: ['TractorBeam', 'TowingBeam', 'SalvageHead'],
    });
    expect(weaponGroupQuery('fps', 'sidearm')).toEqual({
      weaponClass: 'FPS',
      subTypeIn: ['Small'],
    });
  });

  it('translates the catch-all into the complement of every mapped value', () => {
    const fpsRest = weaponGroupQuery('fps', 'other');
    expect(fpsRest.weaponClass).toBe('FPS');
    expect(fpsRest.subTypeNotIn).toEqual([
      'Small', 'Medium', 'Large', 'Knife', 'Grenade', 'Gadget',
    ]);
    expect(fpsRest.subTypeIn).toBeUndefined();

    const shipRest = weaponGroupQuery('ship', 'other');
    expect(shipRest.attachTypeNotIn).toContain('WeaponGun');
    expect(shipRest.attachTypeNotIn).toContain('SalvageHead');
    expect(shipRest.attachTypeIn).toBeUndefined();
  });

  it('counts each record once into its super category and once into its bucket', () => {
    const counts = countWeaponGroups([
      facet('FPS', 'WeaponPersonal', 'Medium'),
      facet('FPS', 'WeaponPersonal', 'Medium'),
      facet('FPS', 'WeaponPersonal', 'Knife'),
      facet('Ship', 'Turret', 'GunTurret'),
      facet('Ship', 'WeaponGun', 'Gun'),
    ]);
    expect(counts.get(weaponGroupKey('fps'))).toBe(3);
    expect(counts.get(weaponGroupKey('fps', 'primary'))).toBe(2);
    expect(counts.get(weaponGroupKey('fps', 'melee'))).toBe(1);
    expect(counts.get(weaponGroupKey('ship'))).toBe(2);
    expect(counts.get(weaponGroupKey('ship', 'turret'))).toBe(1);
    expect(counts.get(weaponGroupKey('fps', 'gadget'))).toBeUndefined();
  });

  it('ignores records with no weapon_class instead of inventing a bucket', () => {
    const counts = countWeaponGroups([facet(null, null, 'Medium')]);
    expect(counts.size).toBe(0);
  });
});
