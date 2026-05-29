// Bearer-token authentication middleware.
// Concept §1: tokens are sha256(plaintext) hex, prefixed "scc_live_*".
// Concept §4: scopes are resource-level (news:read, ships:read, ...).
//
// On match:
//   - Validates the route's required scope against token.scopes
//     ("*:read" or "admin:tokens" are accepted as wildcards where applicable)
//   - Touches last_used_at (fire-and-forget update — failure does not block)
//   - Attaches the token row to ctx for downstream handlers + the rate limiter
//
// On miss / expired: 401 with a stable error code.

import type { ApiTokenRow, Context, Middleware } from './_router.ts';
import { json } from './_router.ts';

const BEARER_PREFIX = /^Bearer\s+/i;

/** Hex sha256 of an arbitrary string using the Web Crypto API. */
export async function sha256Hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const hash = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Returns true when the token carries a scope that satisfies the requirement.
 *   - `news:read`  satisfies `news:read`
 *   - `*:read`     satisfies any `*:read` requirement
 *   - `admin:tokens` is exact-match only
 */
export function hasScope(tokenScopes: readonly string[], required: string): boolean {
  if (!required) return true;
  if (tokenScopes.includes(required)) return true;
  if (required.endsWith(':read') && tokenScopes.includes('*:read')) return true;
  return false;
}

export const authMiddleware: Middleware = async (ctx: Context, next) => {
  // Public routes (announced via options.public) skip this middleware entirely
  // — see Router.handler(). But we still get called for /v1/tokens (session-auth
  // path) — those handlers do their own JWT check, so we let them through when
  // no Bearer header is present AND the route is the token-mgmt endpoint.
  const isTokenMgmt = ctx.url.pathname.startsWith('/v1/tokens');

  const authHeader = ctx.req.headers.get('authorization') ?? '';
  const hasBearer = BEARER_PREFIX.test(authHeader);

  if (!hasBearer) {
    if (isTokenMgmt) return next(); // token handlers verify the session JWT themselves
    return json(
      { error: { code: 'unauthorized', message: 'Missing Bearer token.' } },
      401,
      ctx.responseHeaders,
    );
  }

  const plaintext = authHeader.replace(BEARER_PREFIX, '').trim();
  if (!plaintext || !plaintext.startsWith('scc_')) {
    // For /v1/tokens, the Bearer header carries the Supabase session JWT
    // (eyJ…), NOT an API token. The handler verifies it via getUser().
    if (isTokenMgmt) return next();
    return json(
      { error: { code: 'unauthorized', message: 'Malformed API token.' } },
      401,
      ctx.responseHeaders,
    );
  }

  const tokenHash = await sha256Hex(plaintext);
  const { data, error } = await ctx.supabase
    .from('api_tokens')
    .select('id, owner_user_id, name, prefix, token_hash, scopes, created_at, last_used_at, revoked_at')
    .eq('token_hash', tokenHash)
    .is('revoked_at', null)
    .maybeSingle();

  if (error || !data) {
    return json(
      { error: { code: 'unauthorized', message: 'Invalid or revoked token.' } },
      401,
      ctx.responseHeaders,
    );
  }

  ctx.token = data as ApiTokenRow;

  // Scope check (only when the route declares one). Token-mgmt route uses
  // admin:tokens scope OR session-JWT path — for this branch we treat session
  // path separately in the handler.
  if (ctx.requiredScope && !hasScope(ctx.token.scopes, ctx.requiredScope)) {
    return json(
      {
        error: {
          code: 'forbidden_scope',
          message: `Token lacks required scope "${ctx.requiredScope}".`,
        },
      },
      403,
      ctx.responseHeaders,
    );
  }

  // Fire-and-forget last_used_at touch. We deliberately don't await — the
  // request-level rate-limit log INSERT will hit the same row group within
  // a few ms anyway, and a failed update should never gate the request.
  ctx.supabase
    .from('api_tokens')
    .update({ last_used_at: new Date().toISOString() })
    .eq('id', ctx.token.id)
    .then(() => null);

  return next();
};
