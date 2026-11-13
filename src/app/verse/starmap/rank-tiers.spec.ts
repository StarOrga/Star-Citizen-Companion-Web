import {
  RANK_SEEN_KEY,
  RANK_TIER_AT,
  RANK_TIER_KEYS,
  hasRankNews,
  hasTierReward,
  rankNewsItems,
  rankProgress,
  rankTier,
  readRankSeen,
  tierState,
  writeRankSeen,
} from './starmap.model';

const REWARDS = { road: false, nebula: false, live: false, reserve: false, meteor: false, supernova: false, sunCollection: false };

describe('rank tiers', () => {
  it('has exactly 7 tiers with rising thresholds', () => {
    expect(RANK_TIER_AT.length).toBe(7);
    expect(RANK_TIER_KEYS.length).toBe(7);
    for (let i = 1; i < RANK_TIER_AT.length; i++) expect(RANK_TIER_AT[i]).toBeGreaterThan(RANK_TIER_AT[i - 1]);
  });

  it('maps completed constellations to tiers 0..7', () => {
    expect(rankTier(0)).toBe(0);
    expect(rankTier(1)).toBe(1);
    expect(rankTier(2)).toBe(2);
    expect(rankTier(4)).toBe(3);
    expect(rankTier(5)).toBe(4);
    expect(rankTier(8)).toBe(5);
    expect(rankTier(17)).toBe(6);
    expect(rankTier(18)).toBe(7);
    expect(rankTier(500)).toBe(7);
    expect(rankTier(Number.NaN)).toBe(0);
  });

  it('progress names the next tier and the missing constellations', () => {
    const p = rankProgress({ unlocked: true, rank: 6 });
    expect(p.tier).toBe(4);
    expect(p.key).toBe('cartographer');
    expect(p.next).toEqual({ tier: 5, key: 'astrographer', at: 8 });
    expect(p.toNext).toBe(2);
    expect(p.share).toBeCloseTo(1 / 3);
  });

  it('an unranked reader starts at tier 0, a locked rank counts as 0', () => {
    expect(rankProgress({ unlocked: false, rank: 4 }).tier).toBe(0);
    const p = rankProgress({ unlocked: true, rank: 0 });
    expect(p.key).toBeNull();
    expect(p.next?.key).toBe('observer');
    expect(p.toNext).toBe(1);
  });

  it('tier 7 has no next tier and a full bar', () => {
    const p = rankProgress({ unlocked: true, rank: 30 });
    expect(p.next).toBeNull();
    expect(p.share).toBe(1);
    expect(p.toNext).toBe(0);
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
    const items = rankNewsItems({ kartograph: { unlocked: true, rank: 2 }, rewards: { ...REWARDS, road: true } });
    expect(items).toEqual(['tier:1', 'tier:2', 'reward:wallpaper', 'reward:badge', 'series:road']);
  });

  it('is new until the rank page stored what it showed', () => {
    const before = rankNewsItems({ kartograph: { unlocked: true, rank: 1 }, rewards: REWARDS });
    expect(hasRankNews(before, readRankSeen())).toBe(true);
    writeRankSeen(before);
    expect(hasRankNews(before, readRankSeen())).toBe(false);
    const after = rankNewsItems({ kartograph: { unlocked: true, rank: 2 }, rewards: REWARDS });
    expect(hasRankNews(after, readRankSeen())).toBe(true);
  });

  it('nothing earned means nothing new', () => {
    expect(hasRankNews(rankNewsItems({ kartograph: { unlocked: false, rank: 0 }, rewards: REWARDS }), new Set())).toBe(false);
  });

  it('a broken store counts as nothing seen', () => {
    localStorage.setItem(RANK_SEEN_KEY, '{oops');
    expect(readRankSeen().size).toBe(0);
  });
});
