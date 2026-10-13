import { describe, it, expect } from 'vitest';
import { createTokenBroker, type TokenBrokerDeps } from '../src/lib/token-broker.js';
import type { PersistedSession } from '../src/lib/session-store.js';
import type { RefreshResult } from '../src/lib/token-refresh.js';

const NOW = 1_800_000_000;

function session(over: Partial<PersistedSession> = {}): PersistedSession {
  return {
    accessToken: 'at-0',
    refreshToken: 'rt-0',
    email: 'pilot@example.com',
    expiresAt: NOW - 10, // stale → needs a refresh
    savedAt: NOW - 3600,
    ...over,
  };
}

function harness(initial: PersistedSession | null, refresh: (rt: string) => Promise<RefreshResult>) {
  let stored = initial;
  let cleared = 0;
  const calls: string[] = [];
  const deps: TokenBrokerDeps = {
    load: () => stored,
    save: (s) => {
      stored = s;
    },
    clear: () => {
      stored = null;
      cleared++;
    },
    refresh: (rt) => {
      calls.push(rt);
      return refresh(rt);
    },
    nowSeconds: () => NOW,
  };
  return {
    broker: createTokenBroker(deps),
    calls,
    get stored() {
      return stored;
    },
    setStored(s: PersistedSession | null) {
      stored = s;
    },
    get cleared() {
      return cleared;
    },
  };
}

describe('token broker', () => {
  it('returns a fresh stored token without refreshing', async () => {
    const h = harness(session({ expiresAt: NOW + 3600 }), async () => ({ ok: false }));
    const r = await h.broker.ensureAccessToken();
    expect(r).toEqual({ token: 'at-0', email: 'pilot@example.com', reconnect: false, retry: false });
    expect(h.calls).toEqual([]);
  });

  it('shares ONE refresh between concurrent callers (a launch after an update)', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const h = harness(session(), async () => {
      await gate;
      return { ok: true, accessToken: 'at-1', refreshToken: 'rt-1', expiresAt: NOW + 3600 };
    });
    const all = Promise.all([
      h.broker.ensureAccessToken(),
      h.broker.ensureAccessToken(),
      h.broker.ensureAccessToken(),
    ]);
    release();
    const results = await all;
    expect(h.calls).toEqual(['rt-0']);
    expect(results.map((r) => r.token)).toEqual(['at-1', 'at-1', 'at-1']);
    expect(h.stored?.refreshToken).toBe('rt-1');
  });

  it('keeps the session on a transient failure and asks to retry', async () => {
    const h = harness(session(), async () => ({ ok: false, error: 'fetch failed' }));
    const r = await h.broker.ensureAccessToken();
    expect(r).toEqual({ token: null, email: 'pilot@example.com', reconnect: false, retry: true });
    expect(h.cleared).toBe(0);
    expect(h.stored).not.toBeNull();
  });

  it('clears and asks to reconnect when the stored refresh token is rejected', async () => {
    const h = harness(session(), async () => ({ ok: false, invalid: true, error: 'Invalid Refresh Token' }));
    const r = await h.broker.ensureAccessToken();
    expect(r.reconnect).toBe(true);
    expect(r.retry).toBe(false);
    expect(h.cleared).toBe(1);
  });

  it('does not sign out when the token was rotated by someone else meanwhile', async () => {
    const h = harness(session(), async () => {
      // Another writer stored a newer session while this refresh was in flight.
      h.setStored(session({ accessToken: 'at-9', refreshToken: 'rt-9', expiresAt: NOW + 3600 }));
      return { ok: false, invalid: true, error: 'Already Used' };
    });
    const r = await h.broker.ensureAccessToken();
    expect(r).toEqual({ token: 'at-9', email: 'pilot@example.com', reconnect: false, retry: false });
    expect(h.cleared).toBe(0);
  });

  it('a sign-out during an in-flight refresh stays signed out', async () => {
    const h = harness(session(), async () => {
      h.setStored(null); // operator pressed "Abmelden" meanwhile
      return { ok: true, accessToken: 'at-1', refreshToken: 'rt-1', expiresAt: NOW + 3600 };
    });
    const r = await h.broker.ensureAccessToken();
    expect(r.token).toBeNull();
    expect(h.stored).toBeNull();
  });

  it('a new login during an in-flight refresh wins over the old lineage', async () => {
    const h = harness(session(), async () => {
      h.setStored(session({ accessToken: 'at-new', refreshToken: 'rt-new', expiresAt: NOW + 3600, email: 'other@example.com' }));
      return { ok: true, accessToken: 'at-1', refreshToken: 'rt-1', expiresAt: NOW + 3600 };
    });
    const r = await h.broker.ensureAccessToken();
    expect(r.token).toBe('at-new');
    expect(h.stored?.refreshToken).toBe('rt-new');
  });

  it('a failing write keeps the rotated pair in memory and retries it', async () => {
    let failWrites = true;
    let stored: PersistedSession | null = session();
    let refreshes = 0;
    const broker = createTokenBroker({
      load: () => stored,
      save: (s) => {
        if (failWrites) throw new Error('EBUSY');
        stored = s;
      },
      clear: () => {
        stored = null;
      },
      refresh: async () => {
        refreshes++;
        return { ok: true, accessToken: 'at-1', refreshToken: 'rt-1', expiresAt: NOW + 3600 };
      },
      nowSeconds: () => NOW,
    });
    const first = await broker.ensureAccessToken();
    expect(first.token).toBe('at-1');
    expect(stored?.refreshToken).toBe('rt-0');
    failWrites = false;
    const second = await broker.ensureAccessToken();
    expect(second.token).toBe('at-1');
    expect(stored?.refreshToken).toBe('rt-1');
    expect(refreshes).toBe(1); // the spent rt-0 was never presented again
  });

  it('forget() drops a pair that could not be written (sign-out)', async () => {
    let stored: PersistedSession | null = session();
    const broker = createTokenBroker({
      load: () => stored,
      save: () => {
        throw new Error('EPERM');
      },
      clear: () => {
        stored = null;
      },
      refresh: async () => ({ ok: true, accessToken: 'at-1', refreshToken: 'rt-1', expiresAt: NOW + 3600 }),
      nowSeconds: () => NOW,
    });
    await broker.ensureAccessToken();
    broker.forget();
    stored = null;
    const r = await broker.ensureAccessToken();
    expect(r.token).toBeNull();
  });

  it('starts a new refresh once the previous one settled', async () => {
    let n = 0;
    const h = harness(session(), async () => {
      n++;
      return { ok: false, error: 'offline' };
    });
    await h.broker.ensureAccessToken();
    await h.broker.ensureAccessToken();
    expect(n).toBe(2);
  });
});
