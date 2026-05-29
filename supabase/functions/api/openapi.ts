// GET /openapi.json — TODO: PR 2 ships the full OpenAPI 3.1 spec.

import type { Context } from './_router.ts';
import { json } from './_router.ts';

export function serve(ctx: Context): Response {
  return json(
    { error: { code: 'not_implemented', message: 'OpenAPI spec lands in PR 2.' } },
    501,
    ctx.responseHeaders,
  );
}
