import {
  RANK_SEEN_KEY,
  RANK_TIER_AT,
  RANK_TIER_KEYS,
  SPLINTERS_PER_SUN,
  foldSplinters,
  hasRankNews,
  hasTierReward,
  rankNewsItems,
  rankProgress,
  rankProgressOf,
  rankStars,
  rankTier,
  readRankSeen,
  tierState,
  writeRankSeen,
} from './starmap.model';
import type { VerseExplorerState } from '../data/verse.models';

const REWARDS = { road: false, nebula: false, live: false, reserve: false, meteor: false, supernova: false, sunCollection: false };

describe('rank tiers', () => {
  it('has exactly 7 tiers with rising thresholds', () => {
    expect(RANK_TIER_AT.length).toBe(7);
    expect(RANK_TIER_KEYS.length).toBe(7);
    for (let i = 1; i < RANK_TIER_AT.length; i++) expect(RANK_TIER_AT[i]).toBeGreaterThan(RANK_TIER_AT[i - 1]);
  });

  it('uses the star thresholds 1 / 3 / 7 / 12 / 18 / 26 / 35', () => {
    expect([...RANK_TIER_AT]).toEqual([1, 3, 7, 12, 18, 26, 35]);
  });

  it('maps lit stars to tiers 0..7', () => {
    const tiers = [0, 1, 2, 3, 6, 7, 11, 12, 17, 18, 25, 26, 34, 35, 40, 500].map(rankTier);
    expect(tiers).toEqual([0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 7]);
    expect(rankTier(Number.NaN)).toBe(0);
  });

  it('progress covers 0, 1, 2, 3, 34, 35 and 40 stars', () => {
    expect(rankProgress(0)).toMatchObject({ tier: 0, key: null, toNext: 1, share: 0 });
    expect(rankProgress(0).next).toEqual({ tier: 1, key: 'observer', at: 1 });
    expect(rankProgress(1)).toMatchObject({ tier: 1, key: 'observer', toNext: 2, share: 0 });
    expect(rankProgress(2)).toMatchObject({ tier: 1, toNext: 1 });
    expect(rankProgress(2).share).toBeCloseTo(0.5);
    expect(rankProgress(3)).toMatchObject({ tier: 2, key: 'surveyor', toNext: 4 });
    expect(rankProgress(34)).toMatchObject({ tier: 6, key: 'master', toNext: 1 });
    expect(rankProgress(34).next).toEqual({ tier: 7, key: 'keeper', at: 35 });
    for (const n of [35, 40]) {
      const p = rankProgress(n);
      expect(p).toMatchObject({ tier: 7, key: 'keeper', toNext: 0, share: 1, stars: n });
      expect(p.next).toBeNull();
    }
  });

  it('the stars come from the server field, else from the lit stars of every patch line', () => {
    const patches = [{ starCount: 5 }, { starCount: 3 }, { starCount: 9 }] as unknown as VerseExplorerState['patches'];
    // 5 + 3 + 7 (a line is capped at 7 stars) = 15
    expect(rankStars({ kartograph: { unlocked: false, rank: 0 }, patches })).toBe(15);
    expect(rankProgressOf({ kartograph: { unlocked: false, rank: 0 }, patches }).tier).toBe(4);
    expect(rankStars({ kartograph: { unlocked: true, rank: 1, stars: 4 }, patches })).toBe(4);
    expect(rankStars(null)).toBe(0);
    // 5 of 7 stars on one map, nothing completed: tier 2 instead of "no rank yet"
    expect(rankProgressOf({ kartograph: { unlocked: false, rank: 0, stars: 5 }, patches: [] }).tier).toBe(2);
  });

  it('tiers 3 and 4 change the content, every format is open from tier 1', () => {
    expect(hasTierReward(2, 'companions')).toBe(false);
    expect(hasTierReward(3, 'companions')).toBe(true);
    expect(hasTierReward(3, 'tint')).toBe(false);
    expect(hasTierReward(4, 'tint')).toBe(true);
  });

  it('ladder states and tier rewards follow the tier', () => {
    expect([1, 2, 3].map((t) => tierState(t, 2))).toEqual(['earned', 'current', 'locked']);
    expect(hasTierReward(4, 'frame')).toBe(false);
    expect(hasTierReward(5, 'frame')).toBe(true);
    expect(hasTierReward(1, 'wallpaper')).toBe(true);
  });
});

describe('rank news marker', () => {
  afterEach(() => localStorage.removeItem(RANK_SEEN_KEY));

  it('lists tiers, rank rewards and series stops', () => {
    const items = rankNewsItems({ kartograph: { unlocked: true, rank: 2, stars: 3 }, patches: [], rewards: { ...REWARDS, road: true } });
    expect(items).toEqual(['tier:1', 'tier:2', 'reward:wallpaper', 'reward:badge', 'series:road']);
  });

  it('is new until the rank page stored what it showed', () => {
    const before = rankNewsItems({ kartograph: { unlocked: true, rank: 1, stars: 1 }, patches: [], rewards: REWARDS });
    expect(hasRankNews(before, readRankSeen())).toBe(true);
    writeRankSeen(before);
    expect(hasRankNews(before, readRankSeen())).toBe(false);
    const after = rankNewsItems({ kartograph: { unlocked: true, rank: 2, stars: 3 }, patches: [], rewards: REWARDS });
    expect(hasRankNews(after, readRankSeen())).toBe(true);
  });

  it('nothing earned means nothing new', () => {
    expect(hasRankNews(rankNewsItems({ kartograph: { unlocked: false, rank: 0, stars: 0 }, patches: [], rewards: REWARDS }), new Set())).toBe(false);
  });

  it('a broken store counts as nothing seen', () => {
    localStorage.setItem(RANK_SEEN_KEY, '{oops');
    expect(readRankSeen().size).toBe(0);
  });

  it('folds sun splinters 3 to 1 and keeps the rest', () => {
    expect([0, 1, 2, 3, 4, 6, 7].map((n) => foldSplinters(n))).toEqual([
      { suns: 0, rest: 0 },
      { suns: 0, rest: 1 },
      { suns: 0, rest: 2 },
      { suns: 1, rest: 0 },
      { suns: 1, rest: 1 },
      { suns: 2, rest: 0 },
      { suns: 2, rest: 1 },
    ]);
    expect(foldSplinters(-3)).toEqual({ suns: 0, rest: 0 });
    expect(foldSplinters(undefined)).toEqual({ suns: 0, rest: 0 });
    expect(SPLINTERS_PER_SUN).toBe(3);
  });
});
