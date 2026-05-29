// GET /v1/patch — TODO: PR 2 will read from patch_versions.

import type { Context } from '../_router.ts';
import { json } from '../_router.ts';

export function get(ctx: Context): Response {
  return json(
    { error: { code: 'not_implemented', message: 'Patch endpoint lands in PR 2.' } },
    501,
    ctx.responseHeaders,
  );
}
