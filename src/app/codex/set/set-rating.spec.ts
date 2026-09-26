import { setNumberLocale } from '../codex-format';
import {
  ArmorRatingRow,
  SET_LENSES,
  armorSlotFromAttachType,
  lensValueFor,
  rankSet,
  setLensStorageKey,
} from './set-rating';

function row(partial: Partial<ArmorRatingRow> & { slot: ArmorRatingRow['slot']; className: string }): ArmorRatingRow {
  const { values, pct, ...rest } = partial;
  return {
    itemType: null,
    ...rest,
    values: {
      damageReduction: null,
      tempMin: null,
      tempMax: null,
      radCapacity: null,
      radRate: null,
      gForce: null,
      mass: null,
      carryMicroScu: null,
      ...values,
    },
    pct: {
      protection: null,
      mobility: null,
      gForce: null,
      heat: null,
      cold: null,
      radiation: null,
      scrub: null,
      carry: null,
      ...pct,
    },
  } as ArmorRatingRow;
}

describe('armorSlotFromAttachType', () => {
  it('maps every known Char_Armor_* attach type', () => {
    expect(armorSlotFromAttachType('Char_Armor_Helmet')).toBe('helmet');
    expect(armorSlotFromAttachType('Char_Armor_Torso')).toBe('core');
    expect(armorSlotFromAttachType('Char_Armor_Arms')).toBe('arms');
    expect(armorSlotFromAttachType('Char_Armor_Legs')).toBe('legs');
    expect(armorSlotFromAttachType('Char_Armor_Undersuit')).toBe('undersuit');
    expect(armorSlotFromAttachType('Char_Armor_Backpack')).toBe('backpack');
  });

  it('returns null for anything else', () => {
    expect(armorSlotFromAttachType('Char_Weapon_Rifle')).toBeNull();
    expect(armorSlotFromAttachType(null)).toBeNull();
    expect(armorSlotFromAttachType(undefined)).toBeNull();
  });
});

describe('rankSet — cig profile', () => {
  beforeEach(() => setNumberLocale('de'));
  // The number locale is module state — hand it back, or every later spec formats in German.
  afterEach(() => setNumberLocale('en'));

  const helmet = row({
    className: 'Armor_Morozov_Helmet',
    slot: 'helmet',
    itemType: 'Heavy Helmet',
    values: { damageReduction: 40, gForce: 0.9 } as ArmorRatingRow['values'],
    pct: { protection: 80, mobility: 60, gForce: 70 } as ArmorRatingRow['pct'],
  });
  const core = row({
    className: 'Armor_Morozov_Core',
    slot: 'core',
    itemType: 'Heavy Armor',
    values: { damageReduction: 40, gForce: -0.5 } as ArmorRatingRow['values'],
    pct: { protection: 80, mobility: 40, gForce: 30 } as ArmorRatingRow['pct'],
  });
  const legs = row({
    className: 'Armor_Morozov_Legs',
    slot: 'legs',
    itemType: 'Heavy Legs',
    values: { damageReduction: 35, gForce: -0.25 } as ArmorRatingRow['values'],
    pct: { protection: 60, mobility: 50, gForce: 50 } as ArmorRatingRow['pct'],
  });
  const rows = [helmet, core, legs];

  it('averages percentiles per axis and reads the highest damage reduction', () => {
    const result = rankSet(rows, 'cig', 'de');
    const protection = result.axes.find((a) => a.key === 'protection')!;
    // rankSet rounds a percentile to one decimal, like the RPC does.
    expect(protection.percentile).toBeCloseTo((80 + 80 + 60) / 3, 1);
    expect(protection.value).toBe('40 %');
    expect(protection.gap).toBeFalse();
  });

  it('reads the core weight class word for mobility', () => {
    const mobility = result().axes.find((a) => a.key === 'mobility')!;
    expect(mobility.value).toBe('Heavy');
  });

  it('sums the g-force modifiers as a signed percent', () => {
    const gForce = result().axes.find((a) => a.key === 'gForce')!;
    // 0.9 - 0.5 - 0.25 = 0.15 -> +15 %
    expect(gForce.value).toBe('+15 %');
  });

  it('always reports stealth, activeScan and eva as gaps', () => {
    const r = result();
    for (const key of ['stealth', 'activeScan', 'eva']) {
      const axis = r.axes.find((a) => a.key === key)!;
      expect(axis.gap).toBeTrue();
      expect(axis.gapReasonKey).toBe('codex.setRank.gap.noData');
      expect(axis.percentile).toBeNull();
    }
  });

  it('computes overall as the rounded mean of non-gap percentiles and a band', () => {
    const r = result();
    expect(r.overall).not.toBeNull();
    expect(r.bandKey).toMatch(/^codex\.rank\.band\.(low|mid|high)$/);
    expect(r.cohortKey).toBe('codex.setRank.cohort');
  });

  function result() {
    return rankSet(rows, 'cig', 'de');
  }
});

