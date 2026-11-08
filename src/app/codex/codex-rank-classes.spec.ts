import { computeKpiSheet } from './codex-loadout-stats';
import {
  filterCohort,
  groupScale,
  RANK_AXIS_PROFILES,
  RANK_MIN_GROUP,
  RANK_PROFILES,
  rankCareerIsMapped,
  rankClassOfCareer,
  rankGroupName,
  rankMissionNoteKey,
  rankProfileById,
  rankProfileDisabledReason,
  rankProfileForMission,
  rankShip,
  rankTargetShipInput,
  type RankClassId,
  type RankShipInput,
} from './codex-rank';

const CLASSES: RankClassId[] = ['combat', 'transport', 'exploration', 'resources', 'support', 'multirole', 'competition'];

describe('career -> class', () => {
  const real: Record<string, RankClassId> = {
    '@vehicle_focus_combat': 'combat',
    '@vehicle_focus_Transporter': 'transport',
    '@vehicle_focus_exploration': 'exploration',
    '@vehicle_focus_resources': 'resources',
    '@vehicle_focus_support': 'support',
    '@vehicle_focus_multirole': 'multirole',
    '@vehicle_focus_competition': 'competition',
    '@vehicle_focus_ground': 'multirole',
    '@item_ShipFocus_CapitalShip': 'combat',
    '@item_ShipFocus_Gunship': 'combat',
    '@item_ShipFocus_Starter': 'multirole',
    '@item_ShipFocus_Transport': 'transport',
    '@vehicle_class_destroyer': 'combat',
    '@vehicle_class_snubfighter': 'combat',
  };

  it('maps every career key found in the data, whatever the case', () => {
    for (const [key, cls] of Object.entries(real)) {
      expect(rankClassOfCareer(key), key).toBe(cls);
      expect(rankClassOfCareer(key.toUpperCase()), key.toUpperCase()).toBe(cls);
      expect(rankCareerIsMapped(key), key).toBe(true);
    }
  });

  it('falls back to the Kampf list for an unknown, empty or missing key', () => {
    for (const key of ['@vehicle_focus_brandnew', '', '   ', null, undefined]) {
      expect(rankClassOfCareer(key)).toBe('combat');
      expect(rankCareerIsMapped(key)).toBe(false);
    }
  });
});

describe('axis lists', () => {
  it('has exactly one list of six axes per class and per Einsatz-only id', () => {
    for (const id of [...CLASSES, 'travel', 'stealth']) {
      const p = RANK_AXIS_PROFILES.filter((x) => x.id === id);
      expect(p.length, id).toBe(1);
      expect(p[0].axes.length, id).toBe(6);
    }
  });

  it('shares Kampf and Transport between class and Einsatz (no parallel system)', () => {
    expect(rankProfileForMission('combat', 'transport')).toBe('combat');
    expect(rankProfileForMission('transport', 'combat')).toBe('transport');
    expect(rankProfileById('combat')).toBe(RANK_PROFILES[0]);
    expect(rankProfileById('transport')).toBe(RANK_PROFILES[2]);
  });

  it('uses the class list for Alles and lets a picked Einsatz override it', () => {
    for (const c of CLASSES) expect(rankProfileForMission('all', c)).toBe(c);
    expect(rankProfileForMission('travel', 'combat')).toBe('travel');
    expect(rankProfileForMission('stealth', 'transport')).toBe('stealth');
    expect(rankProfileForMission('mining', 'combat')).toBe('resources');
    expect(rankProfileForMission('salvage', 'combat')).toBe('resources');
  });

  it('gives Reisen and Schleichen the axes of briefs/03.md, with their own label', () => {
    expect(rankProfileById('travel').axes.map((a) => a.key)).toEqual(['scm', 'maxSpeed', 'boost', 'quantumSpeed', 'quantumRange', 'spool']);
    const stealth = rankProfileById('stealth');
    expect(stealth.axes.map((a) => a.key)).toEqual(['ir', 'emIdle', 'emMax', 'crossSection', 'agility', 'scm']);
    expect(stealth.labelKey).toBe('codex.rank.profile.stealth');
    expect(stealth.labelKey).not.toContain('defense');
    expect(stealth.axes.filter((a) => a.lowerIsBetter).length).toBe(4);
  });

  it('marks the weight / spool / signature axes lower-is-better', () => {
    const lower = (id: string) => rankProfileById(id).axes.filter((a) => a.lowerIsBetter).map((a) => a.key);
    expect(lower('transport')).toEqual(['mass']);
    expect(lower('exploration')).toEqual(['spool', 'crossSection']);
    expect(lower('competition')).toEqual(['mass', 'spool']);
  });

  it('is honest about Bergbau and Bergung', () => {
    expect(rankMissionNoteKey('mining')).toBe('codex.rank.noMiningData');
    expect(rankMissionNoteKey('salvage')).toBe('codex.rank.noMiningData');
    expect(rankMissionNoteKey('combat')).toBeNull();
  });
});

