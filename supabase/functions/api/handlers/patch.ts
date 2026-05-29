// GET /v1/patch — current LIVE / PTU / EPTU patch versions.
// Concept §6: single source of truth comes from the RSI Comm-Link API
// `patch_version` field. A future cron job will populate the table; until then
// the endpoint returns whatever is in `patch_versions` (potentially nulls).

import type { Context } from '../_router.ts';
import { json } from '../_router.ts';

export async function get(ctx: Context): Promise<Response> {
  const { data, error } = await ctx.supabase
    .from('patch_versions')
    .select('channel, version, detected_at');

  if (error) {
    return json(
      { error: { code: 'query_failed', message: error.message } },
      500,
      ctx.responseHeaders,
    );
  }

  const byChannel = Object.fromEntries(
    (data ?? []).map((row) => [row.channel as string, row]),
  );

  const payload = {
    data: {
      live: byChannel['live']?.version ?? null,
      ptu: byChannel['ptu']?.version ?? null,
      eptu: byChannel['eptu']?.version ?? null,
    },
    meta: {
      detected_at: {
        live: byChannel['live']?.detected_at ?? null,
        ptu: byChannel['ptu']?.detected_at ?? null,
        eptu: byChannel['eptu']?.detected_at ?? null,
      },
    },
  };

  if (byChannel['live']?.version) {
    ctx.responseHeaders.set('X-Patch-Version', String(byChannel['live'].version));
  }
  ctx.responseHeaders.set('X-Cache', data && data.length > 0 ? 'HIT' : 'MISS');

  return json(payload, 200, ctx.responseHeaders);
}
