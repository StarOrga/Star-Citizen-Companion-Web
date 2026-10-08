import { describe, it, expect } from 'vitest';
import { mapConstellationCandidates } from '../src/lib/catalog-map';

const STARS = [[0.5, 0], [0.9, 0.4], [0.9, 0.5], [0.51, 1], [0.49, 1], [0.1, 0.5], [0.1, 0.4]];

describe('mapConstellationCandidates', () => {
  it('takes ship rows with seven in-range stars and labels ground vehicles', () => {
    const out = mapConstellationCandidates([
      { kind: 'ship', className: 'RSI_Zeus_CL', constellation: STARS },
      { kind: 'ship', className: 'TMBL_Nova', constellation: STARS, ground: true },
    ]);
    expect(out).toEqual([
      { class_name: 'RSI_Zeus_CL', kind: 'ship', points: STARS },
      { class_name: 'TMBL_Nova', kind: 'ground', points: STARS },
    ]);
  });

  it('skips items, rows without stars and malformed stars', () => {
    const out = mapConstellationCandidates([
      { kind: 'weapon', className: 'W', constellation: STARS },
      { kind: 'ship', className: 'NoStars' },
      { kind: 'ship', className: 'Six', constellation: STARS.slice(0, 6) },
      { kind: 'ship', className: 'OutOfRange', constellation: [...STARS.slice(0, 6), [1.5, 0]] },
      { kind: 'ship', constellation: STARS },
    ]);
    expect(out).toEqual([]);
  });
});
