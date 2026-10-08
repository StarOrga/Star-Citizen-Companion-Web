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
  let rpc: jasmine.Spy;
  let fromRes: Res;
  let calls: { method: string; args: unknown[] }[];
  const authed = signal(true);

  beforeEach(() => {
    calls = [];
    fromRes = { data: [], error: null };
    rpc = jasmine.createSpy('rpc');
    const client = { rpc, from: (t: string) => (calls.push({ method: 'from', args: [t] }), builder(fromRes, calls)) };
    TestBed.configureTestingModule({
      providers: [
        { provide: SupabaseClientProvider, useValue: { client } },
        { provide: AuthService, useValue: { isAuthenticated: authed } },
      ],
    });
    authed.set(true);
  });

  afterEach(() => TestBed.resetTestingModule());

  it('loads the digest via GET and exposes the ranked top list', async () => {
    rpc.and.resolveTo({
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
    rpc.and.resolveTo({ data: null, error: { message: 'boom', status: 500 } });
    const svc = TestBed.inject(VerseApiService);
    await svc.loadDigest();
    expect(svc.digestState()).toBe('error');
    expect(svc.digestError()).toMatch(/^errors\./);
  });

  it('marks items seen optimistically and reverts on failure', async () => {
    const svc = TestBed.inject(VerseApiService);
    fromRes = { data: null, error: null };
    expect((await svc.markSeen(['a'])).ok).toBeTrue();
    expect(svc.seen().has('a')).toBeTrue();
    fromRes = { data: null, error: { message: 'nope', code: '42501' } };
    const r = await svc.markSeen(['b']);
    expect(r.ok).toBeFalse();
    expect(svc.seen().has('b')).toBeFalse();
  });

  it('does not write seen-state when signed out', async () => {
    authed.set(false);
    const svc = TestBed.inject(VerseApiService);
    expect((await svc.markSeen(['a'])).ok).toBeTrue();
    expect(calls.length).toBe(0);
  });

  it('returns null for the median before the own vote', async () => {
    rpc.and.resolveTo({ data: null, error: null });
    const svc = TestBed.inject(VerseApiService);
    const r = await svc.predictionMedian('4.4');
    expect(rpc).toHaveBeenCalledWith('patch_prediction_median', { p_patch_line: '4.4' });
    expect(r).toEqual({ ok: true, data: null });
  });

  it('maps the median after the vote', async () => {
    rpc.and.resolveTo({ data: { patch_line: '4.4', median: '2026-11-01', votes: 12 }, error: null });
    const r = await TestBed.inject(VerseApiService).predictionMedian('4.4');
    expect(r).toEqual({ ok: true, data: { patchLine: '4.4', median: '2026-11-01', votes: 12 } });
  });

  it('refuses a malformed prediction date without a request', async () => {
    const r = await TestBed.inject(VerseApiService).submitPrediction('4.4', '1.11.2026');
    expect(r.ok).toBeFalse();
    expect(calls.length).toBe(0);
  });

  it('filters the star pool to known keys', async () => {
    rpc.and.resolveTo({ data: ['notes', 'comet', 'cx-compare'], error: null });
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
    rpc.and.resolveTo({ data: { patch_line: '4.4', explorers: 3, stars: { notes: 2, bogus: 9 } }, error: null });
    const r = await TestBed.inject(VerseApiService).communityStars('4.4');
    expect(rpc).toHaveBeenCalledWith('verse_community_stars', { p_patch_line: '4.4' });
    expect(r).toEqual({ ok: true, data: { patchLine: '4.4', explorers: 3, stars: { notes: 2 } } });
  });

  it('inserts a suggestion and translates a refusal', async () => {
    const svc = TestBed.inject(VerseApiService);
    expect((await svc.suggest('/verse/patches/4.4', '')).ok).toBeTrue();
    expect(calls.find((c) => c.method === 'insert')?.args[0]).toEqual({ item_url: '/verse/patches/4.4', note: null });
    fromRes = { data: null, error: { code: '42501', message: 'new row violates row-level security policy' } };
    const r = await svc.suggest('/x', null);
    expect(r.ok).toBeFalse();
    expect(!r.ok && r.errorKey.startsWith('errors.')).toBeTrue();
  });
});
