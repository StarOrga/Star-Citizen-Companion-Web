import {
  EARLY_DAYS,
  StabilityPatchRow,
  StabilitySampleRow,
  cigScore,
  combineScore,
  communityScore,
  computeVerdict,
  daysBetween,
  isEarly,
  levelOf,
  serviceScore,
  stabilityPercent,
  toneOf,
} from './patch-stability';

function patch(line: string, liveAt: string, extra: Partial<StabilityPatchRow> = {}): StabilityPatchRow {
  return {
    patch_line: line,
    live_at: liveAt,
    notes_thread_id: 1,
    notes_slug: `star-citizen-alpha-${line.replace('.', '-')}-live-release-notes`,
    hotfix_thread_id: null,
    hotfix_slug: null,
    cig_fixes: null,
    cig_fixes_ic: null,
    cig_crash_fixes: null,
    cig_exploit_fixes: null,
    final_replies: null,
    final_outage_min_per_day: null,
    final_ticket_share: null,
    final_ticket_vote_share: null,
    ...extra,
  };
}

function sample(line: string, on: string, extra: Partial<StabilitySampleRow> = {}): StabilitySampleRow {
  return {
    patch_line: line,
    sampled_on: on,
    rn_replies: 0,
    rn_votes: 0,
    hf_replies: null,
    hf_votes: null,
    top_ticket_share: 0,
    top_ticket_vote_share: 0,
    top_tickets: [],
    hotfix_events: [],
    outage_min_7d: 0,
    open_incident: false,
    kb_open_total: null,
    kb_by_section: null,
    kb_anchor_ids: null,
    kb_edited_at: null,
    ...extra,
  };
}

describe('patch-stability components', () => {
  it('communityScore: velocity band 2–20, ticket shares linear', () => {
    expect(communityScore({ velocity: 0, ticketShare: 0, ticketVoteShare: 0 })).toBe(0);
    expect(communityScore({ velocity: 20, ticketShare: 1, ticketVoteShare: 1 })).toBeCloseTo(1, 6);
    expect(communityScore({ velocity: 11, ticketShare: 0, ticketVoteShare: 0 })).toBeCloseTo(0.2, 6);
  });

  it('serviceScore: log-scaled outage, capped at 300 min/day, open incident adds 0.3', () => {
    expect(serviceScore({ outageMinPerDay: 0, openIncident: false })).toBe(0);
    expect(serviceScore({ outageMinPerDay: 300, openIncident: false })).toBeCloseTo(0.7, 6);
    expect(serviceScore({ outageMinPerDay: 10_000, openIncident: true })).toBeCloseTo(1, 6);
  });

  it('serviceScore: a non-finite outage counts as zero, never NaN', () => {
    expect(serviceScore({ outageMinPerDay: Number.NaN, openIncident: false })).toBe(0);
    expect(serviceScore({ outageMinPerDay: Number.POSITIVE_INFINITY, openIncident: false })).toBeCloseTo(0.7, 6);
  });

  it('cigScore: open band 20–80, delta band 0–10', () => {
    expect(cigScore({ open: 10, delta7d: 0 })).toBe(0);
    expect(cigScore({ open: 50, delta7d: 5 })).toBeCloseTo(0.7 * 0.5 + 0.3 * 0.5, 6);
    expect(cigScore({ open: 200, delta7d: 50 })).toBeCloseTo(1, 6);
  });

  it('combineScore: worst component dominates, mean renormalised over present ones', () => {
    expect(combineScore({ community: 0, service: 0.656, cig: null })).toBeCloseTo(0.7 * 0.656 + 0.3 * ((0.3 * 0.656) / 0.8), 6);
    expect(combineScore({ community: null, service: null, cig: null })).toBeNull();
  });

  it('levelOf thresholds 0.18 / 0.33 / 0.48 / 0.63', () => {
    expect(levelOf(0.1)).toBe(1);
    expect(levelOf(0.18)).toBe(2);
    expect(levelOf(0.33)).toBe(3);
    expect(levelOf(0.48)).toBe(4);
    expect(levelOf(0.63)).toBe(5);
  });

  it('stabilityPercent inverts the penalty; toneOf collapses five levels to a traffic light', () => {
    expect(stabilityPercent(0)).toBe(100);
    expect(stabilityPercent(0.44)).toBe(56);
    expect(stabilityPercent(1)).toBe(0);
    expect(stabilityPercent(null)).toBeNull();
    // Out-of-range input is clamped, never printed as −20 % or 130 %.
    expect(stabilityPercent(1.3)).toBe(0);
    expect(stabilityPercent(-0.2)).toBe(100);
    expect([1, 2, 3, 4, 5].map((l) => toneOf(l as 1))).toEqual(['green', 'green', 'amber', 'red', 'red']);
  });

  it('isEarly / daysBetween', () => {
    expect(EARLY_DAYS).toBe(14);
    expect(isEarly(13.9)).toBeTrue();
    expect(isEarly(14)).toBeFalse();
    expect(daysBetween('2026-08-26T00:00:00Z', '2026-09-05T12:00:00Z')).toBeCloseTo(10.5, 6);
  });
});

