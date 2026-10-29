import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { AuthService } from '../auth/auth.service';
import { SupabaseClientProvider } from '../core/supabase.client';
import { PatchStabilityVotesService, toVoteAggregate } from './patch-stability-votes.service';

const STATE = {
  w_stabil: 1, w_wackelig: 30, w_instabil: 0, sum_w: 31, sum_w2: 31, votes: 40,
  own_verdict: 'wackelig', own_next_change_at: '2026-10-30T10:00:00Z',
};

interface Opts {
  rpc?: { data: unknown; error: { message: string } | null };
  upsertError?: { message: string } | null;
  userId?: string | null;
}

function setup(opts: Opts) {
  const upserts: unknown[] = [];
  const client = {
    rpc: async () => opts.rpc ?? { data: [STATE], error: null },
    from: () => ({ upsert: async (row: unknown) => { upserts.push(row); return { error: opts.upsertError ?? null }; } }),
  };
  TestBed.configureTestingModule({
    providers: [
      { provide: SupabaseClientProvider, useValue: { client } },
      { provide: AuthService, useValue: { user: signal(opts.userId === null ? null : { id: opts.userId ?? 'u1' }) } },
    ],
  });
  return { service: TestBed.inject(PatchStabilityVotesService), upserts };
}

describe('PatchStabilityVotesService', () => {
  afterEach(() => TestBed.resetTestingModule());

  it('maps the RPC row to a camelCase aggregate with the own vote', async () => {
    const { service } = setup({});
    await service.load('4.3');
    expect(service.aggregate()?.votes).toBe(40);
    expect(service.own()).toEqual({ verdict: 'wackelig', nextChangeAt: '2026-10-30T10:00:00Z' });
    expect(service.correctionFor(60)?.state).toBe('confirmed');
    expect(service.error()).toBeNull();
  });

  it('a failing load sets an error key and keeps no aggregate', async () => {
    const { service } = setup({ rpc: { data: null, error: { message: 'boom' } } });
    await service.load('4.3');
    expect(service.error()).toMatch(/^errors\./);
    expect(service.aggregate()).toBeNull();
  });

  it('castVote upserts and reloads', async () => {
    const { service, upserts } = setup({});
    expect(await service.castVote('4.3', 'instabil')).toBe('ok');
    expect(upserts).toEqual([{ user_id: 'u1', patch_line: '4.3', verdict: 'instabil' }]);
    expect(service.aggregate()).not.toBeNull();
  });

  it('castVote maps the DB 12 h refusal to too-soon', async () => {
    const { service } = setup({ upsertError: { message: 'vote_change_too_soon' } });
    expect(await service.castVote('4.3', 'stabil')).toBe('too-soon');
    expect(service.error()).toBeNull();
  });

  it('castVote reports other failures', async () => {
    const { service } = setup({ upsertError: { message: 'nope' } });
    expect(await service.castVote('4.3', 'stabil')).toBe('error');
    expect(service.error()).toMatch(/^errors\./);
  });

  it('castVote refuses a signed-out caller without a request', async () => {
    const { service, upserts } = setup({ userId: null });
    expect(await service.castVote('4.3', 'stabil')).toBe('signed-out');
    expect(upserts.length).toBe(0);
  });
});

describe('toVoteAggregate', () => {
  it('zero-fills an empty row and drops an unknown own verdict', () => {
    const a = toVoteAggregate({ ...STATE, own_verdict: 'x' });
    expect(a.ownVerdict).toBeNull();
    expect(a.ownNextChangeAt).toBeNull();
    expect(toVoteAggregate(null).sumW).toBe(0);
  });
});