describe('D3: Transport on a hauler (Caterpillar)', () => {
  const payload = {
    flight: { scmSpeed: 130, maxSpeed: 1000 },
    hull: { hp: 91500, mass: 1508000 },
    armorHp: null,
    cargoScu: 576,
    stats: null,
  };

  it('the page strip input has no cargo, which disabled Transport for every hull (the cause)', () => {
    // What codex-detail's kpiShipInput passed before the fix: flight + stats only.
    const sheet = computeKpiSheet([], { flight: payload.flight, stats: null });
    expect(sheet.cargo).toBeNull();
    expect(rankProfileDisabledReason('transport', { className: 'DRAK_Caterpillar', sizeClass: null, career: null, sheet: { cargo: sheet.cargo } })).toBe(
      'codex.rank.disabled.noCargo',
    );
  });

  it('the rank target input carries cargo, so Transport is enabled and chosen', () => {
    const sheet = computeKpiSheet([], rankTargetShipInput(payload));
    expect(sheet.cargo).toBe(576);
    expect(sheet.hullHp).toBe(91500);
    expect(rankProfileDisabledReason('transport', { className: 'DRAK_Caterpillar', sizeClass: null, career: null, sheet: { cargo: sheet.cargo } })).toBeNull();
    expect(rankProfileForMission('transport', rankClassOfCareer('@vehicle_focus_Transporter'))).toBe('transport');
  });

  it('still disables Transport for a hull without a hold', () => {
    const sheet = computeKpiSheet([], rankTargetShipInput({ ...payload, cargoScu: null }));
    expect(rankProfileDisabledReason('transport', { className: 'AEGS_Gladius', sizeClass: null, career: null, sheet: { cargo: sheet.cargo } })).toBe(
      'codex.rank.disabled.noCargo',
    );
  });

  it('ranks the Caterpillar on the Transport axes', () => {
    const t: RankShipInput = { className: 'DRAK_Caterpillar', sizeClass: null, career: '@vehicle_focus_Transporter', sheet: { cargo: 576, scm: 130, hullHp: 91500, mass: 1508000 } };
    const r = rankShip(t, [t], { profile: 'transport' });
    expect(r.axes.map((a) => a.key)).toEqual(['cargo', 'quantumRange', 'scm', 'mass', 'hullHp', 'shieldHp']);
  });
});

describe('D4: rim at the 95th percentile', () => {
  // 19 ordinary ships and one outlier 20x the rest.
  const group = [...Array.from({ length: 19 }, (_, i) => 10 + i), 500];

  it('keeps the best-value rim as the default for every other caller', () => {
    expect(groupScale(20, group, false)).toBe(4);
    expect(groupScale(20, group, false, 'best')).toBe(4);
  });

  it('lets a strong outlier stop pushing the group to the centre', () => {
    const best = groupScale(20, group, false, 'best')!;
    const p95 = groupScale(20, group, false, 'p95')!;
    expect(p95).toBeGreaterThan(best * 5);
  });

  it('clamps values beyond the rim at 100', () => {
    expect(groupScale(500, group, false, 'p95')).toBe(100);
  });

  it('mirrors for lower-is-better: the rim is the 5th percentile, smaller clamps at 100', () => {
    const light = [0.5, ...Array.from({ length: 19 }, (_, i) => 100 + i)];
    expect(groupScale(0.5, light, true, 'p95')).toBe(100);
    expect(groupScale(110, light, true, 'p95')!).toBeGreaterThan(groupScale(110, light, true, 'best')!);
    expect(groupScale(110, light, true, 'p95')!).toBeLessThan(100);
  });

  it('falls back to the best value when the 95th percentile is zero (a mostly-zero group)', () => {
    const missiles = [...Array(20).fill(0), 800];
    expect(groupScale(400, missiles, false, 'p95')).toBe(50);
  });

  it('keeps the median on the same scale', () => {
    const mk = (n: number, v: number): RankShipInput => ({ className: 'S' + n, sizeClass: null, career: 'a', sheet: { alpha: v } });
    const cohort = group.map((v, i) => mk(i, v));
    const t = cohort[1];
    const profile = { id: 'combat' as const, labelKey: 'x', axes: [{ key: 'alpha' as const, labelKey: 'a', lowerIsBetter: false }] };
    const best = rankShip(t, cohort, { profile, scope: 'all' }).axes[0];
    const p95 = rankShip(t, cohort, { profile, scope: 'all', rim: 'p95' }).axes[0];
    expect(p95.compareNorm!).toBeGreaterThan(best.compareNorm!);
    expect(p95.norm! - p95.compareNorm!).toBeLessThan(100);
    expect(p95.medianValue).toBe(best.medianValue);
    // percentiles (the "Besser als" list) do not move with the rim
    expect(p95.percentile).toBe(best.percentile);
  });
});