describe('computeVerdict — calibration against the 2026-09-05 reality check', () => {
  const NOW = '2026-09-05T12:00:00Z';

  it('historical end-states reproduce 4.7 → 2, 4.8 → 4, 4.9 → 2', () => {
    const p47 = patch('4.7', '2026-03-25T00:00:00Z', { final_replies: 180, final_outage_min_per_day: 5, final_ticket_share: 0.16, final_ticket_vote_share: 0.10 });
    const p48 = patch('4.8', '2026-05-13T00:00:00Z', { final_replies: 143, final_outage_min_per_day: 209, final_ticket_share: 0, final_ticket_vote_share: 0 });
    // final_replies is the RELEASE-NOTES thread only: Hotfix Central was locked before 4.9,
    // so RN is the one count comparable across every line (4.9's HF thread had 289 more).
    const p49 = patch('4.9', '2026-07-15T00:00:00Z', { final_replies: 98, final_outage_min_per_day: 0, final_ticket_share: 0.18, final_ticket_vote_share: 0.59 });
    // live days are measured up to the NEXT line's live date, passed in by the caller
    const v47 = computeVerdict(p47, [], { now: NOW, endAt: '2026-05-13T00:00:00Z' });
    const v48 = computeVerdict(p48, [], { now: NOW, endAt: '2026-07-15T00:00:00Z' });
    const v49 = computeVerdict(p49, [], { now: NOW, endAt: '2026-08-26T00:00:00Z' });
    expect(v47.historical).toBeTrue();
    expect(v47.level).toBe(2);
    expect(v48.level).toBe(4);
    expect(v49.level).toBe(2);
    expect(v47.early).toBeFalse();
  });

  it('a young patch with daily samples: 4.10 at day 10 → 3, early', () => {
    const p410 = patch('4.10', '2026-08-26T14:15:00Z', { hotfix_thread_id: 2, hotfix_slug: 'hf' });
    const samples = [
      sample('4.10', '2026-09-04', { rn_replies: 70, hf_replies: 240, top_ticket_share: 0.2, top_ticket_vote_share: 0.11, kb_open_total: 55 }),
      sample('4.10', '2026-09-05', { rn_replies: 78, hf_replies: 271, top_ticket_share: 0.2, top_ticket_vote_share: 0.11, kb_open_total: 55,
        hotfix_events: [{ date: '2026-09-03', build: '12572603', text: 'Client Hotfix' }] }),
    ];
    const v = computeVerdict(p410, samples, { now: NOW, endAt: null });
    expect(v.historical).toBeFalse();
    expect(v.insufficient).toBeFalse();
    expect(v.early).toBeTrue();
    expect(v.level).toBe(3);
    expect(v.days.length).toBe(2);
    // day 2 velocity = (78+271) − (70+240) = 39 replies over 1 day → band saturates
    expect(v.days[1].velocity).toBeCloseTo(39, 6);
    // the 09-03 hotfix predates the first sample → it lands on the first column, not the second
    expect(v.days[0].hotfixes.length).toBe(1);
    expect(v.days[1].hotfixes.length).toBe(0);
    expect(v.components.cig).not.toBeNull();
  });

  it('minimum-data rule: fewer than 10 replies → insufficient, no level', () => {
    const p = patch('4.11', '2026-10-01T00:00:00Z');
    const v = computeVerdict(p, [sample('4.11', '2026-10-01', { rn_replies: 3 })], { now: '2026-10-02T00:00:00Z', endAt: null });
    expect(v.insufficient).toBeTrue();
    expect(v.level).toBeNull();
    expect(v.stability).toBeNull();
    expect(v.tone).toBeNull();
  });

  it('one sample is enough once the reply floor is cleared', () => {
    const p = patch('4.11', '2026-10-01T00:00:00Z');
    const v = computeVerdict(p, [sample('4.11', '2026-10-03', { rn_replies: 40 })], { now: '2026-10-03T12:00:00Z', endAt: null });
    expect(v.insufficient).toBeFalse();
    expect(v.level).not.toBeNull();
    expect(v.early).toBeTrue();
    expect(v.stability).toBe(stabilityPercent(v.score));
    expect(v.tone).toBe(toneOf(v.level!));
  });

  // The 4.9 regression: the sampler caught that line ten days AFTER 4.10 had
  // replaced it, so it had one stray daily sample on top of a complete
  // end-state. The daily path then reported "not enough data" for a patch we
  // know everything about, and the board showed no stability at all for it.
  it('a superseded line reads its end-state even when a stray sample exists', () => {
    const p49 = patch('4.9', '2026-07-15T00:00:00Z', {
      final_replies: 98, final_outage_min_per_day: 0, final_ticket_share: 0.18, final_ticket_vote_share: 0.59,
    });
    const stray = sample('4.9', '2026-09-05', { rn_replies: 98, hf_replies: 289 });
    const v = computeVerdict(p49, [stray], { now: NOW, endAt: '2026-08-26T00:00:00Z' });
    expect(v.historical).toBeTrue();
    expect(v.insufficient).toBeFalse();
    expect(v.level).toBe(2);
    expect(v.stability).not.toBeNull();
    // …and it agrees with the same line read without the stray sample.
    expect(v.score).toBe(computeVerdict(p49, [], { now: NOW, endAt: '2026-08-26T00:00:00Z' }).score);
  });

  it('the CURRENT line still reads its daily samples, not an end-state', () => {
    const p = patch('4.10', '2026-08-26T00:00:00Z', { final_replies: 999 });
    const v = computeVerdict(p, [
      sample('4.10', '2026-09-04', { rn_replies: 70 }),
      sample('4.10', '2026-09-05', { rn_replies: 78 }),
    ], { now: NOW, endAt: null });
    expect(v.historical).toBeFalse();
    expect(v.days.length).toBe(2);
  });

  it('first sample velocity falls back to replies ÷ live days', () => {
    const p = patch('4.11', '2026-10-01T00:00:00Z');
    const v = computeVerdict(p, [
      sample('4.11', '2026-10-03', { rn_replies: 40 }),
      sample('4.11', '2026-10-04', { rn_replies: 44 }),
    ], { now: '2026-10-04T12:00:00Z', endAt: null });
    expect(v.days[0].velocity).toBeCloseTo(20, 6);
    expect(v.days[1].velocity).toBeCloseTo(4, 6);
  });
});
