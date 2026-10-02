import { CodexListRow } from '../codex.service';
import { HangarRoleLoadout } from '../../hangar/hangar.types';
import { armorArsenalCounts, fittingSlots, foldFpsCards, isArmorRoleSlot } from './fps-set-fit';

function row(classNameSlug: string, name: string, attachType: string | null, subType: string | null = null): CodexListRow {
  return {
    classNameSlug,
    nameLocalized: name,
    manufacturerCode: 'RSI',
    size: 1,
    grade: null,
    role: null,
    crewSize: null,
    weaponClass: null,
    componentKind: null,
    subType,
    attachType,
    speed: null,
    isVariant: false,
    payload: {},
    blueprintCategory: null,
    blueprintTier: null,
    craftTimeSec: null,
  };
}

function set(role: HangarRoleLoadout['role']): HangarRoleLoadout {
  return { id: 's', name: 'S', role, items: [], createdAt: '', updatedAt: '' };
}

describe('fittingSlots', () => {
  it('gives armour its one anatomical home, whatever the role', () => {
    const helmet = { className: 'rsi_helmet_01', subType: 'Light', attachType: 'Char_Armor_Helmet' };
    expect(fittingSlots(set('fps'), helmet)).toEqual(['helmet']);
    expect(fittingSlots(set('mining'), helmet)).toEqual(['helmet']);
  });

  it('offers a weapon only the role positions it honestly fills', () => {
    const rifle = { className: 'behr_rifle_01', subType: 'Medium', attachType: null };
    expect(fittingSlots(set('fps'), rifle)).toEqual(['primary', 'secondary']);
    expect(fittingSlots(set('mining'), rifle)).toEqual([]);
    expect(fittingSlots(set('fps'), rifle, 'secondary')).toEqual(['secondary']);
  });

  it('tells armour positions from weapon positions', () => {
    expect(isArmorRoleSlot('helmet')).toBeTrue();
    expect(isArmorRoleSlot('primary')).toBeFalse();
    expect(isArmorRoleSlot(null)).toBeFalse();
  });
});

describe('armorArsenalCounts (L22)', () => {
  it('counts the folded cards the slot-filtered list shows, not the raw rows', () => {
    const rows = [
      row('rsi_helmet_01', 'Venture Helmet', 'Char_Armor_Helmet'),
      // A livery of the same helmet folds into its card in the list.
      row('rsi_helmet_01_red', 'Venture Helmet "Red"', 'Char_Armor_Helmet'),
      row('clda_helmet_02', 'Morningstar Helmet', 'Char_Armor_Helmet'),
      row('rsi_core_01', 'Venture Core', 'Char_Armor_Torso'),
    ];
    const listCards = foldFpsCards(rows.filter((r) => r.attachType === 'Char_Armor_Helmet'), false, 'en').length;
    const counts = armorArsenalCounts(rows, 'en');
    expect(counts.get('Char_Armor_Helmet')).toBe(listCards);
    expect(counts.get('Char_Armor_Helmet')).toBeLessThan(3);
    expect(counts.get('Char_Armor_Torso')).toBe(1);
  });
});
