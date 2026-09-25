import { fpsArmorWeightKey, fpsWeaponTypeKey } from './fps-labels';

describe('fps labels', () => {
  it('maps the known weapon types and armour weights to their i18n keys', () => {
    expect(fpsWeaponTypeKey('Small')).toBe('fps.weaponType.sidearm');
    expect(fpsWeaponTypeKey('Grenade')).toBe('fps.weaponType.throwable');
    expect(fpsArmorWeightKey('Heavy')).toBe('fps.weight.heavy');
  });

  it('gives no key for unknown, empty or missing tokens', () => {
    expect(fpsWeaponTypeKey('Weapon')).toBeNull();
    expect(fpsArmorWeightKey('UNDEFINED')).toBeNull();
    expect(fpsArmorWeightKey('Helmet')).toBeNull();
    expect(fpsWeaponTypeKey('')).toBeNull();
    expect(fpsWeaponTypeKey(null)).toBeNull();
    expect(fpsArmorWeightKey(undefined)).toBeNull();
  });

  it('never reads a token off the object prototype', () => {
    // A plain lookup answered `constructor` with Object's constructor function.
    expect(fpsWeaponTypeKey('constructor')).toBeNull();
    expect(fpsArmorWeightKey('toString')).toBeNull();
  });
});
