import type { CodexListRow } from './codex.service';
import {
  groupSkinRows,
  normalizeSkinName,
  resolveSkinGroup,
  sharedClassSegments,
  skinQueryPrefix,
  splitLiveryName,
} from './codex-skin-group';

function row(partial: Partial<CodexListRow> & { classNameSlug: string }): CodexListRow {
  return {
    nameLocalized: null,
    manufacturerCode: null,
    size: null,
    grade: null,
    role: null,
    crewSize: null,
    weaponClass: null,
    componentKind: null,
    subType: null,
    attachType: null,
    speed: null,
    isVariant: false,
    payload: null,
    blueprintCategory: null,
    blueprintTier: null,
    craftTimeSec: null,
    ...partial,
  };
}

/** The family from admin feedback d5e39f86, trimmed to three liveries. */
const lh86 = [
  row({ classNameSlug: 'gmni_pistol_ballistic_01', nameLocalized: 'LH86 Pistol' }),
  row({
    classNameSlug: 'gmni_pistol_ballistic_01_gold01',
    nameLocalized: 'LH86 "Executive Edition" Pistol',
  }),
  row({ classNameSlug: 'gmni_pistol_ballistic_01_tan01', nameLocalized: 'LH86 "Desert Shadow" Pistol' }),
  // The extract leaves a mis-decoded non-breaking space before the token here.
  row({ classNameSlug: 'gmni_pistol_ballistic_01_cen01', nameLocalized: 'LH86\uFFFD\u00A0"Voyager" Pistol' }),
];

describe('normalizeSkinName', () => {
  it('collapses the stray spacing characters the extract leaves behind', () => {
    expect(normalizeSkinName('LH86\uFFFD\u00A0"Voyager"  Pistol')).toBe('LH86 "Voyager" Pistol');
  });

  it('is empty for a missing name', () => {
    expect(normalizeSkinName(null)).toBe('');
    expect(normalizeSkinName('   ')).toBe('');
  });
});

describe('splitLiveryName', () => {
  it('splits a quoted livery token out of the name', () => {
    expect(splitLiveryName('LH86 "Voyager" Pistol')).toEqual({
      base: 'LH86 Pistol',
      livery: 'Voyager',
    });
  });

  it('accepts typographic quotes', () => {
    expect(splitLiveryName('SW16BR1 \u201CBuzzsaw\u201D Repeater')).toEqual({
      base: 'SW16BR1 Repeater',
      livery: 'Buzzsaw',
    });
  });

  it('returns null without a quoted token', () => {
    expect(splitLiveryName('LH86 Pistol')).toBeNull();
    expect(splitLiveryName('')).toBeNull();
  });

  it('returns null when the token is the whole name', () => {
    expect(splitLiveryName('"Voyager"')).toBeNull();
  });
});

describe('sharedClassSegments', () => {
  it('counts leading underscore segments, case-insensitively', () => {
    expect(sharedClassSegments('gmni_pistol_ballistic_01', 'GMNI_pistol_ballistic_01_cen01')).toBe(4);
    expect(sharedClassSegments('lbco_pistol_energy_01', 'lbco_pistol_energy_cen01')).toBe(3);
    expect(sharedClassSegments('behr_pistol_ballistic_01', 'gmni_pistol_ballistic_01')).toBe(0);
  });
});

describe('skinQueryPrefix', () => {
  it('keeps the first three class segments', () => {
    expect(skinQueryPrefix('gmni_pistol_ballistic_01_cen01')).toBe('gmni_pistol_ballistic');
    expect(skinQueryPrefix('KLWE_LaserRepeater_S2')).toBe('KLWE_LaserRepeater_S2');
    expect(skinQueryPrefix('apar_melee')).toBe('apar_melee');
  });
});

