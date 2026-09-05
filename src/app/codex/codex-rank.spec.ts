import {
  cohortCacheKey,
  filterCohort,
  percentileOf,
  pruneCohortCache,
  rankBandOf,
  rankProfileById,
  rankProfileDisabledReason,
  rankShip,
  readCohortCache,
  writeCohortCache,
  RANK_PROFILES,
  type RankShipInput,
} from './codex-rank';

function ship(
  className: string,
  sizeClass: number | null,
  career: string | null,
  sheet: RankShipInput['sheet'],
): RankShipInput {
  return { className, sizeClass, career, sheet };
}

const target = ship('CNOU_Nomad', 2, 'Freight', {
  alpha: 131,
  sustainedDps: 837,
  missiles: 0,
  shieldHp: 6480,
  agility: 60,
  boost: 200,
  cargo: 24,
});

const cohort: RankShipInput[] = [
  target,
  ship('AEGS_Gladius', 2, 'Combat', { alpha: 200, sustainedDps: 1200, missiles: 400, shieldHp: 4000, agility: 90, boost: 260 }),
  ship('MISC_Freelancer', 3, 'Freight', { alpha: 90, sustainedDps: 600, missiles: 0, shieldHp: 9000, agility: 40, boost: 150 }),
  ship('RSI_Aurora', 1, 'Starter', { alpha: 40, sustainedDps: 200, missiles: 100, shieldHp: 2000, agility: 55, boost: 180 }),
];

describe('percentileOf', () => {
  it('gives the best value 100 % and the worst 0 % in a spread field', () => {
    expect(percentileOf(10, [1, 5, 10], false)).toBe(83.3);
    expect(percentileOf(1, [1, 5, 10], false)).toBe(16.7);
  });

  it('inverts for lower-is-better axes', () => {
    expect(percentileOf(1, [1, 5, 10], true)).toBe(83.3);
  });

  it('puts an all-equal field at 50 %, not at 0 or 100', () => {
    expect(percentileOf(5, [5, 5, 5], false)).toBe(50);
  });
});

describe('filterCohort', () => {
  it('keeps only the target size class by default', () => {
    expect(filterCohort(target, cohort, 'sizeClass').map((s) => s.className)).toEqual([
      'CNOU_Nomad',
      'AEGS_Gladius',
    ]);
  });

  it('groups by career when asked', () => {
    expect(filterCohort(target, cohort, 'career').map((s) => s.className)).toEqual([
      'CNOU_Nomad',
      'MISC_Freelancer',
    ]);
  });

  it('falls back to the whole field when the target has no discriminator', () => {
    const anon = ship('X', null, null, {});
    expect(filterCohort(anon, cohort, 'sizeClass').length).toBe(cohort.length + 1);
  });

  it('adds the target when the cohort does not already contain it', () => {
    const others = cohort.filter((c) => c.className !== target.className);
    expect(filterCohort(target, others, 'all').map((s) => s.className)).toContain('CNOU_Nomad');
  });
});

describe('rankShip', () => {
  const result = rankShip(target, cohort, { profile: 'combat', scope: 'all' });

  it('ranks every axis of the profile', () => {
    expect(result.axes.length).toBe(6);
    expect(result.cohortSize).toBe(4);
  });

  it('keeps the radar axes in the fixed profile order', () => {
    expect(result.axes.map((a) => a.key)).toEqual(
      RANK_PROFILES.find((p) => p.id === 'combat')!.axes.map((a) => a.key),
    );
  });

  it('sorts the bar list by percentile, best first, without mutating the axes order', () => {
    const pcts = result.bars.map((a) => a.percentile ?? -1);
    expect([...pcts].sort((a, b) => b - a)).toEqual(pcts);
    expect(result.axes.map((a) => a.key)).toEqual(
      RANK_PROFILES.find((p) => p.id === 'combat')!.axes.map((a) => a.key),
    );
  });

  it('averages the axes into an overall percentile and a band', () => {
    expect(result.overall).not.toBeNull();
    expect(['low', 'mid', 'high']).toContain(result.band!);
    expect(result.bandKey).toBe(`codex.rank.band.${result.band}`);
  });

  it('excludes an axis the ship has no value for instead of scoring it 0', () => {
    const blind = ship('NO_DATA', 2, 'Freight', { alpha: 100 });
    const r = rankShip(blind, cohort, { profile: 'combat', scope: 'all' });
    const dps = r.axes.find((a) => a.key === 'sustainedDps')!;
    expect(dps.percentile).toBeNull();
    expect(dps.gapKey).toBe('codex.rank.gapAxis');
    expect(r.overall).not.toBeNull(); // alpha still ranks
  });

  it('inverts the cross-section axis (smaller is stealthier)', () => {
    const small = ship('SMALL', 2, 'x', { crossSection: 100 });
    const big = ship('BIG', 2, 'x', { crossSection: 900 });
    const r = rankShip(small, [small, big], { profile: 'defence', scope: 'all' });
    expect(r.axes.find((a) => a.key === 'crossSection')!.percentile).toBe(75);
  });

  it('paints a below-45 % axis as weak', () => {
    const weak = ship('WEAK', 2, 'x', { alpha: 1 });
    const r = rankShip(weak, [weak, ship('A', 2, 'x', { alpha: 10 }), ship('B', 2, 'x', { alpha: 20 })], {
      profile: 'combat',
      scope: 'all',
    });
    expect(r.axes.find((a) => a.key === 'alpha')!.weak).toBeTrue();
  });

  it('draws the median polygon at 50 % on every axis', () => {
    expect(result.medianPolygon).toEqual([50, 50, 50, 50, 50, 50]);
  });
});

