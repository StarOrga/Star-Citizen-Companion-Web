import {
  borrowedCountermeasureNameKey,
  countermeasureKind,
  decoysToOutshine,
  isCountermeasureLauncher,
} from './codex-countermeasure';

const name = (key: string) => ({ de: 'x', en: 'x', key });

describe('codex-countermeasure (#242)', () => {
  it('spots a launcher by its subType', () => {
    expect(isCountermeasureLauncher({ subType: 'CountermeasureLauncher' })).toBeTrue();
    expect(isCountermeasureLauncher({ subType: 'Gun' })).toBeFalse();
    expect(isCountermeasureLauncher(null)).toBeFalse();
  });

  it('tells decoy from noise by the round type, then by the class name', () => {
    const chaff = { raw: { projectileParams: { typeParams: { _Type_: 'CounterMeasureChaffParams' } } } };
    expect(countermeasureKind('CNOU_Nomad_CML_Flare', chaff)).toBe('noise');
    expect(countermeasureKind('CNOU_Nomad_CML_Flare')).toBe('decoy');
    expect(countermeasureKind('AEGS_Javelin_CML_Decoy')).toBe('decoy');
    expect(countermeasureKind('CRUS_CML_Noise_Big')).toBe('noise');
    expect(countermeasureKind('KLWE_LaserRepeater_S3')).toBeNull();
  });

  it('replaces a name borrowed from another ship (Nomad -> Gladius key)', () => {
    expect(
      borrowedCountermeasureNameKey('CNOU_Nomad_CML_Flare', name('@item_NameAEGS_Gladius_CML_Flare')),
    ).toBe('codex.countermeasure.name.decoy');
    expect(
      borrowedCountermeasureNameKey('CNOU_Nomad_CML_Chaff', name('@item_NameJOKR_Defcon_CML_Chaff')),
    ).toBe('codex.countermeasure.name.noise');
  });

  it('keeps a launcher that owns its name, and leaves non-launchers alone', () => {
    expect(
      borrowedCountermeasureNameKey('AEGS_Gladius_CML_Flare', name('@item_NameAEGS_Gladius_CML_Flare')),
    ).toBeNull();
    expect(borrowedCountermeasureNameKey('KLWE_LaserRepeater_S3', name('@item_NameOther'))).toBeNull();
    expect(borrowedCountermeasureNameKey('CNOU_Nomad_CML_Flare', null)).toBeNull();
  });

  it('needs strictly more signature than the ship: 40,000 vs 20,000 = 3', () => {
    expect(decoysToOutshine(40000, 20000)).toBe(3);
    expect(decoysToOutshine(39999, 20000)).toBe(2);
    expect(decoysToOutshine(5000, 20000)).toBe(1);
  });

  it('never guesses a count from a missing or non-positive value', () => {
    expect(decoysToOutshine(null, 20000)).toBeNull();
    expect(decoysToOutshine(40000, null)).toBeNull();
    expect(decoysToOutshine(40000, 0)).toBeNull();
    expect(decoysToOutshine(0, 20000)).toBeNull();
  });
});
