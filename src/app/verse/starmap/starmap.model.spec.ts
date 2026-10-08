import type { VersePoint } from '../data/verse.models';
import {
  FALLBACK_POINTS,
  hashSeed,
  lightRank,
  litIndices,
  mulberry32,
  starTask,
  supernovaPoints,
  symmetricLightOrder,
  taskLink,
} from './starmap.model';

describe('starmap model', () => {
  // Outline order: nose, right wing, right tail, tail, left tail, left wing, spine.
  const ship: VersePoint[] = [
    [0.5, 0.05],
    [0.9, 0.5],
    [0.7, 0.9],
    [0.5, 0.95],
    [0.3, 0.9],
    [0.1, 0.5],
    [0.5, 0.5],
  ];

  it('lights the axis first, then mirrored pairs from the inside out', () => {
    const order = symmetricLightOrder(ship);
    expect(order.slice(0, 3).sort()).toEqual([0, 3, 6]);
    expect(order.slice(3, 5).sort()).toEqual([2, 4]);
    expect(order.slice(5, 7).sort()).toEqual([1, 5]);
  });

  it('never lights along the outline', () => {
    expect(symmetricLightOrder(ship)).not.toEqual([0, 1, 2, 3, 4, 5, 6]);
  });

  it('every even lit count of the pair phase is mirror-balanced', () => {
    for (const count of [5, 7]) {
      const lit = litIndices(ship, count);
      const left = [...lit].filter((i) => ship[i][0] < 0.49).length;
      const right = [...lit].filter((i) => ship[i][0] > 0.51).length;
      expect(left).toBe(right);
    }
  });

  it('is deterministic and clamps the star count', () => {
    expect(symmetricLightOrder(ship)).toEqual(symmetricLightOrder(ship));
    expect(litIndices(ship, 12).size).toBe(7);
    expect(litIndices(ship, -1).size).toBe(0);
    expect(symmetricLightOrder([])).toEqual([]);
  });

  it('ranks match the order', () => {
    const order = symmetricLightOrder(FALLBACK_POINTS);
    const rank = lightRank(FALLBACK_POINTS);
    order.forEach((idx, r) => expect(rank[idx]).toBe(r));
  });

  it('seeded helpers are reproducible', () => {
    expect(hashSeed('4.4')).toBe(hashSeed('4.4'));
    expect(hashSeed('4.4')).not.toBe(hashSeed('4.3'));
    const a = mulberry32(1);
    const b = mulberry32(1);
    expect([a(), a(), a()]).toEqual([b(), b(), b()]);
    expect(supernovaPoints('4.4')).toEqual(supernovaPoints('4.4'));
    expect(supernovaPoints('4.4').length).toBe(7);
  });

  it('resolves task links to the places where the task is done', () => {
    expect(taskLink(starTask('notes'), '4.4', null)).toBe('/verse/patches/4.4');
    expect(taskLink(starTask('cx-keybinds'), '4.4', null)).toBe('/codex/keybinds');
    expect(taskLink(starTask('cx-newship'), '4.4', 'RSI_Zeus')).toBe('/codex/ship/RSI_Zeus');
    expect(taskLink(starTask('cx-newship'), '4.4', null)).toBe('/codex');
  });
});