describe('profiles', () => {
  it('exposes the three profiles of MASTER §3', () => {
    expect(RANK_PROFILES.map((p) => p.id)).toEqual(['combat', 'defence', 'transport']);
    expect(rankProfileById('nonsense').id).toBe('combat');
  });

  it('disables Transport for a hull without cargo', () => {
    const noCargo = ship('FIGHTER', 2, 'Combat', { cargo: 0 });
    expect(rankProfileDisabledReason('transport', noCargo)).toBe('codex.rank.disabled.noCargo');
    expect(rankProfileDisabledReason('transport', target)).toBeNull();
    expect(rankProfileDisabledReason('combat', noCargo)).toBeNull();
  });

  it('bands at 25 / 75', () => {
    expect(rankBandOf(10)).toBe('low');
    expect(rankBandOf(50)).toBe('mid');
    expect(rankBandOf(90)).toBe('high');
    expect(rankBandOf(null)).toBeNull();
  });
});

describe('cohort cache', () => {
  afterEach(() => localStorage.clear());

  it('round-trips a cohort keyed by build and scope', () => {
    const key = cohortCacheKey('build-1', 'sizeClass', '2');
    expect(writeCohortCache(key, cohort)).toBeTrue();
    expect(readCohortCache(key)!.map((s) => s.className)).toEqual(cohort.map((s) => s.className));
  });

  it('returns null for a missing or corrupt entry instead of throwing', () => {
    expect(readCohortCache('scc-codex-rank:v1:nope:all')).toBeNull();
    localStorage.setItem('scc-codex-rank:v1:b:all', '{not json');
    expect(readCohortCache('scc-codex-rank:v1:b:all')).toBeNull();
  });

  it('prunes cohorts of other builds', () => {
    writeCohortCache(cohortCacheKey('old', 'all'), cohort);
    writeCohortCache(cohortCacheKey('new', 'all'), cohort);
    pruneCohortCache('new');
    expect(readCohortCache(cohortCacheKey('old', 'all'))).toBeNull();
    expect(readCohortCache(cohortCacheKey('new', 'all'))).not.toBeNull();
  });
});

describe('cohort cache — an oversized fleet must not be retried every visit', () => {
  it('refuses a payload larger than the localStorage share instead of throwing', () => {
    const fat = Array.from({ length: 400 }, (_, i) => ({
      className: 'SHIP_' + i,
      sizeClass: null,
      career: null,
      // ~3 kB per ship pushes the blob past the 2 MB guard
      sheet: { note: 'x'.repeat(3000) } as unknown as RankShipInput['sheet'],
    })) as RankShipInput[];
    expect(writeCohortCache('scc-cohort-test-fat', fat)).toBeFalse();
    expect(localStorage.getItem('scc-cohort-test-fat')).toBeNull();
  });

  it('still stores a cohort that fits', () => {
    const lean: RankShipInput[] = [
      { className: 'CNOU_Nomad', sizeClass: null, career: null, sheet: { alpha: 131 } as never },
    ];
    expect(writeCohortCache('scc-cohort-test-lean', lean)).toBeTrue();
    expect(readCohortCache('scc-cohort-test-lean')?.length).toBe(1);
    localStorage.removeItem('scc-cohort-test-lean');
  });
});
