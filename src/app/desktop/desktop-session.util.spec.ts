import type { SupabaseClient } from '@supabase/supabase-js';
import { mintDesktopSession } from './desktop-session.util';

/** Minimal stand-in for the one client surface this util touches. */
function clientReturning(result: unknown | Error): SupabaseClient {
  const invoke =
    result instanceof Error
      ? jasmine.createSpy('invoke').and.rejectWith(result)
      : jasmine.createSpy('invoke').and.resolveTo(result);
  return { functions: { invoke } } as unknown as SupabaseClient;
}

describe('mintDesktopSession', () => {
  beforeEach(() => spyOn(console, 'warn'));

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

    await expectAsync(mintDesktopSession(client)).toBeResolvedTo({
      access_token: 'minted-jwt',
      refresh_token: 'minted-refresh',
      // The apps Number()-parse this out of the form body, so it must be a
      // string here even though Supabase hands it over as a number.
      expires_at: '1799999999',
    });
    expect(client.functions.invoke).toHaveBeenCalledWith('desktop-session', {
      method: 'POST',
      body: {},
    });
  });

  it('POSTs no identity of its own — the edge function reads it off the JWT', async () => {
    const client = clientReturning({
      data: { access_token: 'a', refresh_token: 'b', expires_at: 1 },
      error: null,
    });
    await mintDesktopSession(client);
    const [, options] = (client.functions.invoke as jasmine.Spy).calls.mostRecent().args;
    // An email in the body would be a spoofable second identity source.
    expect(options.body).toEqual({});
  });

  it('falls back (null) when the function errors, so the hand-off still works', async () => {
    const client = clientReturning({ data: null, error: new Error('boom') });
    await expectAsync(mintDesktopSession(client)).toBeResolvedTo(null);
  });

  it('falls back (null) when the function throws', async () => {
    await expectAsync(mintDesktopSession(clientReturning(new Error('offline')))).toBeResolvedTo(
      null,
    );
  });

  it('rejects a half-filled response instead of handing over a dead session', async () => {
    // No refresh token means the app is signed out again in an hour — exactly
    // the bug this function exists to fix, so it must count as a failed mint.
    const noRefresh = clientReturning({
      data: { access_token: 'only-a-jwt', expires_at: 1 },
      error: null,
    });
    await expectAsync(mintDesktopSession(noRefresh)).toBeResolvedTo(null);

    const noAccess = clientReturning({ data: { refresh_token: 'r' }, error: null });
    await expectAsync(mintDesktopSession(noAccess)).toBeResolvedTo(null);
  });

  it('tolerates a missing expires_at rather than posting "null"', async () => {
    const client = clientReturning({
      data: { access_token: 'a', refresh_token: 'b', expires_at: null },
      error: null,
    });
    // Empty string → the caller skips the field entirely; "null" would be
    // Number()-parsed to NaN and read as "already expired".
    await expectAsync(mintDesktopSession(client)).toBeResolvedTo({
      access_token: 'a',
      refresh_token: 'b',
      expires_at: '',
    });
  });
});
