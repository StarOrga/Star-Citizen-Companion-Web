import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * The token triple a desktop hand-off posts to the app's loopback.
 * `expires_at` is UNIX seconds as a string — the apps `Number()`-parse it.
 */
export interface DesktopHandoffSession {
  access_token: string;
  refresh_token: string;
  expires_at: string;
}

/**
 * Mint a session that belongs to the desktop app alone.
 *
 * Handing an app the browser's own `refresh_token` puts two clients on one
 * GoTrue session and therefore one rotation chain, so whoever refreshes second
 * presents a spent token. Measured on this project (2026-08-30) that is not
 * currently what signs anyone out — a spent token was still accepted past the
 * 10 s reuse window — so this is hardening against a race that reuse-detection
 * would turn into a daily sign-out, not the fix for the reported one (that lives
 * in the Rust app's session store). The `desktop-session` edge function issues
 * an independent session for the same account, which rotates on its own and,
 * with the project's `sessions_timebox = 0`, does not expire.
 *
 * Returns `null` on any failure, and the caller then falls back to posting the
 * browser session as before. That fallback is deliberate: the hand-off is the
 * ONLY way to connect a desktop app, and it must not become unusable because a
 * single edge function is down or not deployed yet. Falling back reproduces
 * today's behaviour, never something worse.
 *
 * Pass the REAL, session-bearing client — never an impersonation proxy.
 */
export async function mintDesktopSession(
  client: SupabaseClient,
): Promise<DesktopHandoffSession | null> {
  try {
    const { data, error } = await client.functions.invoke('desktop-session', {
      method: 'POST',
      body: {},
    });
    if (error) {
      console.warn('[desktop-session] mint failed, falling back to the browser session', error);
      return null;
    }
    const minted = data as Partial<Record<'access_token' | 'refresh_token', string>> & {
      expires_at?: number | string | null;
    } | null;
    // A half-filled response is a failed mint: without the refresh token the
    // app would be signed out again in an hour, which is the bug we are fixing.
    if (!minted?.access_token || !minted?.refresh_token) {
      console.warn('[desktop-session] mint returned no usable session — falling back');
      return null;
    }
    return {
      access_token: minted.access_token,
      refresh_token: minted.refresh_token,
      expires_at: minted.expires_at != null ? String(minted.expires_at) : '',
    };
  } catch (e) {
    console.warn('[desktop-session] mint threw, falling back to the browser session', e);
    return null;
  }
}
