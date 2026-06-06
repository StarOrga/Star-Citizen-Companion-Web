import { describe, it, expect } from 'vitest';
import { refreshSession } from '../src/lib/token-refresh.js';

interface Captured {
  url: string;
  init: { method?: string; headers?: Record<string, string>; body?: string };
}

function mockFetch(
  handler: (cap: Captured) => { status: number; body: unknown },
  capture?: (cap: Captured) => void,
): typeof fetch {
  return (async (url: unknown, init: unknown) => {
    const cap: Captured = { url: String(url), init: (init ?? {}) as Captured['init'] };
    capture?.(cap);
    const { status, body } = handler(cap);
    return { ok: status >= 200 && status < 300, status, json: async () => body };
  }) as unknown as typeof fetch;
}

const throwingFetch = (() => {
  throw new TypeError('network down');
}) as unknown as typeof fetch;

describe('refreshSession', () => {
  it('returns rotated tokens + expiry + email on success', async () => {
    let seen: Captured | null = null;
    const fetchImpl = mockFetch(
      () => ({
        status: 200,
        body: {
          access_token: 'new-access',
          refresh_token: 'new-refresh',
          expires_at: 1_700_000_500,
          user: { email: 'pilot@example.com' },
        },
      }),
      (cap) => (seen = cap),
    );

    const r = await refreshSession('https://api.test', 'anon-key', 'old-refresh', fetchImpl);
    expect(r).toEqual({
      ok: true,
      accessToken: 'new-access',
      refreshToken: 'new-refresh',
      expiresAt: 1_700_000_500,
      email: 'pilot@example.com',
    });
    // Sends the publishable key as apikey + the refresh token in the body.
    expect(seen!.url).toContain('grant_type=refresh_token');
    expect(seen!.init.headers?.apikey).toBe('anon-key');
    expect(seen!.init.body).toBe(JSON.stringify({ refresh_token: 'old-refresh' }));
  });

  it('flags a dead refresh token (400) as invalid', async () => {
    const fetchImpl = mockFetch(() => ({
      status: 400,
      body: { error: 'invalid_grant', error_description: 'Invalid Refresh Token' },
    }));
    const r = await refreshSession('https://api.test', 'anon-key', 'dead', fetchImpl);
    expect(r.ok).toBe(false);
    expect(r.invalid).toBe(true);
    expect(r.error).toBe('Invalid Refresh Token');
  });

  it('flags a 401 as invalid', async () => {
    const fetchImpl = mockFetch(() => ({ status: 401, body: { msg: 'unauthorized' } }));
    const r = await refreshSession('https://api.test', 'anon-key', 'x', fetchImpl);
    expect(r.ok).toBe(false);
    expect(r.invalid).toBe(true);
  });

  it('does NOT flag a 500 as invalid (transient)', async () => {
    const fetchImpl = mockFetch(() => ({ status: 500, body: {} }));
    const r = await refreshSession('https://api.test', 'anon-key', 'x', fetchImpl);
    expect(r.ok).toBe(false);
    expect(r.invalid).toBe(false);
    expect(r.error).toBe('HTTP 500');
  });

  it('rejects a malformed success body', async () => {
    const fetchImpl = mockFetch(() => ({ status: 200, body: { access_token: 'a' } }));
    const r = await refreshSession('https://api.test', 'anon-key', 'x', fetchImpl);
    expect(r.ok).toBe(false);
    expect(r.error).toBe('malformed_refresh_response');
  });

  it('surfaces a network error without throwing', async () => {
    const r = await refreshSession('https://api.test', 'anon-key', 'x', throwingFetch);
    expect(r.ok).toBe(false);
    expect(r.error).toBe('network down');
  });
});
