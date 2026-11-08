import type { CodexListRow } from '../../codex/codex.service';
import { armorPartOf, armorSetKey, componentRowsToRecItems, fpsRowsToRecItems, itemRowsToRecItems } from './rec-catalogue';
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
    // a maker-only prefix is no set: it would merge unrelated families (the raw cds key the cart once showed)
    expect(armorSetKey('cds_core_01_01')).toBeNull();
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

  it('adapts components (core kinds with a size), missiles (signal from the class name) and consumables (sub type)', () => {
    const comps = componentRowsToRecItems([
      row({ classNameSlug: 'shld_s2', componentKind: 'Shield', size: 2 }),
      row({ classNameSlug: 'radar_s2', componentKind: 'Radar', size: 2 }),
      row({ classNameSlug: 'cool_nosize', componentKind: 'Cooler', size: null }),
    ]);
    expect(comps.map((c) => c.className)).toEqual(['shld_s2']);
    const msl = itemRowsToRecItems(
      [
        row({ classNameSlug: 'MISL_S02_IR_NOVP_Rattler', size: 2, subType: 'Missile' }),
        row({ classNameSlug: 'MISL_S02_NOVP_Plain', size: 2, subType: 'Missile' }),
      ],
      'missile',
    );
    expect(msl.map((m) => [m.className, m.facet])).toEqual([['MISL_S02_IR_NOVP_Rattler', 'ir']]);
    const pens = itemRowsToRecItems([row({ classNameSlug: 'pen', subType: 'Medical' }), row({ classNameSlug: 'nosub' })], 'consumable');
    expect(pens.map((p) => p.facet)).toEqual(['Medical']);
  });
});
