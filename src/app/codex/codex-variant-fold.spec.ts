import type { CodexListRow } from './codex.service';
import { foldVariantRows, variantFoldKey } from './codex-variant-fold';

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

// The exact pair from admin feedback 8cd0aed7.
const extinguisher = [
  row({
    classNameSlug: 'kegr_fire_extinguisher_01',
    nameLocalized: 'APX Fire Extinguisher',
    subType: 'Gadget',
    weaponClass: 'FPS',
    size: 5,
    grade: 'A',
  }),
  row({
    classNameSlug: 'kegr_fire_extinguisher_01_Igniter',
    nameLocalized: 'APX Fire Extinguisher',
    subType: 'Gadget',
    weaponClass: 'FPS',
    size: 5,
    grade: 'A',
  }),
];

describe('codex-variant-fold', () => {
  describe('variantFoldKey', () => {
    it('gives the two APX Fire Extinguisher records the same key', () => {
      expect(variantFoldKey(extinguisher[0])).toBe(variantFoldKey(extinguisher[1]));
    });

    it('ignores case and whitespace noise in the display name', () => {
      const a = row({ classNameSlug: 'a', nameLocalized: 'APX  Fire Extinguisher' });
      const b = row({ classNameSlug: 'b', nameLocalized: 'apx fire extinguisher ' });
      expect(variantFoldKey(a)).toBe(variantFoldKey(b));
    });

    it('separates rows that differ in any rendered facet', () => {
      const base = row({ classNameSlug: 'x', nameLocalized: 'Gallant Rifle', size: 2 });
      expect(variantFoldKey(base)).not.toBe(
        variantFoldKey({ ...base, classNameSlug: 'y', size: 3 }),
      );
      expect(variantFoldKey(base)).not.toBe(
        variantFoldKey({ ...base, classNameSlug: 'y', grade: 'B' }),
      );
      expect(variantFoldKey(base)).not.toBe(
        variantFoldKey({ ...base, classNameSlug: 'y', manufacturerCode: 'KLWE' }),
      );
      expect(variantFoldKey(base)).not.toBe(
        variantFoldKey({ ...base, classNameSlug: 'y', subType: 'Gadget' }),
      );
    });

    it('never folds a row without a usable display name', () => {
      expect(variantFoldKey(row({ classNameSlug: 'Gadget_Cabinet_x_low' }))).toBeNull();
      expect(variantFoldKey(row({ classNameSlug: 'x', nameLocalized: '@LOC_PLACEHOLDER' }))).toBeNull();
      expect(variantFoldKey(row({ classNameSlug: 'x', nameLocalized: '   ' }))).toBeNull();
    });

    it('does not confuse two facet fields for one another', () => {
      const a = row({ classNameSlug: 'a', nameLocalized: 'N', subType: 'x', attachType: 'y' });
      const b = row({ classNameSlug: 'b', nameLocalized: 'N', subType: 'y', attachType: 'x' });
      expect(variantFoldKey(a)).not.toBe(variantFoldKey(b));
    });
  });

  describe('foldVariantRows', () => {
    it('collapses the APX Fire Extinguisher pair onto the base class name', () => {
      const out = foldVariantRows(extinguisher);
      expect(out.length).toBe(1);
      expect(out[0].classNameSlug).toBe('kegr_fire_extinguisher_01');
      expect(out[0].foldedClassNames).toEqual(['kegr_fire_extinguisher_01_Igniter']);
    });

    it('picks the same survivor regardless of the order rows arrive in', () => {
      const forward = foldVariantRows(extinguisher);
      const reverse = foldVariantRows([...extinguisher].reverse());
      expect(reverse[0].classNameSlug).toBe(forward[0].classNameSlug);
      expect(reverse[0].foldedClassNames).toEqual(forward[0].foldedClassNames);
    });

    it('collapses a whole family onto its base record (Pyro RYT Multi-Tool)', () => {
      const rows = [
        'grin_multitool_01',
        'grin_multitool_01_default_cutter',
        'grin_multitool_01_default_mining',
        'grin_multitool_01_default_salvage_repair',
      ].map((c) =>
        row({ classNameSlug: c, nameLocalized: 'Pyro RYT Multi-Tool', manufacturerCode: 'GRIN', subType: 'Gadget', size: 1, grade: 'A' }),
      );
      const out = foldVariantRows(rows);
      expect(out.length).toBe(1);
      expect(out[0].classNameSlug).toBe('grin_multitool_01');
      expect(out[0].foldedClassNames.length).toBe(3);
      // Sorted, so the tooltip text is stable across renders.
      expect([...out[0].foldedClassNames]).toEqual([...out[0].foldedClassNames].sort());
    });

    it('prefers a buyable record over one flagged as a variant', () => {
      const out = foldVariantRows([
        row({ classNameSlug: 'aa', nameLocalized: 'Karna Rifle', isVariant: true }),
        row({ classNameSlug: 'karna_rifle_long_name', nameLocalized: 'Karna Rifle' }),
      ]);
      expect(out.length).toBe(1);
      expect(out[0].classNameSlug).toBe('karna_rifle_long_name');
    });

    it('keeps rows that only look similar but render differently', () => {
      const out = foldVariantRows([
        row({ classNameSlug: 'a', nameLocalized: 'Omnisky', size: 1 }),
        row({ classNameSlug: 'b', nameLocalized: 'Omnisky', size: 2 }),
      ]);
      expect(out.length).toBe(2);
      expect(out.every((r) => r.foldedClassNames.length === 0)).toBeTrue();
    });

    it('keeps nameless rows apart and in place', () => {
      const rows = [
        row({ classNameSlug: 'Gadget_Cabinet_a_low' }),
        row({ classNameSlug: 'Gadget_Cabinet_a_med' }),
        row({ classNameSlug: 'Gadget_Cabinet_a_high' }),
      ];
      const out = foldVariantRows(rows);
      expect(out.map((r) => r.classNameSlug)).toEqual(rows.map((r) => r.classNameSlug));
    });

    it('preserves the incoming order of the surviving rows', () => {
      const out = foldVariantRows([
        row({ classNameSlug: 'aaa', nameLocalized: 'Alpha' }),
        ...extinguisher,
        row({ classNameSlug: 'zzz', nameLocalized: 'Zulu' }),
      ]);
      expect(out.map((r) => r.classNameSlug)).toEqual([
        'aaa',
        'kegr_fire_extinguisher_01',
        'zzz',
      ]);
    });

    it('folds across a paging boundary once both pages are accumulated', () => {
      // The server sorts by name then class_name, so duplicates are adjacent —
      // but a page break can still split a group. Folding runs over the whole
      // accumulated list, so the second page still collapses into the first.
      const page1 = [extinguisher[0]];
      const page2 = [extinguisher[1]];
      expect(foldVariantRows([...page1, ...page2]).length).toBe(1);
    });

    it('honours a custom display-name resolver', () => {
      const rows = [
        row({ classNameSlug: 'a', payload: { name: 'Same' } }),
        row({ classNameSlug: 'b', payload: { name: 'Same' } }),
      ];
      const name = (r: CodexListRow) => (r.payload as { name: string }).name;
      expect(foldVariantRows(rows).length).toBe(2);
      expect(foldVariantRows(rows, name).length).toBe(1);
    });

    it('does not mutate the input rows', () => {
      const input = extinguisher.map((r) => ({ ...r }));
      const snapshot = JSON.stringify(input);
      foldVariantRows(input);
      expect(JSON.stringify(input)).toBe(snapshot);
    });

    it('leaves an already-unique list untouched', () => {
      const rows = [
        row({ classNameSlug: 'a', nameLocalized: 'One' }),
        row({ classNameSlug: 'b', nameLocalized: 'Two' }),
      ];
      const out = foldVariantRows(rows);
      expect(out.length).toBe(2);
      expect(out.every((r) => r.foldedClassNames.length === 0)).toBeTrue();
    });
  });
});
