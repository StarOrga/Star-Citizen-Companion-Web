import type { CodexListRow } from './codex.service';
import {
  editionQueryPrefix,
  editionSuffixName,
  groupEditionRows,
  humanizeEditionSuffix,
  normalizeEditionName,
  resolveEditionGroup,
} from './codex-edition-group';

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

/**
 * Real build-4.9.0 records, trimmed. The Cutlass Black is the extreme case from
 * admin feedback 77ecad2a: seven records, all reading `Drake Cutlass Black`.
 * `DRAK_Cutlass_Black_ShipShowdown` is deliberately part of the fixture — its
 * name drops the "Black", so the rule cannot prove it and it keeps its own card.
 */
const cutlass = [
  row({ classNameSlug: 'DRAK_Cutlass_Black', nameLocalized: 'Drake Cutlass Black' }),
  row({ classNameSlug: 'DRAK_Cutlass_Black_BIS2950', nameLocalized: 'Drake Cutlass Black' }),
  row({ classNameSlug: 'DRAK_Cutlass_Black_PU_Boarding', nameLocalized: 'Drake Cutlass Black' }),
  row({
    classNameSlug: 'DRAK_Cutlass_Black_ShipShowdown',
    nameLocalized: 'Drake Cutlass 2949 Best In Show Edition',
  }),
  // A sibling model, not an edition: not a class-name descendant of Black.
  row({ classNameSlug: 'DRAK_Cutlass_Blue', nameLocalized: 'Drake Cutlass Blue' }),
];

/** A family that mixes both halves of the rule: a duplicate and an edition. */
const hammerhead = [
  row({ classNameSlug: 'AEGS_Hammerhead', nameLocalized: 'Aegis Hammerhead' }),
  row({ classNameSlug: 'AEGS_Hammerhead_GS', nameLocalized: 'Aegis Hammerhead' }),
  row({
    classNameSlug: 'AEGS_Hammerhead_Showdown',
    nameLocalized: 'Aegis Hammerhead 2949 Best In Show Edition',
  }),
];

describe('normalizeEditionName', () => {
  it('collapses the stray spacing characters the extract leaves behind', () => {
    expect(normalizeEditionName('CHCO Auris� PDC  Monitor')).toBe('CHCO Auris PDC Monitor');
  });

  it('is empty for a missing or untranslated name', () => {
    expect(normalizeEditionName(null)).toBe('');
    expect(normalizeEditionName('   ')).toBe('');
    expect(normalizeEditionName('@vehicle_NameAEGS_Idris_P')).toBe('');
  });
});

describe('editionSuffixName', () => {
  it('reads the trailing phrase when it ends in an edition marker', () => {
    expect(editionSuffixName('Aegis Idris-P', 'Aegis Idris-P Wikelo War Special')).toBe(
      'Wikelo War Special',
    );
    expect(editionSuffixName('Aegis Hammerhead', 'Aegis Hammerhead 2949 Best In Show Edition')).toBe(
      '2949 Best In Show Edition',
    );
    expect(editionSuffixName('Aegis Reclaimer', "Aegis Reclaimer Teach's Special")).toBe(
      "Teach's Special",
    );
  });

  it('refuses a trailing phrase that names a different model', () => {
    expect(editionSuffixName('Drake Cutter', 'Drake Cutter Rambler')).toBeNull();
    expect(editionSuffixName('MISC Freelancer', 'MISC Freelancer MAX')).toBeNull();
    expect(editionSuffixName('Mirai Fury', 'Mirai Fury LX')).toBeNull();
    // "Expedition" merely CONTAINS "edition" — the marker is a whole word.
    expect(editionSuffixName('Anvil Carrack', 'Anvil Carrack Expedition')).toBeNull();
    // "Alliance" is not a marker, so the BTALA records stay standalone.
    expect(editionSuffixName('Drake Golem', 'Drake Golem Alliance')).toBeNull();
  });

  it('needs the base name to be a whole-word prefix', () => {
    expect(
      editionSuffixName('C.O. Mustang Alpha', 'C.O. Mustang CitizenCon 2948 Edition'),
    ).toBeNull();
    expect(editionSuffixName('', 'Anything Special')).toBeNull();
    expect(editionSuffixName('Aegis Idris-P', 'Aegis Idris-P')).toBeNull();
  });
});

