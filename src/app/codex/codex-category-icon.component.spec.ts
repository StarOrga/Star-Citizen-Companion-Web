import { armorPartGlyph, categoryColor, categoryIconKey } from './codex-category-icon.component';

describe('codex-category-icon', () => {
  describe('categoryIconKey', () => {
    it('maps top-level kinds to their own glyph', () => {
      expect(categoryIconKey('ship')).toBe('ship');
      expect(categoryIconKey('weapon')).toBe('weapon');
      expect(categoryIconKey('item')).toBe('item');
      expect(categoryIconKey('ammunition')).toBe('ammunition');
      expect(categoryIconKey('manufacturer')).toBe('manufacturer');
    });

    it('refines component icons by componentKind sub', () => {
      expect(categoryIconKey('component', 'Shield')).toBe('shield');
      expect(categoryIconKey('component', 'PowerPlant')).toBe('power');
      expect(categoryIconKey('component', 'QuantumDrive')).toBe('quantum');
      expect(categoryIconKey('component', 'FuelTank')).toBe('fuel');
      expect(categoryIconKey('component', 'CargoGrid')).toBe('cargo');
    });

    it('falls back to the generic component glyph for unknown sub', () => {
      expect(categoryIconKey('component', 'Whatever')).toBe('component');
      expect(categoryIconKey('component')).toBe('component');
    });

    // Admin feedback 8cd0aed7: the APX Fire Extinguisher (a codex_weapons row
    // with sub_type 'Gadget') wore the crosshair glyph.
    it('refines weapon icons by sub_type so non-weapons lose the crosshair', () => {
      expect(categoryIconKey('weapon', 'Gadget')).toBe('gadget');
      expect(categoryIconKey('weapon', 'Utility')).toBe('gadget');
      expect(categoryIconKey('weapon', 'Knife')).toBe('blade');
      expect(categoryIconKey('weapon', 'Melee')).toBe('blade');
      expect(categoryIconKey('weapon', 'Grenade')).toBe('grenade');
    });

    it('never puts the crosshair on a non-shooting weapon-table sub_type', () => {
      for (const sub of ['Gadget', 'Utility', 'Knife', 'Melee', 'Grenade']) {
        expect(categoryIconKey('weapon', sub)).not.toBe('weapon');
      }
    });

    it('keeps the crosshair for sub_types that really are guns', () => {
      for (const sub of ['Small', 'Medium', 'Large', 'Gun', 'GunTurret', 'MissileRack', 'FPS', 'Ship', 'UNDEFINED']) {
        expect(categoryIconKey('weapon', sub)).toBe('weapon');
      }
      expect(categoryIconKey('weapon')).toBe('weapon');
    });

    it('falls back to generic for unknown/empty kinds (UC-01: never a hole)', () => {
      expect(categoryIconKey('blueprint')).toBe('generic');
      expect(categoryIconKey('' as never)).toBe('generic');
    });

    // UC-armour-parity: item rows with a Char_Armor_* attach_type get the
    // matching part glyph instead of the generic item box, wherever the
    // caller resolves the icon (list card, detail hero, set page figure).
    it('refines item icons by armour attach_type', () => {
      expect(categoryIconKey('item', null, 'Char_Armor_Helmet')).toBe('helmet');
      expect(categoryIconKey('item', null, 'Char_Armor_Torso')).toBe('armorCore');
      expect(categoryIconKey('item', null, 'Char_Armor_Arms')).toBe('armorArms');
      expect(categoryIconKey('item', null, 'Char_Armor_Legs')).toBe('armorLegs');
      expect(categoryIconKey('item', null, 'Char_Armor_Undersuit')).toBe('undersuit');
      expect(categoryIconKey('item', null, 'Char_Armor_Backpack')).toBe('backpack');
    });

    it('also accepts the attach_type via the sub argument (callers with no separate attachType param)', () => {
      expect(categoryIconKey('item', 'Char_Armor_Helmet')).toBe('helmet');
    });

    it('keeps the generic item glyph for non-armour items and unknown attach_types', () => {
      expect(categoryIconKey('item')).toBe('item');
      expect(categoryIconKey('item', 'Consumable')).toBe('item');
      expect(categoryIconKey('item', null, 'Armor')).toBe('item'); // ship hull armor, not personal armour
    });
  });

  describe('armorPartGlyph', () => {
    it('maps every personal-armour attach_type to its part glyph', () => {
      expect(armorPartGlyph('Char_Armor_Helmet')).toBe('helmet');
      expect(armorPartGlyph('Char_Armor_Torso')).toBe('armorCore');
      expect(armorPartGlyph('Char_Armor_Arms')).toBe('armorArms');
      expect(armorPartGlyph('Char_Armor_Legs')).toBe('armorLegs');
      expect(armorPartGlyph('Char_Armor_Undersuit')).toBe('undersuit');
      expect(armorPartGlyph('Char_Armor_Backpack')).toBe('backpack');
    });

    it('returns null for anything that is not a personal-armour attach_type', () => {
      expect(armorPartGlyph(null)).toBeNull();
      expect(armorPartGlyph(undefined)).toBeNull();
      expect(armorPartGlyph('')).toBeNull();
      expect(armorPartGlyph('Armor')).toBeNull();
      expect(armorPartGlyph('Consumable')).toBeNull();
    });
  });

  describe('categoryColor', () => {
    it('returns a non-empty colour for every kind', () => {
      for (const k of ['ship', 'weapon', 'component', 'item', 'ammunition', 'manufacturer', 'blueprint'] as const) {
        expect(categoryColor(k)).toBeTruthy();
      }
    });

    it('uses the component sub colour when refined', () => {
      expect(categoryColor('component', 'PowerPlant')).toBe('#f0c419');
      expect(categoryColor('component', 'QuantumDrive')).toBe('#a674ff');
    });

    it('gives the refined weapon sub_types their own colour', () => {
      for (const sub of ['Gadget', 'Knife', 'Grenade']) {
        expect(categoryColor('weapon', sub)).toBeTruthy();
        expect(categoryColor('weapon', sub)).not.toBe(categoryColor('weapon', 'Medium'));
      }
    });

    it('keeps the item accent colour for armour part glyphs', () => {
      expect(categoryColor('item', null, 'Char_Armor_Helmet')).toBe(categoryColor('item'));
    });
  });
});