describe('D5/D6: groups and gaps', () => {
  const ship = (n: string, career: string | null, role: string | null, alpha: number | null): RankShipInput => ({
    className: n,
    sizeClass: null,
    career,
    role,
    sheet: { alpha, sustainedDps: 100, shieldHp: 100 },
  });
  const cohort: RankShipInput[] = [
    ...Array.from({ length: 3 }, (_, i) => ship('L' + i, '@vehicle_focus_Combat', '@lf', 10 + i)),
    ...Array.from({ length: 6 }, (_, i) => ship('G' + i, '@item_ShipFocus_Gunship', '@gs', 20 + i)),
    ...Array.from({ length: 4 }, (_, i) => ship('C' + i, '@vehicle_focus_Combat', '@hf', 30 + i)),
    ship('T', '@vehicle_focus_Transporter', '@fr', 1),
  ];
  const target = cohort[0];

  it('names the threshold', () => {
    expect(RANK_MIN_GROUP).toBe(8);
  });

  it('groups the career scope by class, so strays join their class', () => {
    expect(filterCohort(target, cohort, 'career').length).toBe(7);
    expect(filterCohort(target, cohort, 'career', { careerByClass: true }).length).toBe(13);
  });

  it('widens a too-small role group to the class, then to all ships, and says so', () => {
    const r = rankShip(target, cohort, { scope: 'role', careerByClass: true, minGroup: RANK_MIN_GROUP });
    expect(r.scope).toBe('career');
    expect(r.cohortSize).toBe(13);
    expect(r.scopeFallbackKey).toBe('codex.rank.disabled.smallGroup');
    const r2 = rankShip(target, cohort, { scope: 'role', careerByClass: true, minGroup: 20 });
    expect(r2.scope).toBe('all');
  });

  it('keeps the requested group when it is large enough or no threshold is given', () => {
    expect(rankShip(target, cohort, { scope: 'role', minGroup: 3 }).scope).toBe('role');
    expect(rankShip(target, cohort, { scope: 'role' }).scope).toBe('role');
  });

  it('draws no vertex for an axis without value and never reads it as 0', () => {
    const noAlpha = ship('X', '@vehicle_focus_Combat', '@lf', null);
    const r = rankShip(noAlpha, [...cohort, noAlpha], { scope: 'all', rim: 'p95' });
    const a = r.axes.find((x) => x.key === 'alpha')!;
    expect(a.value).toBeNull();
    expect(a.norm).toBeNull();
    expect(a.percentile).toBeNull();
    expect(a.delta).toBeNull();
    expect(a.gapKey).toBe('codex.rank.gapAxis');
  });

  it('builds the group name from the role label', () => {
    expect(rankGroupName('Leichter Jäger', 'de')).toBe('Leichten Jäger');
    expect(rankGroupName('Mittlerer Frachter', 'de')).toBe('Mittleren Frachter');
    expect(rankGroupName('Frachter', 'de')).toBe('Frachter');
    expect(rankGroupName('Light Fighter', 'en')).toBe('Light Fighters');
    expect(rankGroupName('', 'de')).toBe('');
  });
});
