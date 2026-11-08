import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { AuthService } from '../auth/auth.service';
import { SupabaseClientProvider } from '../core/supabase.client';
import { ChannelBuildVotesService, isVotableChannel, toChannelBuildVotes } from './channel-build-votes.service';
import { MIN_EFFECTIVE_VOTES } from './patch-stability';

const NOW = Date.parse('2026-11-02T12:00:00Z');

const PTU = {
  channel: 'ptu', version: '4.10.3', line: '4.10', wave: 2, thread_first_at: '2026-10-29T12:00:00Z', replies: 296,
  ticket_share: '0.24', ticket_vote_share: '0.3',
  w_stabil: 2, w_wackelig: 1, w_instabil: 0, sum_w: 3, sum_w2: 3, votes: 3,
  own_verdict: 'stabil', own_next_change_at: '2026-11-03T00:00:00Z',
};
const HOTFIX = { ...PTU, channel: 'hotfix', version: '4.3.2', line: '4.3', wave: null, own_verdict: null, own_next_change_at: null };

interface Opts {
  rpc?: { data: unknown; error: { message: string } | null };
  upsertError?: { message: string } | null;
  userId?: string | null;
}

function setup(opts: Opts = {}) {
  const upserts: unknown[] = [];
  const conflicts: unknown[] = [];
  let rpcCalls = 0;
  const client = {
    rpc: async () => { rpcCalls++; return opts.rpc ?? { data: [HOTFIX, PTU], error: null }; },
    from: () => ({
      upsert: async (row: unknown, o: unknown) => { upserts.push(row); conflicts.push(o); return { error: opts.upsertError ?? null }; },
    }),
  };
  TestBed.configureTestingModule({
    providers: [
      { provide: SupabaseClientProvider, useValue: { client } },
      { provide: AuthService, useValue: { user: signal(opts.userId === null ? null : { id: opts.userId ?? 'u1' }) } },
    ],
  });
  return { service: TestBed.inject(ChannelBuildVotesService), upserts, conflicts, rpcCalls: () => rpcCalls };
}

describe('ChannelBuildVotesService', () => {
  afterEach(() => TestBed.resetTestingModule());

  it('Evocati is never votable', () => {
    expect(isVotableChannel('ptu')).toBe(true);
    expect(isVotableChannel('hotfix')).toBe(true);
    expect(isVotableChannel('evocati')).toBe(false);
    expect(toChannelBuildVotes({ ...PTU, channel: 'evocati' }, NOW)).toBeNull();
  });

  it('maps a row: the build stability from its raw numbers, the aggregate and the own vote', () => {
    const b = toChannelBuildVotes(PTU, NOW)!;
    expect(b.channel).toBe('ptu');
    expect(b.wave).toBe(2);
    expect(b.stability).not.toBeNull();
    expect(b.aggregate.ownVerdict).toBe('stabil');
    expect(b.aggregate.votes).toBe(3);
  });

  it('a build without ticket data has no stability', () => {
    expect(toChannelBuildVotes({ ...PTU, ticket_share: null }, NOW)!.stability).toBeNull();
  });

  it('ensure loads once and serves both builds by line', async () => {
    const { service, rpcCalls } = setup();
    service.ensure();
    service.ensure();
    await service.load();
    expect(rpcCalls()).toBe(2); // ensure once + the explicit load
    expect(service.forLine('4.10').map((b) => b.version)).toEqual(['4.10.3']);
    expect(service.forLine('4.3').map((b) => b.channel)).toEqual(['hotfix']);
    expect(service.forLine('4.9')).toEqual([]);
  });

  it('below the minimum effective votes there is no correction', async () => {
    const { service } = setup();
    await service.load();
    const c = service.correctionFor('ptu', '4.10.3', 50)!;
    expect(c.nEff).toBeLessThan(MIN_EFFECTIVE_VOTES);
    expect(c.state).toBe('too-few');
    expect(c.correction).toBe(0);
  });

  it('blind per build: without an own vote until revealed', async () => {
    const { service } = setup();
    await service.load();
    expect(service.blind('ptu', '4.10.3')).toBe(false);
    expect(service.blind('hotfix', '4.3.2')).toBe(true);
    service.reveal('hotfix', '4.3.2');
    expect(service.blind('hotfix', '4.3.2')).toBe(false);
  });

  it('castVote upserts on the build key', async () => {
    const { service, upserts, conflicts } = setup();
    expect(await service.castVote('ptu', '4.10.3', 'instabil')).toBe('ok');
    expect(upserts).toEqual([{ user_id: 'u1', channel: 'ptu', version: '4.10.3', verdict: 'instabil' }]);
    expect(conflicts).toEqual([{ onConflict: 'user_id,channel,version' }]);
  });

  it('maps the DB refusals', async () => {
    for (const [msg, res] of [['vote_change_too_soon', 'too-soon'], ['vote_daily_cap', 'daily-cap'], ['vote_build_not_running', 'closed']] as const) {
      const { service } = setup({ upsertError: { message: msg } });
      expect(await service.castVote('ptu', '4.10.3', 'stabil')).toBe(res);
      expect(service.error()).toBeNull();
      TestBed.resetTestingModule();
    }
  });

  it('signed out: no write', async () => {
    const { service, upserts } = setup({ userId: null });
    expect(await service.castVote('ptu', '4.10.3', 'stabil')).toBe('signed-out');
    expect(upserts).toEqual([]);
  });

  it('a failing load is an error key, not "no builds"', async () => {
    const { service } = setup({ rpc: { data: null, error: { message: 'boom' } } });
    await service.load();
    expect(service.error()).toMatch(/^errors\./);
    expect(service.builds()).toBeNull();
  });
});
