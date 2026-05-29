// GET /v1/ships — TODO: PR 2 will return the stub envelope; ingestion follow-up.

import type { Context } from '../_router.ts';
import { json } from '../_router.ts';

export function list(ctx: Context): Response {
  return json(
    { error: { code: 'not_implemented', message: 'Ships endpoint lands in PR 2.' } },
    501,
    ctx.responseHeaders,
  );
}
