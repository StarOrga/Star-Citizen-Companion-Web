// GET /docs — TODO: PR 2 ships Scalar HTML + embed snippet.

import type { Context } from './_router.ts';
import { json } from './_router.ts';

export function serve(ctx: Context): Response {
  return json(
    { error: { code: 'not_implemented', message: 'Docs UI lands in PR 2.' } },
    501,
    ctx.responseHeaders,
  );
}
