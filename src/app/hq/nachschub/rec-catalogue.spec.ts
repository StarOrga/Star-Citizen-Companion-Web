import type { CodexListRow } from '../../codex/codex.service';
import { armorPartOf, armorSetKey, fpsRowsToRecItems } from './rec-catalogue';
import { recommend } from './recommend';

function row(over: Partial<CodexListRow>): CodexListRow {
  return {
    classNameSlug: 'x', nameLocalized: 'X', manufacturerCode: 'RRS', size: null, grade: null, role: null, crewSize: null,
    weaponClass: null, componentKind: null, subType: null, attachType: null, speed: null, isVariant: false, payload: {},
    blueprintCategory: null, blueprintTier: null, craftTimeSec: null, ...over,
  };
}

describe('rec-catalogue adapter', () => {
  it('derives the armor set from the class name up to the part token', () => {
    expect(armorSetKey('pembroke_armor_heavy_helmet_01_01_01')).toBe('pembroke_armor_heavy');
    expect(armorSetKey('pembroke_armor_heavy_core_01_01_01')).toBe('pembroke_armor_heavy');
    expect(armorSetKey('helmet_01')).toBeNull();
    expect(armorSetKey('something_else')).toBeNull();
  });

  it('maps attach types to parts', () => {
    expect(armorPartOf('Char_Armor_Helmet')).toBe('helmet');
    expect(armorPartOf('Char_Armor_Torso')).toBe('torso');
    expect(armorPartOf('Char_Armor_Undersuit')).toBe('undersuit');
    expect(armorPartOf('Char_Weapon')).toBeNull();
    expect(armorPartOf(null)).toBeNull();
  });

  it('a wished helmet suggests the other parts of its own set first', () => {
    const items = fpsRowsToRecItems(
      [
        row({ classNameSlug: 'pembroke_armor_heavy_helmet_01_01_01', nameLocalized: 'Pembroke Helmet', attachType: 'Char_Armor_Helmet' }),
        row({ classNameSlug: 'pembroke_armor_heavy_core_01_01_01', nameLocalized: 'Pembroke Core', attachType: 'Char_Armor_Torso' }),
        row({ classNameSlug: 'other_armor_light_core_01_01_01', nameLocalized: 'Other Core', attachType: 'Char_Armor_Torso', manufacturerCode: 'ZZZ' }),
      ],
      'armor',
    );
    const rec = recommend({
      anchors: [{ className: 'pembroke_armor_heavy_helmet_01_01_01', addedAt: '2026-11-07T10:00:00Z' }],
      catalogue: new Map(items.map((i) => [i.className, i])),
      owned: new Set(),
      wished: new Set(['pembroke_armor_heavy_helmet_01_01_01']),
    });
    expect(rec[0]?.className).toBe('pembroke_armor_heavy_core_01_01_01');
    expect(rec[0]?.reason).toBe('sameSet');
  });
});
