import { FPS_ARMOR_ATTACH_TYPES, usableFirst } from './codex.service';
import {
  ITEM_GROUPS,
  NON_USABLE_GROUP,
  PLAYER_ITEM_ATTACH_TYPES,
  SHIP_ITEM_GROUPS,
  TAXONOMY_ARMOR_ATTACH_TYPES,
  USABLE_ITEM_ATTACH_TYPES,
  ammoGroupOf,
  ammoGroupQuery,
  isUsableAttachType,
  itemGroupQuery,
} from './codex-area-taxonomy';
import { PolySearchHit } from './codex-poly-search';

describe('codex area taxonomy (package C)', () => {
  it('keeps its armour list equal to the service one', () => {
    expect([...TAXONOMY_ARMOR_ATTACH_TYPES]).toEqual([...FPS_ARMOR_ATTACH_TYPES]);
  });

  it('names every attach type in at most one group', () => {
    const all = [...ITEM_GROUPS, ...SHIP_ITEM_GROUPS].flatMap((g) => g.attachTypes);
    expect(new Set(all).size).toBe(all.length);
  });

  it('treats game objects as not usable and player items as usable', () => {
    for (const t of ['Door', 'Seat', 'Display', 'ControlPanel', 'NOITEM_Player', 'Char_Head_Hair', 'Armor', '', null]) {
      expect(isUsableAttachType(t)).withContext(String(t)).toBeFalse();
    }
    for (const t of ['Food', 'Drink', 'Char_Clothing_Hat', 'WeaponAttachment', 'Missile', 'Char_Armor_Helmet']) {
      expect(isUsableAttachType(t)).withContext(t).toBeTrue();
    }
  });

  it('scopes the item list per group', () => {
    expect(itemGroupQuery('food')).toEqual({ attachTypeIn: ['Food', 'Drink', 'Bottle'] });
    expect(itemGroupQuery('')).toEqual({ attachTypeIn: [...PLAYER_ITEM_ATTACH_TYPES] });
    expect(itemGroupQuery('unknown')).toEqual({ attachTypeIn: [...PLAYER_ITEM_ATTACH_TYPES] });
    expect(itemGroupQuery(NON_USABLE_GROUP)).toEqual({ attachTypeNotIn: [...USABLE_ITEM_ATTACH_TYPES] });
    expect(PLAYER_ITEM_ATTACH_TYPES).not.toContain('Missile');
    expect(PLAYER_ITEM_ATTACH_TYPES).not.toContain('Char_Armor_Helmet');
  });

  it('splits ammunition into on-foot and vehicle rounds by class name', () => {
    expect(ammoGroupOf('BEHR_LaserCannon_S2_AMMO')).toBe('vehicle');
    expect(ammoGroupOf('APAR_BallisticScatterGun_S1_Shark_AMMO')).toBe('vehicle');
    expect(ammoGroupOf('behr_rifle_ballistic_02_ammo_civilian')).toBe('fps');
    expect(ammoGroupOf('12g_ballistic_1')).toBe('fps');
    expect(ammoGroupQuery('vehicle')).toEqual({ classNameMatch: '_S[0-9]+_' });
    expect(ammoGroupQuery('fps')).toEqual({ classNameNotMatch: '_S[0-9]+_' });
    expect(ammoGroupQuery('')).toEqual({});
  });

  it('ranks non-usable items after every usable hit, keeping the order inside', () => {
    const hit = (kind: PolySearchHit['kind'], name: string, attachType: string | null = null) =>
      ({ kind, classNameSlug: name, nameLocalized: name, attachType }) as PolySearchHit;
    const ranked = [hit('item', 'Door A', 'Door'), hit('ship', 'Gladius'), hit('item', 'Lemon', 'Food'), hit('item', 'Seat', 'Seat')];
    expect(usableFirst(ranked).map((h) => h.classNameSlug)).toEqual(['Gladius', 'Lemon', 'Door A', 'Seat']);
  });
});
