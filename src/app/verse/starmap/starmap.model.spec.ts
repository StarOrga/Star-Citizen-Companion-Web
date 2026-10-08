import type { VersePoint } from '../data/verse.models';
import {
  FALLBACK_POINTS,
  badgeQuery,
  communityLevels,
  isLiveDay,
  parseBadge,
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

describe('starmap model — rewards helpers', () => {
  it('meteor day = local date equals the UTC date of live_at', () => {
    const now = new Date(2026, 9, 29, 15, 0, 0);
    const y = now.getFullYear();
    const m = String(now.getMonth() + 1).padStart(2, '0');
    const d = String(now.getDate()).padStart(2, '0');
    expect(isLiveDay(`${y}-${m}-${d}T08:00:00Z`, now)).toBeTrue();
    expect(isLiveDay('2026-10-01T08:00:00Z', now)).toBeFalse();
    expect(isLiveDay(null, now)).toBeFalse();
    expect(isLiveDay('nonsense', now)).toBeFalse();
  });

  it('badge links round-trip and reject junk', () => {
    const b = { rank: 3, patch: '4.4', stars: 7, sun: true };
    const q = new URLSearchParams(badgeQuery(b));
    expect(parseBadge(q)).toEqual(b);
    expect(parseBadge(new URLSearchParams('rank=0&patch=4.4'))).toBeNull();
    expect(parseBadge(new URLSearchParams('rank=2&patch=<script>'))).toBeNull();
    expect(parseBadge(new URLSearchParams('rank=2&patch=4.4&stars=99'))?.stars).toBe(7);
  });

  it('community levels map offered keys onto the lighting order as shares', () => {
    const levels = communityLevels(['notes', 'cx-fps'], { notes: 5, 'cx-fps': 1 }, 10);
    expect(levels).toEqual([0.5, 0.1, 0, 0, 0, 0, 0]);
    expect(communityLevels(['notes'], { notes: 3 }, 0)).toEqual([0, 0, 0, 0, 0, 0, 0]);
  });
});
