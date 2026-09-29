import { createReadDeadlineFetch, deadlineSignal, isReadRequest, READ_RPCS } from './deadline';
import { describeError } from './describe-error';

const REST = 'https://x.supabase.test/rest/v1/';

/** A fetch that never answers but rejects with the signal's reason on abort. */
function hangingFetch(seen: RequestInit[] = []): typeof fetch {
  return (_input: RequestInfo | URL, init?: RequestInit) => {
    if (init) seen.push(init);
    return new Promise<Response>((_resolve, reject) => {
      const s = init?.signal;
      if (!s) return;
      if (s.aborted) reject(s.reason);
      s.addEventListener('abort', () => reject(s.reason), { once: true });
    });
  };
}

describe('deadline', () => {
  describe('isReadRequest', () => {
    const cases: [string, string, boolean][] = [
      ['GET', `${REST}codex_items?select=*`, true],
      ['HEAD', `${REST}codex_items?select=id`, true],
      ['get', `${REST}codex_items`, true],
      ['POST', `${REST}codex_items`, false],
      ['PATCH', `${REST}codex_items?id=eq.1`, false],
      ['DELETE', `${REST}codex_items?id=eq.1`, false],
      ['POST', `${REST}rpc/codex_armor_rating`, true],
      ['POST', `${REST}rpc/codex_armor_rating?x=1`, true],
      ['POST', `${REST}rpc/set_user_role`, false],
      ['POST', `${REST}rpc/hangar_follow_snapshot`, false],
      ['GET', 'https://other.example.com/rest/v1/codex_items', false],
      ['POST', 'https://x.supabase.test/auth/v1/token?grant_type=refresh_token', false],
      ['GET', 'https://x.supabase.test/auth/v1/user', false],
    ];
    for (const [method, url, expected] of cases) {
      it(`${method} ${url.replace(REST, '…/')} → ${expected}`, () => {
        expect(isReadRequest(method, url, REST)).toBe(expected);
      });
    }

    it('keeps the read-only RPC list at its checked size', () => {
      // A change here means an RPC was added or removed — re-check that it
      // is stable / writes nothing (see the doc comment on READ_RPCS).
      expect(READ_RPCS.size).toBe(22);
      expect(READ_RPCS.has('hangar_follow_snapshot')).toBeFalse();
    });
  });

  describe('createReadDeadlineFetch', () => {
    it('rejects a hanging read with an AbortError naming TimeoutError', async () => {
      const f = createReadDeadlineFetch(REST, 30, hangingFetch());
      const started = Date.now();
      const err = await f(`${REST}codex_items`, { method: 'GET' }).then(
        () => null,
        (e: unknown) => e as DOMException,
      );
      expect(err).not.toBeNull();
      expect(err!.name).toBe('AbortError');
      expect(err!.message).toContain('TimeoutError');
      expect(Date.now() - started).toBeLessThan(2_000);
    });

    it('passes a write through without adding a signal', async () => {
      const seen: RequestInit[] = [];
      const base = jasmine.createSpy('base').and.callFake((_i: RequestInfo | URL, init?: RequestInit) => {
        if (init) seen.push(init);
        return Promise.resolve(new Response('{}'));
      });
      const f = createReadDeadlineFetch(REST, 30, base as unknown as typeof fetch);
      const init: RequestInit = { method: 'PATCH', body: '{}' };
      await f(`${REST}codex_items?id=eq.1`, init);
      expect(base).toHaveBeenCalledTimes(1);
      expect(seen[0]).toBe(init);
      expect(seen[0].signal).toBeUndefined();
    });

    it('gives a read-only RPC a deadline signal', async () => {
      const seen: RequestInit[] = [];
      const f = createReadDeadlineFetch(REST, 30, hangingFetch(seen));
      await f(`${REST}rpc/codex_armor_rating`, { method: 'POST', body: '{}' }).catch(() => undefined);
      expect(seen[0].signal).toBeDefined();
      expect(seen[0].signal!.aborted).toBeTrue();
    });

    it('forwards a caller abort with the caller reason', async () => {
      const outer = new AbortController();
      const f = createReadDeadlineFetch(REST, 10_000, hangingFetch());
      const p = f(`${REST}codex_items`, { method: 'GET', signal: outer.signal }).then(
        () => null,
        (e: unknown) => e,
      );
      const reason = new Error('caller gave up');
      outer.abort(reason);
      expect(await p).toBe(reason);
    });

    it('honours a signal that is already aborted', async () => {
      const outer = new AbortController();
      const reason = new Error('already');
      outer.abort(reason);
      const f = createReadDeadlineFetch(REST, 10_000, hangingFetch());
      const err = await f(`${REST}codex_items`, { signal: outer.signal }).then(
        () => null,
        (e: unknown) => e,
      );
      expect(err).toBe(reason);
    });
  });

  describe('deadlineSignal', () => {
    it('aborts after the deadline with a TimeoutError message', async () => {
      const s = deadlineSignal(20);
      await new Promise<void>((r) => s.addEventListener('abort', () => r(), { once: true }));
      expect((s.reason as DOMException).name).toBe('AbortError');
      expect((s.reason as DOMException).message).toContain('TimeoutError');
    });

    it('follows the outer signal', () => {
      const outer = new AbortController();
      const s = deadlineSignal(10_000, outer.signal);
      expect(s.aborted).toBeFalse();
      outer.abort('stop');
      expect(s.aborted).toBeTrue();
      expect(s.reason).toBe('stop');
    });
  });

  it('describeError reads the postgrest-shaped deadline error as a timeout', () => {
    const postgrestShaped = {
      message: 'AbortError: TimeoutError: read deadline 20000 ms exceeded',
      details: '',
      hint: 'Request was aborted (timeout or manual cancellation)',
      code: '',
    };
    expect(describeError(postgrestShaped, true).key).toBe('errors.timeout');
  });
});
