import { TestBed } from '@angular/core/testing';
import { SupabaseClientProvider } from '../core/supabase.client';
import { FriendsService } from './friends.service';
import { FriendEdgeRow } from './friends.types';

type RpcResult = { data?: unknown; error?: { message: string } | null };

/** Scriptable RPC fake: per-function result, everything else answers "ok, no data". */
function setup(results: Record<string, RpcResult> = {}) {
  const rpc = jasmine.createSpy('rpc').and.callFake(async (fn: string) => {
    const r = results[fn] ?? {};
    return { data: r.data ?? null, error: r.error ?? null };
  });
  const client = { rpc };
  TestBed.configureTestingModule({
    providers: [{ provide: SupabaseClientProvider, useValue: { client, realClient: client } }],
  });
  return { rpc, svc: TestBed.inject(FriendsService), results };
}

const edge = (kind: FriendEdgeRow['kind'], id: string): FriendEdgeRow => ({
  kind,
  request_id: kind === 'incoming' || kind === 'outgoing' ? 'req-' + id : null,
  user_id: id,
  display_name: null,
  username: 'pilot_' + id,
  since: '2026-09-01T10:00:00Z',
});

describe('FriendsService', () => {
  it('load() groups the RPC rows into the four buckets', async () => {
    const { svc, rpc } = setup({
      list_my_friend_edges: {
        data: [edge('friend', 'a'), edge('incoming', 'b'), edge('outgoing', 'c'), edge('blocked', 'd')],
      },
    });
    await svc.load();
    expect(rpc).toHaveBeenCalledWith('list_my_friend_edges');
    expect(svc.friendCount()).toBe(1);
    expect(svc.incomingCount()).toBe(1);
    expect(svc.graph().outgoing.length).toBe(1);
    expect(svc.graph().blocked.length).toBe(1);
    expect(svc.error()).toBeNull();
    expect(svc.loading()).toBeFalse();
  });

  it('load() failure sets an i18n key, never the raw message', async () => {
    const { svc } = setup({ list_my_friend_edges: { error: { message: 'account_suspended' } } });
    await svc.load();
    expect(svc.error()).toBe('friends.error.accountSuspended');
    expect(svc.loading()).toBeFalse();
  });

  it('load() maps an unknown error to the generic key', async () => {
    const { svc } = setup({ list_my_friend_edges: { error: { message: 'relation "x" does not exist' } } });
    await svc.load();
    expect(svc.error()).toBe('friends.error.generic');
  });

  it('findByUsername trims the handle and resolves the first row', async () => {
    const { svc, rpc } = setup({
      find_user_by_username: { data: [{ user_id: 'u1', display_name: 'X', username: 'pilot' }] },
    });
    const hit = await svc.findByUsername('  pilot ');
    expect(hit?.user_id).toBe('u1');
    expect(rpc).toHaveBeenCalledWith('find_user_by_username', { handle: 'pilot' });
  });

  it('findByUsername resolves null for an empty result', async () => {
    const { svc } = setup({ find_user_by_username: { data: [] } });
    expect(await svc.findByUsername('nobody')).toBeNull();
    expect(svc.error()).toBeNull();
  });

  it('sendRequest calls send_friend_request, returns the verdict and reloads', async () => {
    const { svc, rpc } = setup({ send_friend_request: { data: 'accepted' } });
    expect(await svc.sendRequest('u9')).toBe('accepted');
    expect(rpc).toHaveBeenCalledWith('send_friend_request', { target: 'u9' });
    expect(rpc).toHaveBeenCalledWith('list_my_friend_edges');
  });

  it('sendRequest defaults a null verdict to pending', async () => {
    const { svc } = setup();
    expect(await svc.sendRequest('u9')).toBe('pending');
  });

  it('sendRequest failure returns null, sets the key and does not reload', async () => {
    const { svc, rpc } = setup({ send_friend_request: { error: { message: 'blocked' } } });
    expect(await svc.sendRequest('u9')).toBeNull();
    expect(svc.error()).toBe('friends.error.blocked');
    expect(rpc).not.toHaveBeenCalledWith('list_my_friend_edges');
    expect(svc.busy()).toBeFalse();
  });

  const mutations: {
    name: string;
    call: (s: FriendsService) => Promise<boolean>;
    fn: string;
    args: object;
  }[] = [
    { name: 'respond(accept)', call: (s) => s.respond('r1', true), fn: 'respond_friend_request', args: { request_id: 'r1', accept: true } },
    { name: 'respond(decline)', call: (s) => s.respond('r1', false), fn: 'respond_friend_request', args: { request_id: 'r1', accept: false } },
    { name: 'withdraw', call: (s) => s.withdraw('r2'), fn: 'withdraw_friend_request', args: { request_id: 'r2' } },
    { name: 'removeFriend', call: (s) => s.removeFriend('u3'), fn: 'remove_friend', args: { target: 'u3' } },
    { name: 'block', call: (s) => s.block('u4'), fn: 'block_user', args: { target: 'u4' } },
    { name: 'unblock', call: (s) => s.unblock('u4'), fn: 'unblock_user', args: { target: 'u4' } },
  ];

  for (const m of mutations) {
    it(m.name + ' calls ' + m.fn + ' and reloads the graph', async () => {
      const { svc, rpc } = setup();
      expect(await m.call(svc)).toBeTrue();
      expect(rpc).toHaveBeenCalledWith(m.fn, m.args);
      expect(rpc.calls.mostRecent().args[0]).toBe('list_my_friend_edges');
    });

    it(m.name + ' failure resolves false with an error key and no reload', async () => {
      const { svc, rpc } = setup({ [m.fn]: { error: { message: 'request_expired' } } });
      expect(await m.call(svc)).toBeFalse();
      expect(svc.error()).toBe('friends.error.requestExpired');
      expect(rpc).toHaveBeenCalledTimes(1);
    });
  }

  it('report() sends a trimmed reason (null when blank) and returns the verdict', async () => {
    const { svc, rpc } = setup({ report_user: { data: 'duplicate' } });
    expect(await svc.report('u5', 'spam', '  bot  ')).toBe('duplicate');
    expect(rpc).toHaveBeenCalledWith('report_user', { target: 'u5', category: 'spam', reason: 'bot' });
    await svc.report('u5', 'other', '   ');
    expect(rpc).toHaveBeenCalledWith('report_user', { target: 'u5', category: 'other', reason: null });
  });

  it('report() failure returns null with the key, and does not reload the graph', async () => {
    const { svc, rpc } = setup({ report_user: { error: { message: 'report_limit' } } });
    expect(await svc.report('u5', 'spam', 'x')).toBeNull();
    expect(svc.error()).toBe('friends.error.reportLimit');
    expect(rpc).toHaveBeenCalledTimes(1);
  });

  it('a successful call clears the previous error', async () => {
    const { svc, results } = setup({ block_user: { error: { message: 'user_not_found' } } });
    await svc.block('u1');
    expect(svc.error()).toBe('friends.error.userNotFound');
    delete results['block_user'];
    await svc.block('u1');
    expect(svc.error()).toBeNull();
  });
});
