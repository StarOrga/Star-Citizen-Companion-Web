// GET /v1/news — TODO: PR 2 will implement reading from news_cache.
// Concept §5 + §10 — PR 1 only wires the route. Returning 501 until the
// PR 2 implementation lands so integrators see a stable contract.

import type { Context } from '../_router.ts';
import { json } from '../_router.ts';

export function list(ctx: Context): Response {
  return json(
    { error: { code: 'not_implemented', message: 'News endpoint lands in PR 2.' } },
    501,
    ctx.responseHeaders,
  );
}
