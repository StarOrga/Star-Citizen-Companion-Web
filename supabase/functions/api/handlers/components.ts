// GET /v1/components?patch=X — component catalog for a given patch.
//
// STUB — same situation as ships.ts. The component ingestion pipeline doesn't
// exist yet (p4k extraction is parked in `desktop-tool/` for the desktop tool
// itself but isn't yet feeding a server-side table per patch). Returns an empty
// array with an explanatory meta message so the contract is honored.
//
// FOLLOW-UP:
//   1. Decide source: p4k bundles (via desktop tool uploads) vs. external
//   2. Schema: components (patch_version, component_id, ...spec fields)
//   3. Cron / upload pipeline

import type { Context } from '../_router.ts';
import { json } from '../_router.ts';

export async function list(ctx: Context): Promise<Response> {
  const patch = ctx.url.searchParams.get('patch') ?? null;

  const { data: livePatch } = await ctx.supabase
    .from('patch_versions')
    .select('version')
    .eq('channel', 'live')
    .maybeSingle();

  const effectivePatch = patch ?? livePatch?.version ?? null;
  if (effectivePatch) {
    ctx.responseHeaders.set('X-Patch-Version', effectivePatch);
  }
  ctx.responseHeaders.set('X-Cache', 'MISS');

  return json(
    {
      data: [],
      meta: {
        patch_version: effectivePatch,
        message: 'Component data ingestion pending — see roadmap.',
      },
    },
    200,
    ctx.responseHeaders,
  );
}