describe('groupSkinRows', () => {
  it('collapses a livery family into its base record', () => {
    const out = groupSkinRows(lh86);
    expect(out.length).toBe(1);
    expect(out[0].classNameSlug).toBe('gmni_pistol_ballistic_01');
    expect(out[0].skinVariants.map((s) => s.liveryName)).toEqual([
      'Desert Shadow',
      'Executive Edition',
      'Voyager',
    ]);
  });

  it('keeps the surviving rows in their incoming order', () => {
    const out = groupSkinRows([
      row({ classNameSlug: 'aaaa_rifle_ballistic_01', nameLocalized: 'A Rifle' }),
      ...lh86,
      row({ classNameSlug: 'zzzz_rifle_ballistic_01', nameLocalized: 'Z Rifle' }),
    ]);
    expect(out.map((r) => r.classNameSlug)).toEqual([
      'aaaa_rifle_ballistic_01',
      'gmni_pistol_ballistic_01',
      'zzzz_rifle_ballistic_01',
    ]);
  });

  it('leaves ordinary rows untouched', () => {
    const out = groupSkinRows([row({ classNameSlug: 'behr_gren_frag_01', nameLocalized: 'MK-4 Frag Grenade' })]);
    expect(out.length).toBe(1);
    expect(out[0].skinVariants).toEqual([]);
  });

  it('keeps a livery standalone when the base record is not in the set', () => {
    // TBF-4 ships only as two liveries; the plain knife is not in the catalog.
    const out = groupSkinRows([
      row({ classNameSlug: 'rrs_melee_01_fallout01', nameLocalized: 'TBF-4 "Balefire" Combat Knife' }),
      row({ classNameSlug: 'rrs_melee_01_orange01', nameLocalized: 'TBF-4 "Sunspike" Combat Knife' }),
    ]);
    expect(out.length).toBe(2);
    expect(out.every((r) => r.skinVariants.length === 0)).toBeTrue();
  });

  it('refuses to guess when two records carry the base name', () => {
    const out = groupSkinRows([
      row({ classNameSlug: 'grin_multitool_01', nameLocalized: 'Pyro RYT Multi-Tool' }),
      row({ classNameSlug: 'grin_multitool_01_default_cutter', nameLocalized: 'Pyro RYT Multi-Tool' }),
      row({ classNameSlug: 'grin_multitool_01_red01', nameLocalized: 'Pyro RYT "Bloodline" Multi-Tool' }),
    ]);
    expect(out.length).toBe(3);
  });

  it('never joins two records from different class families', () => {
    // Same product name, unrelated class roots: the ship weapon "Buzzsaw" is a
    // model name, not a paint job.
    const out = groupSkinRows([
      row({ classNameSlug: 'BEHR_BallisticRepeater_S1', nameLocalized: 'SW16BR1 "Buzzsaw" Repeater' }),
      row({ classNameSlug: 'XXXX_SomethingElse_S1', nameLocalized: 'SW16BR1 Repeater' }),
    ]);
    expect(out.length).toBe(2);
  });

  it('tolerates an inconsistently numbered base record', () => {
    const out = groupSkinRows([
      row({ classNameSlug: 'lbco_sniper_energy_01', nameLocalized: 'Atzkav Sniper Rifle' }),
      row({ classNameSlug: 'lbco_sniper_energy_imp01', nameLocalized: 'Atzkav "Deadeye" Sniper Rifle' }),
    ]);
    expect(out.length).toBe(1);
    expect(out[0].classNameSlug).toBe('lbco_sniper_energy_01');
  });

  it('ignores rows without a resolvable name', () => {
    const out = groupSkinRows([
      row({ classNameSlug: 'a_b_c', nameLocalized: null }),
      row({ classNameSlug: 'a_b_c_d', nameLocalized: null }),
    ]);
    expect(out.length).toBe(2);
  });
});

describe('resolveSkinGroup', () => {
  it('lists the base record first, then the liveries by name', () => {
    expect(resolveSkinGroup(lh86, 'gmni_pistol_ballistic_01')).toEqual([
      { classNameSlug: 'gmni_pistol_ballistic_01', liveryName: null },
      { classNameSlug: 'gmni_pistol_ballistic_01_tan01', liveryName: 'Desert Shadow' },
      { classNameSlug: 'gmni_pistol_ballistic_01_gold01', liveryName: 'Executive Edition' },
      { classNameSlug: 'gmni_pistol_ballistic_01_cen01', liveryName: 'Voyager' },
    ]);
  });

  it('resolves the same family from a livery deep link', () => {
    const fromLivery = resolveSkinGroup(lh86, 'gmni_pistol_ballistic_01_cen01');
    expect(fromLivery).toEqual(resolveSkinGroup(lh86, 'gmni_pistol_ballistic_01'));
  });

  it('is null for an entity with no liveries', () => {
    expect(resolveSkinGroup(lh86, 'behr_gren_frag_01')).toBeNull();
  });
});
