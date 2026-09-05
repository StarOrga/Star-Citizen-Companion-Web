import { buildVerdicts } from './patch-stability.service';
import { StabilityPatchRow, StabilitySampleRow } from './patch-stability';

const row = (line: string, liveAt: string, replies: number): StabilityPatchRow => ({
  patch_line: line, live_at: liveAt, notes_thread_id: 1, notes_slug: 's', hotfix_thread_id: null, hotfix_slug: null,
  cig_fixes: null, cig_fixes_ic: null, cig_crash_fixes: null, cig_exploit_fixes: null,
  final_replies: replies, final_outage_min_per_day: 0, final_ticket_share: 0.1, final_ticket_vote_share: 0.1,
});
const smp = (line: string, on: string, replies: number): StabilitySampleRow => ({
  patch_line: line, sampled_on: on, rn_replies: replies, rn_votes: 0, hf_replies: null, hf_votes: null,
  top_ticket_share: 0, top_ticket_vote_share: 0, top_tickets: [], hotfix_events: [], outage_min_7d: 0, open_incident: false,
  kb_open_total: null, kb_by_section: null, kb_anchor_ids: null, kb_edited_at: null,
});

describe('buildVerdicts', () => {
  it('windows each line up to the next line’s live date and only the newest is early', () => {
    const verdicts = buildVerdicts(
      [row('4.9', '2026-07-15T00:00:00Z', 300), row('4.10', '2026-08-26T00:00:00Z', 0)],
      [smp('4.10', '2026-09-04', 60), smp('4.10', '2026-09-05', 78)],
      '2026-09-05T12:00:00Z',
    );
    const v49 = verdicts.get('4.9')!;
    const v410 = verdicts.get('4.10')!;
    expect(v49.daysLive).toBeCloseTo(42, 6);
    expect(v49.historical).toBeTrue();
    expect(v49.early).toBeFalse();
    expect(v410.historical).toBeFalse();
    expect(v410.early).toBeTrue();
  });
});