describe('rankSet — env profile weakest link', () => {
  beforeEach(() => setNumberLocale('de'));
  // The number locale is module state — hand it back, or every later spec formats in German.
  afterEach(() => setNumberLocale('en'));

  it('flags the part with the lowest temp_max as limiting heat when the spread is wide', () => {
    const core = row({
      className: 'Armor_TCS_Core',
      slot: 'core',
      values: { tempMax: 115 } as ArmorRatingRow['values'],
      pct: { heat: 70 } as ArmorRatingRow['pct'],
    });
    const undersuit = row({
      className: 'Armor_TCS_Undersuit',
      slot: 'undersuit',
      values: { tempMax: 60 } as ArmorRatingRow['values'],
      pct: { heat: 20 } as ArmorRatingRow['pct'],
    });
    const result = rankSet([core, undersuit], 'env', 'de');
    const heat = result.axes.find((a) => a.key === 'heat')!;
    expect(heat.value).toBe('60 °C');
    expect(heat.percentile).toBe(20);
    expect(heat.weak).toBeTrue();
    expect(heat.limitedBy).toBe('Armor_TCS_Undersuit');
    expect(result.noteKey).toBe('codex.setRank.note.limited');
    expect(result.noteParams['item']).toBe('Armor_TCS_Undersuit');
  });

  it('does not flag a limiting part when the spread is small', () => {
    const core = row({
      className: 'Armor_A_Core',
      slot: 'core',
      values: { tempMax: 90 } as ArmorRatingRow['values'],
      pct: { heat: 60 } as ArmorRatingRow['pct'],
    });
    const undersuit = row({
      className: 'Armor_A_Undersuit',
      slot: 'undersuit',
      values: { tempMax: 85 } as ArmorRatingRow['values'],
      pct: { heat: 55 } as ArmorRatingRow['pct'],
    });
    const result = rankSet([core, undersuit], 'env', 'de');
    const heat = result.axes.find((a) => a.key === 'heat')!;
    expect(heat.weak).toBeFalse();
    expect(heat.limitedBy).toBeNull();
  });

  it('flags the part with the highest temp_min as limiting cold', () => {
    const core = row({
      className: 'Armor_TCS_Core',
      slot: 'core',
      values: { tempMin: -90 } as ArmorRatingRow['values'],
      pct: { cold: 80 } as ArmorRatingRow['pct'],
    });
    const undersuit = row({
      className: 'Armor_TCS_Undersuit',
      slot: 'undersuit',
      values: { tempMin: -30 } as ArmorRatingRow['values'],
      pct: { cold: 10 } as ArmorRatingRow['pct'],
    });
    const result = rankSet([core, undersuit], 'env', 'de');
    const cold = result.axes.find((a) => a.key === 'cold')!;
    expect(cold.value).toBe('-30 °C');
    expect(cold.limitedBy).toBe('Armor_TCS_Undersuit');
  });

  it('sums radiation capacity and formats it with grouping', () => {
    const core = row({
      className: 'Armor_TCS_Core',
      slot: 'core',
      values: { radCapacity: 20000 } as ArmorRatingRow['values'],
      pct: { radiation: 50 } as ArmorRatingRow['pct'],
    });
    const legs = row({
      className: 'Armor_TCS_Legs',
      slot: 'legs',
      values: { radCapacity: 6800 } as ArmorRatingRow['values'],
      pct: { radiation: 40 } as ArmorRatingRow['pct'],
    });
    const result = rankSet([core, legs], 'env', 'de');
    const radiation = result.axes.find((a) => a.key === 'radiation')!;
    expect(radiation.value).toBe('26.800 REM');
  });

  it('is a full gap when nobody in the set carries the axis', () => {
    const helmet = row({ className: 'Armor_X_Helmet', slot: 'helmet' });
    const result = rankSet([helmet], 'env', 'de');
    const carry = result.axes.find((a) => a.key === 'carry')!;
    expect(carry.gap).toBeTrue();
    expect(carry.value).toBeNull();
  });
});

describe('lensValueFor', () => {
  beforeEach(() => setNumberLocale('de'));
  // The number locale is module state — hand it back, or every later spec formats in German.
  afterEach(() => setNumberLocale('en'));

  const part = row({
    className: 'Armor_X_Core',
    slot: 'core',
    itemType: 'Heavy Armor',
    values: { damageReduction: 40, gForce: -0.5, carryMicroScu: 12000, tempMin: -90, tempMax: 115, radCapacity: 26800 } as ArmorRatingRow['values'],
  });

  it('combat: damage reduction and item type', () => {
    expect(lensValueFor(part, 'combat', [part], 'de')).toEqual({ text: '40 % · Heavy Armor', warn: false });
  });

  it('pilot: signed g-force modifier', () => {
    expect(lensValueFor(part, 'pilot', [part], 'de')).toEqual({ text: '-50 %', warn: false });
  });

  it('env: temperature range and radiation', () => {
    const result = lensValueFor(part, 'env', [part], 'de');
    expect(result?.text).toBe('-90 / 115 °C · 26.800 REM');
  });

  it('transport: carry capacity', () => {
    expect(lensValueFor(part, 'transport', [part], 'de')).toEqual({ text: '12K µSCU', warn: false });
  });

  it('returns null for a missing part or an all/disabled lens', () => {
    expect(lensValueFor(undefined, 'combat', [], 'de')).toBeNull();
    expect(lensValueFor(part, 'all', [part], 'de')).toBeNull();
    expect(lensValueFor(part, 'stealth', [part], 'de')).toBeNull();
  });
});

describe('SET_LENSES', () => {
  it('disables exactly stealth, eva and scan, each with a reason', () => {
    const disabled = SET_LENSES.filter((l) => l.disabled).map((l) => l.id);
    expect(disabled).toEqual(['stealth', 'eva', 'scan']);
    for (const lens of SET_LENSES) {
      expect(lens.disabled ? lens.disabledReasonKey !== null : lens.disabledReasonKey === null).toBeTrue();
    }
  });

  it('keeps the authored order', () => {
    expect(SET_LENSES.map((l) => l.id)).toEqual(['all', 'combat', 'stealth', 'pilot', 'env', 'transport', 'eva', 'scan']);
  });
});

describe('setLensStorageKey', () => {
  it('is stable and scoped per set id', () => {
    expect(setLensStorageKey('abc')).toBe('sc.codex.setLens.abc');
    expect(setLensStorageKey('abc')).not.toBe(setLensStorageKey('def'));
  });
});
