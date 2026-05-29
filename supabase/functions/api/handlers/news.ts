// GET /v1/news — read from news_cache.
// Concept §5: pre-aggregated cache populated by pg_cron (cron job lands in a
// follow-up — see TODO at bottom).
//
// Query:
//   ?source=comm-link|spectrum|youtube|patch   (optional filter)
//
// Response shape:
//   { data: [{ source, title, url, thumbnail, published_at }],
//     meta: { count, patch_version, cached_at } }

import type { Context } from '../_router.ts';
import { json } from '../_router.ts';

const VALID_SOURCES = new Set(['comm-link', 'spectrum', 'youtube', 'patch']);

export async function list(ctx: Context): Promise<Response> {
  const source = ctx.url.searchParams.get('source');
  if (source && !VALID_SOURCES.has(source)) {
    return json(
      { error: { code: 'invalid_source', message: `Unknown source "${source}".` } },
      400,
      ctx.responseHeaders,
    );
  }

  const ninetyDaysAgo = new Date(Date.now() - 90 * 86400 * 1000).toISOString();

  let query = ctx.supabase
    .from('news_cache')
    .select('source, title, url, thumbnail, published_at, fetched_at')
    .gte('published_at', ninetyDaysAgo)
    .order('published_at', { ascending: false })
    .limit(50);

  if (source) query = query.eq('source', source);

  const { data, error } = await query;
  if (error) {
    return json(
      { error: { code: 'query_failed', message: error.message } },
      500,
      ctx.responseHeaders,
    );
  }

  // Patch version + cached_at meta — best-effort, missing data isn't fatal.
  const { data: livePatch } = await ctx.supabase
    .from('patch_versions')
    .select('version')
    .eq('channel', 'live')
    .maybeSingle();

  const cachedAt = data && data.length > 0
    ? (data as Array<{ fetched_at: string }>).reduce(
        (max, row) => (row.fetched_at > max ? row.fetched_at : max),
        (data[0] as { fetched_at: string }).fetched_at,
      )
    : null;

  if (livePatch?.version) {
    ctx.responseHeaders.set('X-Patch-Version', livePatch.version);
  }
  ctx.responseHeaders.set('X-Cache', data && data.length > 0 ? 'HIT' : 'MISS');

  return json(
    {
      data: (data ?? []).map((row) => ({
        source: row.source,
        title: row.title,
        url: row.url,
        thumbnail: row.thumbnail,
        published_at: row.published_at,
      })),
      meta: {
        count: data?.length ?? 0,
        patch_version: livePatch?.version ?? null,
        cached_at: cachedAt,
      },
    },
    200,
    ctx.responseHeaders,
  );
}
