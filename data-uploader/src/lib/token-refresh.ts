/**
 * Refresh a Supabase session from the persisted refresh token, so the desktop
 * tool stays connected across the ~1h access-token TTL without a new browser
 * login. Talks to GoTrue directly:
 *
 *   POST {apiBase}/auth/v1/token?grant_type=refresh_token
 *   headers: apikey: <publishable key>, authorization: Bearer <publishable key>
 *   body:    { refresh_token }
 *
 * Refresh tokens ROTATE — the response carries a fresh `refresh_token` the
 * caller MUST persist. A 400/401 (invalid_grant) means the lineage is dead →
 * the caller clears the session and surfaces a one-click reconnect.
 */

export interface RefreshResult {
  ok: boolean;
  accessToken?: string;
  refreshToken?: string;
  /** Unix seconds. */
  expiresAt?: number;
  email?: string;
  /** True when the refresh token is permanently invalid (clear + reconnect). */
  invalid?: boolean;
  error?: string;
}

type FetchLike = typeof fetch;

export async function refreshSession(
  apiBase: string,
  anonKey: string,
  refreshToken: string,
  fetchImpl: FetchLike = fetch,
): Promise<RefreshResult> {
  const endpoint = `${apiBase}/auth/v1/token?grant_type=refresh_token`;
  let res: Awaited<ReturnType<FetchLike>>;
  try {
    res = await fetchImpl(endpoint, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        apikey: anonKey,
        authorization: `Bearer ${anonKey}`,
      },
      body: JSON.stringify({ refresh_token: refreshToken }),
    });
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }

  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    // GoTrue answers 400/401 with error_description for a dead refresh token.
    const invalid = res.status === 400 || res.status === 401;
    const msg =
      (json['error_description'] as string | undefined) ??
      (json['msg'] as string | undefined) ??
      (json['error'] as string | undefined) ??
      `HTTP ${res.status}`;
    return { ok: false, invalid, error: msg };
  }

  const accessToken = json['access_token'];
  const newRefresh = json['refresh_token'];
  if (typeof accessToken !== 'string' || typeof newRefresh !== 'string') {
    return { ok: false, error: 'malformed_refresh_response' };
  }
  const expiresAt = typeof json['expires_at'] === 'number' ? (json['expires_at'] as number) : undefined;
  const user = json['user'];
  const email =
    user && typeof user === 'object' && typeof (user as { email?: unknown }).email === 'string'
      ? (user as { email: string }).email
      : undefined;

  return { ok: true, accessToken, refreshToken: newRefresh, expiresAt, email };
}
