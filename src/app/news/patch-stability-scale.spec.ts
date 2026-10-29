import {
  VoteAggregate, VOTE_CORRECTION_CAP, communityCorrection, correctedStability, stabilityTrend, stabilityWord,
} from './patch-stability';

/** n votes with unit weights: sum w = n, sum w^2 = n, so n_eff = n. */
function agg(stabil: number, wackelig: number, instabil: number): VoteAggregate {
  const n = stabil + wackelig + instabil;
  return { wStabil: stabil, wWackelig: wackelig, wInstabil: instabil, sumW: n, sumW2: n, votes: n, ownVerdict: null, ownNextChangeAt: null };
}

describe('stabilityWord', () => {
  it('draws the bounds at 44 / 45 / 74 / 75', () => {
    expect(stabilityWord(44)).toBe('instabil');
    expect(stabilityWord(45)).toBe('wackelig');
    expect(stabilityWord(74)).toBe('wackelig');
    expect(stabilityWord(75)).toBe('stabil');
    expect(stabilityWord(74.9)).toBe('wackelig');
    expect(stabilityWord(0)).toBe('instabil');
    expect(stabilityWord(100)).toBe('stabil');
  });
  it('is null without a number', () => {
    expect(stabilityWord(null)).toBeNull();
    expect(stabilityWord(NaN)).toBeNull();
  });
});

describe('stabilityTrend', () => {
  it('treats |delta| < 3 as same and exactly 3 as a change', () => {
    expect(stabilityTrend(72, 70)).toBe('same');
    expect(stabilityTrend(68, 70)).toBe('same');
    expect(stabilityTrend(73, 70)).toBe('better');
    expect(stabilityTrend(67, 70)).toBe('worse');
  });
  it('is null when either side is missing', () => {
    expect(stabilityTrend(null, 70)).toBeNull();
    expect(stabilityTrend(70, null)).toBeNull();
  });
});

describe('communityCorrection', () => {
  it('is too-few below n_eff 25', () => {
    const r = communityCorrection(80, agg(10, 5, 9));
    expect(r.state).toBe('too-few');
    expect(r.correction).toBe(0);
    expect(r.nEff).toBe(24);
    expect(r.votes).toBe(24);
  });

  it('uses n_eff, not the raw count: skewed weights shrink it', () => {
    const r = communityCorrection(80, { ...agg(40, 0, 0), sumW: 40, sumW2: 400 });
    expect(r.nEff).toBe(4);
    expect(r.state).toBe('too-few');
  });

  it('confirms when S sits inside the interval plus dead band', () => {
    const r = communityCorrection(60, agg(0, 30, 0)); // mean 60, sd 0
    expect(r.state).toBe('confirmed');
    expect(r.correction).toBe(0);
    expect(communityCorrection(63, agg(0, 30, 0)).state).toBe('confirmed');
    expect(communityCorrection(63.5, agg(0, 30, 0)).state).toBe('applied');
  });

  it('applies the posterior pull toward the votes', () => {
    // mean 60, n_eff 30, S 66: posterior = (30*60 + 15*66)/45 = 62, so -4
    const r = communityCorrection(66, agg(0, 30, 0));
    expect(r.state).toBe('applied');
    expect(r.correction).toBe(-4);
    expect(r.shares.wackelig).toBe(1);
  });

  it('caps at +/- 10', () => {
    const down = communityCorrection(95, agg(0, 0, 100)); // mean 20
    expect(down.state).toBe('applied');
    expect(down.correction).toBe(-VOTE_CORRECTION_CAP);
    const up = communityCorrection(10, agg(100, 0, 0));
    expect(up.correction).toBe(VOTE_CORRECTION_CAP);
  });

  it('halves the correction when both extremes hold at least 25 %', () => {
    // 10/10/10: mean 56.7, S 95 -> capped -10, split -> -5
    const r = communityCorrection(95, agg(10, 10, 10));
    expect(r.state).toBe('split');
    expect(r.correction).toBe(-5);
    expect(r.halfWidth).toBeGreaterThan(0);
  });

  it('is not split when one extreme is under 25 %', () => {
    expect(communityCorrection(95, agg(5, 20, 20)).state).toBe('applied');
  });

  it('correctedStability adds, rounds and clamps', () => {
    const c = communityCorrection(95, agg(0, 0, 100));
    expect(correctedStability(95, c)).toBe(85);
    expect(correctedStability(3, { ...c, correction: -10 })).toBe(0);
    expect(correctedStability(98, { ...c, correction: 10 })).toBe(100);
  });
});