describe('humanizeEditionSuffix', () => {
  it('reads the label off the part of the class name the base lacks', () => {
    expect(humanizeEditionSuffix('DRAK_Cutlass_Black', 'DRAK_Cutlass_Black_PU_Boarding')).toBe(
      'PU Boarding',
    );
    expect(humanizeEditionSuffix('DRAK_Corsair', 'DRAK_Corsair_Exec_StealthIndustrial')).toBe(
      'Exec Stealth Industrial',
    );
    // Digit/letter boundaries are left alone: BIS2950 is one token.
    expect(humanizeEditionSuffix('ANVL_Carrack', 'ANVL_Carrack_BIS2950')).toBe('BIS2950');
  });
});

describe('editionQueryPrefix', () => {
  it('keeps manufacturer + model, which every family root shares', () => {
    expect(editionQueryPrefix('AEGS_Idris_P_Collector_Military')).toBe('AEGS_Idris');
    expect(editionQueryPrefix('DRAK_Cutlass_Black')).toBe('DRAK_Cutlass');
    expect(editionQueryPrefix('ORIG_600i')).toBe('ORIG_600i');
    expect(editionQueryPrefix('SalvageableDebris')).toBe('SalvageableDebris');
  });
});

describe('groupEditionRows', () => {
  it('collapses the same-name records into the base entry', () => {
    const out = groupEditionRows(cutlass);
    expect(out.map((r) => r.classNameSlug)).toEqual([
      'DRAK_Cutlass_Black',
      // Its name is not "Drake Cutlass Black + phrase", so it stays a card.
      'DRAK_Cutlass_Black_ShipShowdown',
      'DRAK_Cutlass_Blue',
    ]);
    expect(out[0].editions.map((e) => e.editionName)).toEqual(['BIS2950', 'PU Boarding']);
    expect(out[1].editions).toEqual([]);
    expect(out[2].editions).toEqual([]);
  });

  it('collapses a duplicate and a marked edition into the same entry', () => {
    const out = groupEditionRows(hammerhead);
    expect(out.map((r) => r.classNameSlug)).toEqual(['AEGS_Hammerhead']);
    expect(out[0].editions).toEqual([
      { classNameSlug: 'AEGS_Hammerhead_Showdown', editionName: '2949 Best In Show Edition' },
      { classNameSlug: 'AEGS_Hammerhead_GS', editionName: 'GS' },
    ]);
  });

  it('leaves genuinely different models alone', () => {
    const rows = [
      row({ classNameSlug: 'MISC_Freelancer', nameLocalized: 'MISC Freelancer' }),
      row({ classNameSlug: 'MISC_Freelancer_DUR', nameLocalized: 'MISC Freelancer DUR' }),
      row({ classNameSlug: 'MISC_Freelancer_MAX', nameLocalized: 'MISC Freelancer MAX' }),
      row({ classNameSlug: 'ANVL_Hornet_F7C', nameLocalized: 'Anvil F7C Hornet Mk I' }),
      row({ classNameSlug: 'ANVL_Hornet_F7C_Mk2', nameLocalized: 'Anvil F7C Hornet Mk II' }),
      row({ classNameSlug: 'TMBL_Cyclone', nameLocalized: 'Tumbril Cyclone' }),
      row({ classNameSlug: 'TMBL_Cyclone_AA', nameLocalized: 'Tumbril Cyclone AA' }),
    ];
    const out = groupEditionRows(rows);
    expect(out.length).toBe(rows.length);
    expect(out.every((r) => r.editions.length === 0)).toBeTrue();
  });

  it('flattens a chain onto the family root, labelled from the root', () => {
    const rows = [
      row({ classNameSlug: 'ANVL_Lightning_F8C', nameLocalized: 'Anvil F8C Lightning' }),
      row({
        classNameSlug: 'ANVL_Lightning_F8C_Exec',
        nameLocalized: 'Anvil F8C Lightning Executive Edition',
      }),
      row({
        classNameSlug: 'ANVL_Lightning_F8C_Exec_Military',
        nameLocalized: 'Anvil F8C Lightning Executive Edition',
      }),
    ];
    const out = groupEditionRows(rows);
    expect(out.map((r) => r.classNameSlug)).toEqual(['ANVL_Lightning_F8C']);
    // Sorted by label, so "Exec Military" leads "Executive Edition".
    expect(out[0].editions).toEqual([
      { classNameSlug: 'ANVL_Lightning_F8C_Exec_Military', editionName: 'Exec Military' },
      { classNameSlug: 'ANVL_Lightning_F8C_Exec', editionName: 'Executive Edition' },
    ]);
  });

  it('stops the chain where the rule cannot prove a link', () => {
    // The Terrapin Medic is its own ship (no marker), but IT has an edition.
    const rows = [
      row({ classNameSlug: 'ANVL_Terrapin', nameLocalized: 'Anvil Terrapin' }),
      row({ classNameSlug: 'ANVL_Terrapin_Medic', nameLocalized: 'Anvil Terrapin Medic' }),
      row({
        classNameSlug: 'ANVL_Terrapin_Medic_Collector_Medic',
        nameLocalized: 'Anvil Terrapin Medic Wikelo Savior Special',
      }),
    ];
    const out = groupEditionRows(rows);
    expect(out.map((r) => r.classNameSlug)).toEqual(['ANVL_Terrapin', 'ANVL_Terrapin_Medic']);
    expect(out[0].editions).toEqual([]);
    expect(out[1].editions.map((e) => e.editionName)).toEqual(['Wikelo Savior Special']);
  });

  it('never groups rows without a usable name', () => {
    const rows = [
      row({ classNameSlug: 'CRUS_Intrepid', nameLocalized: 'Crusader Intrepid' }),
      // The record really does ship without a resolvable name in 4.9.0.
      row({ classNameSlug: 'CRUS_Intrepid_Collector_Indust', nameLocalized: null }),
      row({ classNameSlug: 'XX_Placeholder', nameLocalized: '@vehicle_NameXX_Placeholder' }),
      row({ classNameSlug: 'XX_Placeholder_Teach', nameLocalized: '@vehicle_NameXX_Placeholder' }),
    ];
    expect(groupEditionRows(rows).length).toBe(4);
  });

  it('preserves the incoming order and does not mutate the input', () => {
    const input = [...cutlass];
    const snapshot = JSON.stringify(input);
    groupEditionRows(input);
    expect(JSON.stringify(input)).toBe(snapshot);
  });
});

describe('resolveEditionGroup', () => {
  it('returns the family base-first, from either end', () => {
    const fromBase = resolveEditionGroup(cutlass, 'DRAK_Cutlass_Black');
    const fromEdition = resolveEditionGroup(cutlass, 'DRAK_Cutlass_Black_PU_Boarding');
    expect(fromBase).toEqual(fromEdition);
    expect(fromBase).toEqual([
      { classNameSlug: 'DRAK_Cutlass_Black', editionName: null },
      { classNameSlug: 'DRAK_Cutlass_Black_BIS2950', editionName: 'BIS2950' },
      { classNameSlug: 'DRAK_Cutlass_Black_PU_Boarding', editionName: 'PU Boarding' },
    ]);
  });

  it('is null for a ship with no siblings, which hides the picker', () => {
    expect(resolveEditionGroup(cutlass, 'DRAK_Cutlass_Blue')).toBeNull();
    expect(resolveEditionGroup(cutlass, 'DRAK_Cutlass_Black_ShipShowdown')).toBeNull();
    expect(resolveEditionGroup(cutlass, 'ORIG_600i')).toBeNull();
  });
});
