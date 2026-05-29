// Postgres-backed sliding-window rate limiter.
// Concept §3 — chose Postgres over Upstash to keep the data path in-region
// (eu-central-1) and avoid a second vendor for the alpha phase.
//
// Algorithm:
//   1. Count rows in api_request_log where token_hash matches AND ts > now()-1min
//   2. If count >= LIMIT → return 429 with Retry-After
//   3. Otherwise run handler, then INSERT a log row post-response
//
// Tradeoffs:
//   - Sliding window without a Redis SET means the count can race slightly
//     under burst load — acceptable while we target <100 req/s.
//   - Header values reflect the pre-handler count (so X-RateLimit-Remaining
//     can be 1 off when the request itself races a concurrent one).

import type { Context, Middleware } from './_router.ts';
import { json } from './_router.ts';

const DEFAULT_LIMIT = Number(Deno.env.get('API_RATE_LIMIT_PER_MIN') ?? '60');
const WINDOW_SECONDS = 60;

function setRateHeaders(ctx: Context, limit: number, remaining: number, resetEpochSec: number): void {
  ctx.responseHeaders.set('X-RateLimit-Limit', String(limit));
  ctx.responseHeaders.set('X-RateLimit-Remaining', String(Math.max(0, remaining)));
  ctx.responseHeaders.set('X-RateLimit-Reset', String(resetEpochSec));
}

export const rateLimitMiddleware: Middleware = async (ctx: Context, next) => {
  // Public + session-authed routes (token mgmt) bypass the bearer-rate-limiter.
  if (!ctx.token) return next();

  const now = Date.now();
  const windowStart = new Date(now - WINDOW_SECONDS * 1000).toISOString();
  const resetEpochSec = Math.ceil((now + WINDOW_SECONDS * 1000) / 1000);

  const { count, error } = await ctx.supabase
    .from('api_request_log')
    .select('token_hash', { count: 'exact', head: true })
    .eq('token_hash', ctx.token.token_hash)
    .gte('ts', windowStart);

  if (error) {
    // Fail-open: log and let the request through. Better than locking out
    // legitimate clients because of a transient DB hiccup.
    console.error('rate_limit_query_failed', { err: error.message });
    setRateHeaders(ctx, DEFAULT_LIMIT, DEFAULT_LIMIT, resetEpochSec);
    return next();
  }

  const used = count ?? 0;
  const remaining = DEFAULT_LIMIT - used - 1;
  setRateHeaders(ctx, DEFAULT_LIMIT, remaining, resetEpochSec);

  if (used >= DEFAULT_LIMIT) {
    ctx.responseHeaders.set('Retry-After', String(WINDOW_SECONDS));
    return json(
      { error: { code: 'rate_limited', message: 'Too many requests. Try again shortly.' } },
      429,
      ctx.responseHeaders,
    );
  }

  const response = await next();

  // Post-handler logging — fire-and-forget so a write hiccup doesn't block.
  ctx.supabase
    .from('api_request_log')
    .insert({
      token_hash: ctx.token.token_hash,
      ts: new Date().toISOString(),
      endpoint: ctx.endpoint,
      status: response.status,
    })
    .then(() => null);

  return response;
};
