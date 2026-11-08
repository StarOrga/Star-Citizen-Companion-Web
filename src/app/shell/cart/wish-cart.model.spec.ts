import type { WishPosition } from '../../hq/nachschub/nachschub.model';
import { bestandContextOf, cartGroups, itemGroupOf, lastAdded } from './wish-cart.model';

const w = (kind: string, className: string, over: Partial<WishPosition> = {}): WishPosition => ({ kind, className, name: null, qty: 1, ...over });

describe('wish-cart model', () => {
  describe('cartGroups', () => {
    it('puts Waffen first and the craft groups (Blaupausen) last', () => {
      const groups = cartGroups([
        w('blueprint', 'bp_gallant', { name: 'Gallant', qty: 2 }),
        w('material', 'alu', { qty: 20, forClassName: 'bp_gallant' }),
        w('ship', 'DRAK_Cutlass'),
        w('item', 'rsi_pembroke_helmet_01_01_01'),
        w('item', 'klwe_rifle_energy_01'),
        w('item', 'medpen_01'),
        w('component', 'shield_01'),
      ]);
      expect(groups.map((g) => g.type)).toEqual(['weapons', 'armor', 'components', 'ships', 'items', 'blueprint']);
      expect(groups.at(-1)!.rows.map((r) => r.className)).toEqual(['bp_gallant', 'alu']);
    });

    it('keeps one craft group per blueprint, even when the blueprint itself is not wished', () => {
      const groups = cartGroups([w('material', 'alu', { forClassName: 'bp_a' }), w('material', 'alu', { forClassName: 'bp_b' })]);
      expect(groups.map((g) => g.id)).toEqual(['bp:bp_a', 'bp:bp_b']);
    });

    it('announced ships join the ships group', () => {
      const groups = cartGroups([w('ship', 'DRAK_Cutlass'), w('upcoming', 'ironclad', { name: 'Ironclad' })]);
      expect(groups.length).toBe(1);
      expect(groups[0].type).toBe('ships');
      expect(groups[0].rows.length).toBe(2);
    });

    it('an empty wishlist has no groups', () => {
      expect(cartGroups([])).toEqual([]);
    });
  });

  it('sorts plain items by the kind, then by the class-name tokens the stock uses', () => {
    expect(itemGroupOf({ kind: 'weapon', className: 'anything' })).toBe('weapons');
    expect(itemGroupOf({ kind: 'item', className: 'klwe_rifle_energy_01' })).toBe('weapons');
    expect(itemGroupOf({ kind: 'item', className: 'rsi_pembroke_helmet_01_01_01' })).toBe('armor');
    expect(itemGroupOf({ kind: 'component', className: 'x' })).toBe('components');
    expect(itemGroupOf({ kind: 'item', className: 'medpen_01' })).toBe('items');
  });

  it('lastAdded takes the newest n, ties keep the given order, undated rows count as oldest', () => {
    const rows = [
      { id: 'a', createdAt: '2026-11-01T00:00:00Z' },
      { id: 'b', createdAt: '2026-11-03T00:00:00Z' },
      { id: 'c', createdAt: '' },
      { id: 'd', createdAt: '2026-11-03T00:00:00Z' },
    ];
    expect(lastAdded(rows, 3).map((r) => r.id)).toEqual(['b', 'd', 'a']);
    expect(lastAdded(rows, 0)).toEqual([]);
  });

  it('maps the page type to its Bestand section, strictly', () => {
    expect(bestandContextOf('ship')).toEqual({ id: 'hangar', tab: 'hangar', cat: null });
    expect(bestandContextOf('weapon')).toEqual({ id: 'inventar', tab: 'inventar', cat: 'weapons' });
    expect(bestandContextOf('item')?.cat).toBe('armor');
    expect(bestandContextOf('component')?.cat).toBe('other');
    expect(bestandContextOf('blueprint')?.id).toBe('sammlung');
    expect(bestandContextOf('news')?.id).toBe('sammlung');
    expect(bestandContextOf(null)).toBeNull();
  });
});
