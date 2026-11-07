import type { WishPosition } from '../nachschub/nachschub.model';
import { groupWish, pickedPieces, pickedShare, setPicked, toggleGroup } from './hq-nachschub-flow.util';

const w = (kind: string, className: string, qty: number, forClassName: string | null = null, name: string | null = null): WishPosition => ({
  kind,
  className,
  name: name ?? className,
  qty,
  forClassName,
});

const WISH: WishPosition[] = [
  w('blueprint', 'p4ar', 2, null, 'P4-AR'),
  w('item', 'medpen', 12, null, 'Medpen'),
  w('ship', 'cutlass', 1, null, 'Cutlass Black'),
  w('material', 'aluminium', 16, 'p4ar', 'Aluminium'),
  w('material', 'copper', 8, 'p4ar', 'Kupfer'),
  w('material', 'titan', 4, 'gallant', 'Titan'),
  w('material', 'quartz', 3, null, 'Quarz'),
];

describe('groupWish', () => {
  it('orders ships, items, loose material, then one group per blueprint', () => {
    const ids = groupWish(WISH).map((g) => g.id);
    expect(ids).toEqual(['ships', 'items', 'materials', 'bp:p4ar', 'bp:gallant']);
  });

  it('keeps a blueprint with its material, and material for a blueprint that is not wished as its own group', () => {
    const [, , , p4ar, gallant] = groupWish(WISH);
    expect(p4ar.rows.map((r) => r.className)).toEqual(['p4ar', 'aluminium', 'copper']);
    expect(p4ar.blueprint?.className).toBe('p4ar');
    expect(p4ar.title).toBe('P4-AR');
    expect(gallant.blueprint).toBeNull();
    expect(gallant.rows.map((r) => r.className)).toEqual(['titan']);
  });

  it('is empty for an empty wishlist', () => {
    expect(groupWish([])).toEqual([]);
  });
});

describe('picking', () => {
  const groups = groupWish(WISH);
  const p4ar = groups[3];

  it('toggles a whole group to the full quantity and back', () => {
    const on = toggleGroup(p4ar, new Map());
    expect([...on.entries()].sort()).toEqual([['blueprint:p4ar', 2], ['material:aluminium@p4ar', 16], ['material:copper@p4ar', 8]].sort());
    expect(pickedShare(p4ar.rows, on)).toBe(1);
    expect(toggleGroup(p4ar, on).size).toBe(0);
  });

  it('reads a partly picked group as mixed', () => {
    const some = setPicked(p4ar, new Map(), 'material:copper@p4ar', 8);
    expect(pickedShare(p4ar.rows, some)).toBe(0.5);
    expect(pickedShare(p4ar.rows, new Map())).toBe(0);
  });

  it('splits a quantity (5 of 20 style) and lets the blueprint follow the largest share', () => {
    let picks = toggleGroup(p4ar, new Map());
    picks = setPicked(p4ar, picks, 'material:aluminium@p4ar', 8); // half of the aluminium
    picks = setPicked(p4ar, picks, 'material:copper@p4ar', 4); // half of the copper
    expect(picks.get('material:aluminium@p4ar')).toBe(8);
    expect(picks.get('blueprint:p4ar')).toBe(1); // 2x P4-AR becomes 1x
  });

  it('drops the blueprint pick when its last material goes, and caps a quantity at what is wished', () => {
    let picks = setPicked(p4ar, new Map(), 'material:copper@p4ar', 99);
    expect(picks.get('material:copper@p4ar')).toBe(8);
    picks = setPicked(p4ar, picks, 'material:copper@p4ar', 0);
    expect(picks.size).toBe(0);
  });

  it('counts the picked pieces', () => {
    expect(pickedPieces(new Map([['a', 2], ['b', 5]]))).toBe(7);
  });
});
