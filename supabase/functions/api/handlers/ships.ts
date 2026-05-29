// GET /v1/ships?patch=X — ship roster for a given patch version.
//
// STUB: the underlying ship-data ingestion pipeline is not yet built. The
// concept (§10, PR roadmap) lists "Ship/component data per patch must be
// versioned separately" as an open follow-up. Until that lands we return an
// empty data array + a meta.message explaining the state.
//
// FOLLOW-UP — populate this endpoint once we have:
//   1. A ship-data source (p4k extraction OR a curated public dataset)
//   2. A `ships` table keyed by (patch_version, ship_id)
//   3. A cron or upload pipeline keeping it fresh per channel
//
// Until then the endpoint stays live (so tokens with ships:read remain valid)
// but signals to integrators that data is forthcoming.

import type { Context } from '../_router.ts';
import { json } from '../_router.ts';

export async function list(ctx: Context): Promise<Response> {
  const patch = ctx.url.searchParams.get('patch') ?? null;

  // Pull the live patch for X-Patch-Version header reporting
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
        message: 'Ship data ingestion pending — see roadmap.',
      },
    },
    200,
    ctx.responseHeaders,
  );
}
