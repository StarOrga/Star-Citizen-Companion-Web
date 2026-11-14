import type { Mock } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { SupabaseClientProvider } from '../../core/supabase.client';
import { AuthService } from '../../auth/auth.service';
import { VerseApiService } from './verse-api.service';

interface Res {
  data: unknown;
  error: unknown;
}

/** Minimal thenable PostgREST builder: every chain method returns itself. */
function builder(res: Res, calls: { method: string; args: unknown[] }[]) {
  const b: Record<string, unknown> = {};
  for (const m of ['select', 'eq', 'limit', 'order', 'upsert', 'insert', 'maybeSingle']) {
    b[m] = (...args: unknown[]) => {
      calls.push({ method: m, args });
      return b;
    };
  }
  b['then'] = (ok: (r: Res) => unknown, fail?: (e: unknown) => unknown) => Promise.resolve(res).then(ok, fail);
  return b;
}

describe('VerseApiService', () => {
  let rpc: Mock;
  let fromRes: Res;
  let calls: { method: string; args: unknown[] }[];
  const authed = signal(true);

  beforeEach(() => {
    calls = [];
    fromRes = { data: [], error: null };
    rpc = vi.fn().mockName('rpc');
    const client = { rpc, from: (t: string) => (calls.push({ method: 'from', args: [t] }), builder(fromRes, calls)) };
    TestBed.configureTestingModule({
      providers: [
        { provide: SupabaseClientProvider, useValue: { client } },
        { provide: AuthService, useValue: { isAuthenticated: authed, user: () => ({ id: 'u1' }) } },
      ],
    });
    authed.set(true);
  });

  afterEach(() => TestBed.resetTestingModule());

  it('loads the digest via GET and exposes the ranked top list', async () => {
    rpc.mockResolvedValue({
      data: {
        generated_at: 'x',
        suggested: 3,
        items: [
          { key: 'a', kind: 'news', title: 'A', pinned: false, score: 90, rank: 1 },
          { key: 'b', kind: 'news', title: 'B', pinned: false, score: 80, rank: 2 },
          { key: 'c', kind: 'news', title: 'C', pinned: false, score: 70, rank: 3 },
          { key: 'd', kind: 'news', title: 'D', pinned: false, score: 60, rank: 4 },
        ],
        patch: null,
        counts: {},
      },
      error: null,
    });
    const svc = TestBed.inject(VerseApiService);
    await svc.loadDigest();
    expect(rpc).toHaveBeenCalledWith('verse_digest', {}, { get: true });
    expect(svc.digestState()).toBe('ready');
    expect(svc.topItems().map((i) => i.key)).toEqual(['a', 'b', 'c']);
  });

  it('renders a translated error key on a failed digest load', async () => {
    rpc.mockResolvedValue({ data: null, error: { message: 'boom', status: 500 } });
    const svc = TestBed.inject(VerseApiService);
    await svc.loadDigest();
    expect(svc.digestState()).toBe('error');
    expect(svc.digestError()).toMatch(/^errors\./);
  });

  it('marks items seen optimistically and reverts on failure', async () => {
    const svc = TestBed.inject(VerseApiService);
    fromRes = { data: null, error: null };
    expect((await svc.markSeen(['a'])).ok).toBe(true);
    expect(svc.seen().has('a')).toBe(true);
    fromRes = { data: null, error: { message: 'nope', code: '42501' } };
    const r = await svc.markSeen(['b']);
    expect(r.ok).toBe(false);
    expect(svc.seen().has('b')).toBe(false);
  });

  it('does not write seen-state when signed out', async () => {
    authed.set(false);
    const svc = TestBed.inject(VerseApiService);
    expect((await svc.markSeen(['a'])).ok).toBe(true);
    expect(calls.length).toBe(0);
  });

  it('returns null for the median before the own vote', async () => {
    rpc.mockResolvedValue({ data: null, error: null });
    const svc = TestBed.inject(VerseApiService);
    const r = await svc.predictionMedian('4.4');
    expect(rpc).toHaveBeenCalledWith('patch_prediction_median', { p_patch_line: '4.4' });
    expect(r).toEqual({ ok: true, data: null });
  });

  it('maps the median after the vote', async () => {
    rpc.mockResolvedValue({ data: { patch_line: '4.4', median: '2026-11-01', votes: 12 }, error: null });
    const r = await TestBed.inject(VerseApiService).predictionMedian('4.4');
    expect(r).toEqual({ ok: true, data: { patchLine: '4.4', median: '2026-11-01', votes: 12 } });
  });

  it('refuses a malformed prediction date without a request', async () => {
    const r = await TestBed.inject(VerseApiService).submitPrediction('4.4', '1.11.2026');
    expect(r.ok).toBe(false);
    expect(calls.length).toBe(0);
  });

  it("reads the x.y.z comet target and returns null when the RPC is missing", async () => {
    const svc = TestBed.inject(VerseApiService);
    rpc.mockResolvedValue({ data: { patch_version: "4.4.2", patch_line: "4.4", live_version: "4.4.1", comet: { state: "none", locked: false } }, error: null });
    expect((await svc.cometVersion())?.patchVersion).toBe("4.4.2");
    expect(rpc).toHaveBeenCalledWith("verse_comet_version_state");
    rpc.mockResolvedValue({ data: null, error: { message: "not found", code: "PGRST202" } });
    expect(await svc.cometVersion()).toBeNull();
  });

  it("tips an x.y.z patch via its own RPC and maps a lock refusal", async () => {
    const svc = TestBed.inject(VerseApiService);
    rpc.mockResolvedValue({ data: {}, error: null });
    expect(await svc.submitVersionPrediction("4.4.2", "2030-01-01")).toEqual({ ok: true, data: undefined });
    expect(rpc).toHaveBeenCalledWith("verse_submit_version_prediction", { p_patch_version: "4.4.2", p_date: "2030-01-01" });
    rpc.mockResolvedValue({ data: null, error: { message: "comet_locked", code: "P0001" } });
    expect(await svc.submitVersionPrediction("4.4.2", "2030-01-01")).toEqual({ ok: false, errorKey: "errors.cometLocked" });
    expect((await svc.submitVersionPrediction("4.4.2", "1.1.2030")).ok).toBe(false);
  });

  it('filters the star pool to known keys', async () => {
    rpc.mockResolvedValue({ data: ['notes', 'comet', 'cx-compare'], error: null });
    const r = await TestBed.inject(VerseApiService).starPool('4.4');
    expect(r).toEqual({ ok: true, data: ['notes', 'comet'] });
  });

  it('clears the explorer state when signed out', async () => {
    authed.set(false);
    const svc = TestBed.inject(VerseApiService);
    await svc.loadExplorer();
    expect(svc.explorer()).toBeNull();
    expect(rpc).not.toHaveBeenCalled();
  });

  it('maps the anon community aggregate (counts only)', async () => {
    rpc.mockResolvedValue({ data: { patch_line: '4.4', explorers: 3, stars: { notes: 2, bogus: 9 } }, error: null });
    const r = await TestBed.inject(VerseApiService).communityStars('4.4');
    expect(rpc).toHaveBeenCalledWith('verse_community_stars', { p_patch_line: '4.4' });
    expect(r).toEqual({ ok: true, data: { patchLine: '4.4', explorers: 3, stars: { notes: 2 } } });
  });

  describe('seen rule (shown with focus counts from the next session)', () => {
    const key = 'sc.verse.shown.u1';
    beforeEach(() => localStorage.removeItem(key));
    afterEach(() => localStorage.removeItem(key));

    it('records shown keys without marking them seen in the current session', () => {
      const svc = TestBed.inject(VerseApiService);
      svc.noteShown(['news:a', 'news:b']);
      svc.noteShown(['news:b', 'news:c']);
      expect(JSON.parse(localStorage.getItem(key) ?? '{}').keys).toEqual(['news:a', 'news:b', 'news:c']);
      expect(svc.seen().size).toBe(0);
      expect(calls.some((c) => c.method === 'upsert')).toBe(false);
    });

    it('flushes a finished session through markSeen at the next loadSeen', async () => {
      localStorage.setItem(key, JSON.stringify({ at: Date.now() - 31 * 60_000, keys: ['news:a'] }));
      fromRes = { data: [], error: null };
      const svc = TestBed.inject(VerseApiService);
      await svc.loadSeen();
      expect(calls.find((c) => c.method === 'upsert')?.args[0]).toEqual([{ item_key: 'news:a' }]);
      expect(svc.seen().has('news:a')).toBe(true);
      expect(localStorage.getItem(key)).toBeNull();
    });

    it('keeps a running session (second tab) untouched and only refreshes its clock', async () => {
      localStorage.setItem(key, JSON.stringify({ at: Date.now() - 60_000, keys: ['news:a'] }));
      const svc = TestBed.inject(VerseApiService);
      await svc.loadSeen();
      expect(calls.some((c) => c.method === 'upsert')).toBe(false);
      expect(JSON.parse(localStorage.getItem(key) ?? '{}').keys).toEqual(['news:a']);
    });

    it('does not record anything signed out', () => {
      const svc = TestBed.inject(VerseApiService);
      TestBed.inject(AuthService); // user() still returns u1 in the mock; the guard is the empty-key filter
      svc.noteShown([]);
      expect(localStorage.getItem(key)).toBeNull();
    });
  });

  describe('star events', () => {
    const state = (stars: string[], extra: Record<string, unknown> = {}) => ({
      patches: [
        {
          patch_line: '4.4',
          stars,
          star_count: stars.length,
          unlocks: { log_entry: stars.length > 0, community: stars.length >= 3, wallpaper: stars.length >= 7 },
        },
      ],
      total_stars: stars.length,
      streak: {},
      kartograph: {},
      rewards: {},
      ...extra,
    });

    it('emits lit/total and the crossed milestone after a new star', async () => {
      rpc.mockImplementation(async (fn: string) => {
        if (fn === 'verse_explorer_state')
          return { data: vi.mocked(rpc).mock.calls.some((c) => c[0] === 'verse_earn_star') ? state(['notes', 'cx-fps', 'archive']) : state(['notes', 'cx-fps']), error: null };
        return { data: true, error: null };
      });
      const svc = TestBed.inject(VerseApiService);
      const events: unknown[] = [];
      svc.starEarned$.subscribe((e) => events.push(e));
      const r = await svc.earnStar('4.4', 'archive');
      expect(r).toEqual({ ok: true, data: true });
      expect(events).toEqual([{ key: 'archive', patchLine: '4.4', lit: 3, total: 7, unlocked: ['community'] }]);
      expect(svc.lastStarEarned()?.key).toBe('archive');
    });

    it('emits nothing for an already earned star', async () => {
      rpc.mockImplementation(async (fn: string) => ({ data: fn === 'verse_explorer_state' ? state(['notes']) : false, error: null }));
      const svc = TestBed.inject(VerseApiService);
      const events: unknown[] = [];
      svc.starEarned$.subscribe((e) => events.push(e));
      await svc.earnStar('4.4', 'notes');
      expect(events).toEqual([]);
    });

    it('a right guess lights cx-guess and emits; a wrong one reveals without a star', async () => {
      let guessed = false;
      rpc.mockImplementation(async (fn: string) => {
        if (fn === 'verse_explorer_state') return { data: state(guessed ? ['cx-guess'] : []), error: null };
        guessed = true;
        return { data: { patch_line: '4.4', correct: true, answer_class: 'RSI_Zeus', answer_name: 'Zeus', star_earned: true }, error: null };
      });
      const svc = TestBed.inject(VerseApiService);
      const events: { key: string }[] = [];
      svc.starEarned$.subscribe((e) => events.push(e));
      const ok = await svc.submitGuess('4.4', 'RSI_Zeus');
      expect(rpc).toHaveBeenCalledWith('verse_guess_constellation', { p_patch_line: '4.4', p_class_name: 'RSI_Zeus' });
      expect(ok.ok && ok.data.correct).toBe(true);
      expect(events.map((e) => e.key)).toEqual(['cx-guess']);

      rpc.mockImplementation(async (fn: string) =>
        fn === 'verse_explorer_state'
          ? { data: state([]), error: null }
          : { data: { patch_line: '4.5', correct: false, answer_class: 'X', answer_name: 'X', star_earned: false }, error: null });
      await svc.submitGuess('4.5', 'Y');
      expect(events.length).toBe(1);
    });

    it('maps the tip lock and guess refusals to their own translated keys', async () => {
      rpc.mockImplementation(async (fn: string) =>
        fn === 'verse_explorer_state'
          ? { data: state([]), error: null }
          : { data: null, error: { message: 'comet_locked', code: 'P0001' } });
      const svc = TestBed.inject(VerseApiService);
      expect(await svc.submitPrediction('4.5', '2030-01-01')).toEqual({ ok: false, errorKey: 'errors.cometLocked' });
      expect(rpc).toHaveBeenCalledWith('verse_submit_prediction', { p_patch_line: '4.5', p_date: '2030-01-01' });
      rpc.mockImplementation(async (fn: string) =>
        fn === 'verse_explorer_state'
          ? { data: state([]), error: null }
          : { data: null, error: { message: 'guess_already_made', code: 'P0001' } });
      expect(await svc.submitGuess('4.5', 'A')).toEqual({ ok: false, errorKey: 'errors.guessMade' });
    });

    it('returns the options without any answer field', async () => {
      rpc.mockResolvedValue({
        data: { patch_line: '4.4', state: 'open', options: [{ class_name: 'A', name: 'Alpha' }], guessed_class: null, answer_class: null, answer_name: null },
        error: null,
      });
      const r = await TestBed.inject(VerseApiService).guessOptions('4.4');
      expect(r.ok && r.data.state).toBe('open');
      expect(r.ok && r.data.answerClass).toBeNull();
      expect(r.ok && r.data.options).toEqual([{ className: 'A', name: 'Alpha' }]);
    });

    it('relays the cx-newship verdict from the server', async () => {
      rpc.mockResolvedValue({ data: 'guess_first', error: null });
      const r = await TestBed.inject(VerseApiService).claimNewShip('4.4', 'X');
      expect(rpc).toHaveBeenCalledWith('verse_claim_newship', { p_patch_line: '4.4', p_class_name: 'X' });
      expect(r).toEqual({ ok: true, data: 'guess_first' });
    });
  });

  describe('reward ideas', () => {
    it('lists ideas and treats a missing RPC (PGRST202) as "no section"', async () => {
      const svc = TestBed.inject(VerseApiService);
      rpc.mockResolvedValue({ data: [{ id: 'a', body: 'Idea', votes: 2 }], error: null });
      const r = await svc.rankIdeas();
      expect(rpc).toHaveBeenCalledWith('verse_rank_ideas');
      expect(r.ok && r.data?.[0].votes).toBe(2);
      rpc.mockResolvedValue({ data: null, error: { code: 'PGRST202', message: 'Could not find the function' } });
      expect(await svc.rankIdeas()).toEqual({ ok: true, data: null });
      rpc.mockResolvedValue({ data: null, error: { code: 'XX000', message: 'boom' } });
      const bad = await svc.rankIdeas();
      expect(!bad.ok && bad.errorKey.startsWith('errors.')).toBe(true);
    });

    it('submits, votes and archives through their RPCs and translates the refusals', async () => {
      const svc = TestBed.inject(VerseApiService);
      rpc.mockResolvedValue({ data: 'new-id', error: null });
      expect(await svc.submitRankIdea('A paint')).toEqual({ ok: true, data: 'new-id' });
      expect(rpc).toHaveBeenCalledWith('verse_submit_rank_idea', { p_body: 'A paint' });
      rpc.mockResolvedValue({ data: { voted: true, votes: 4 }, error: null });
      expect(await svc.voteRankIdea('i1')).toEqual({ ok: true, data: { voted: true, votes: 4 } });
      expect(rpc).toHaveBeenCalledWith('verse_vote_rank_idea', { p_id: 'i1' });
      rpc.mockResolvedValue({ data: null, error: null });
      expect((await svc.archiveRankIdea('i1')).ok).toBe(true);
      expect(rpc).toHaveBeenCalledWith('verse_archive_rank_idea', { p_id: 'i1' });
      rpc.mockResolvedValue({ data: null, error: { message: 'rank_tier_too_low' } });
      expect(await svc.submitRankIdea('x')).toEqual({ ok: false, errorKey: 'errors.rankTierTooLow' });
      rpc.mockResolvedValue({ data: null, error: { message: 'rank_idea_limit' } });
      expect(await svc.submitRankIdea('x')).toEqual({ ok: false, errorKey: 'errors.rankIdeaLimit' });
    });
  });
});
