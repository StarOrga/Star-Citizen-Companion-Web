import type { Mock } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { mintDesktopSession } from './desktop-session.util';
import { READ_TIMEOUT_MS } from '../core/deadline';

/** Minimal stand-in for the one client surface this util touches. */
function clientReturning(result: unknown | Error): SupabaseClient {
  const invoke =
    result instanceof Error
      ? vi.fn().mockName('invoke').mockRejectedValue(result)
      : vi.fn().mockName('invoke').mockResolvedValue(result);
  return { functions: { invoke } } as unknown as SupabaseClient;
}

describe('mintDesktopSession', () => {
  beforeEach(() => vi.spyOn(console, 'warn').mockReturnValue(undefined as never));

  it('returns the minted session, with expires_at stringified for the loopback', async () => {
    const client = clientReturning({
      data: {
        access_token: 'minted-jwt',
        refresh_token: 'minted-refresh',
        expires_at: 1799999999,
        email: 'a@b.c',
      },
      error: null,
    });

    await expect(mintDesktopSession(client)).resolves.toEqual({
      access_token: 'minted-jwt',
      refresh_token: 'minted-refresh',
      // The apps Number()-parse this out of the form body, so it must be a
      // string here even though Supabase hands it over as a number.
      expires_at: '1799999999',
    });
    expect(client.functions.invoke).toHaveBeenCalledWith('desktop-session', {
      method: 'POST',
      body: {},
      timeout: READ_TIMEOUT_MS,
    });
  });

  it('bounds the mint with the read deadline, so a hanging function cannot block the hand-off', async () => {
    const client = clientReturning({
      data: { access_token: 'a', refresh_token: 'b', expires_at: 1 },
      error: null,
    });
    await mintDesktopSession(client);
    const [, options] = vi.mocked((client.functions.invoke as Mock)).mock.lastCall!;
    expect(options.timeout).toBe(READ_TIMEOUT_MS);
  });

  it('POSTs no identity of its own — the edge function reads it off the JWT', async () => {
    const client = clientReturning({
      data: { access_token: 'a', refresh_token: 'b', expires_at: 1 },
      error: null,
    });
    await mintDesktopSession(client);
    const [, options] = vi.mocked((client.functions.invoke as Mock)).mock.lastCall!;
    // An email in the body would be a spoofable second identity source.
    expect(options.body).toEqual({});
  });

  it('falls back (null) when the function errors, so the hand-off still works', async () => {
    const client = clientReturning({ data: null, error: new Error('boom') });
    await expect(mintDesktopSession(client)).resolves.toEqual(null);
  });

  it('falls back (null) when the function throws', async () => {
    await expect(mintDesktopSession(clientReturning(new Error('offline')))).resolves.toEqual(null);
  });

  it('rejects a half-filled response instead of handing over a dead session', async () => {
    // No refresh token means the app is signed out again in an hour — exactly
    // the bug this function exists to fix, so it must count as a failed mint.
    const noRefresh = clientReturning({
      data: { access_token: 'only-a-jwt', expires_at: 1 },
      error: null,
    });
    await expect(mintDesktopSession(noRefresh)).resolves.toEqual(null);

    const noAccess = clientReturning({ data: { refresh_token: 'r' }, error: null });
    await expect(mintDesktopSession(noAccess)).resolves.toEqual(null);
  });

  it('tolerates a missing expires_at rather than posting "null"', async () => {
    const client = clientReturning({
      data: { access_token: 'a', refresh_token: 'b', expires_at: null },
      error: null,
    });
    // Empty string → the caller skips the field entirely; "null" would be
    // Number()-parsed to NaN and read as "already expired".
    await expect(mintDesktopSession(client)).resolves.toEqual({
      access_token: 'a',
      refresh_token: 'b',
      expires_at: '',
    });
  });
});
