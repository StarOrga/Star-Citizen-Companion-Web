// commodity-prices — read-only commodity price proxy over the UEX Corp API 2.0
// (`commodities_prices`, `commodities`). Same secret and pattern as uex-proxy:
// the bearer token lives ONLY as the `UEX_API_TOKEN` edge secret, never in the
// repo or the client bundle. UEX data is community-crowdsourced; every response
// carries `source: 'uex'`, `fetchedAt` and a per-price `updatedAt` (UEX's own
// `date_modified`), and is cached (isolate TTL + Cache-Control) to protect the
// upstream rate limit.
//
// Queries: `?list=commodities` or `?id_commodity=<int>`. Nothing else is forwarded.
// verify_jwt=false (config.toml): public data, signed-out visitors may read it.

import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { CACHE_SECONDS, TtlCache, normalizeCommodities, normalizePrices, upstreamFor } from './prices.ts';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
};
const UEX_BASE = 'https://api.uexcorp.uk/2.0';
const UEX_TIMEOUT_MS = 12_000;
const UEX_TOKEN = Deno.env.get('UEX_API_TOKEN') ?? '';
const cache = new TtlCache<unknown>(CACHE_SECONDS * 1000);

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS });
  const json = (body: unknown, status = 200, cacheSeconds = 0) =>
    new Response(JSON.stringify(body), {
      status,
      headers: {
        ...CORS_HEADERS,
        'Content-Type': 'application/json',
        ...(cacheSeconds > 0 ? { 'Cache-Control': `public, max-age=${cacheSeconds}` } : {}),
      },
    });

  if (req.method !== 'GET') return json({ error: 'method not allowed' }, 405);
  if (!UEX_TOKEN) return json({ error: 'server not configured (UEX token missing)' }, 503);

  const params = new URL(req.url).searchParams;
  const upstream = upstreamFor(UEX_BASE, params);
  if (!upstream) return json({ error: 'expected ?list=commodities or ?id_commodity=<int>' }, 400);

  const key = upstream.toString();
  const hit = cache.get(key, Date.now());
  if (hit) return json(hit, 200, CACHE_SECONDS);

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), UEX_TIMEOUT_MS);
  try {
    const res = await fetch(key, {
      headers: { Authorization: `Bearer ${UEX_TOKEN}`, Accept: 'application/json' },
      signal: ctrl.signal,
    });
    const text = await res.text();
    if (!res.ok) return json({ error: 'upstream error', status: res.status }, 502);
    let data: { data?: unknown };
    try {
      data = JSON.parse(text);
    } catch {
      return json({ error: 'upstream returned non-JSON' }, 502);
    }
    const body = params.get('list') === 'commodities'
      ? { source: 'uex', fetchedAt: new Date().toISOString(), cacheSeconds: CACHE_SECONDS, commodities: normalizeCommodities(data?.data) }
      : normalizePrices(data?.data, new Date());
    cache.set(key, body, Date.now());
    return json(body, 200, CACHE_SECONDS);
  } catch (e) {
    return json({ error: (e as Error)?.name === 'AbortError' ? 'upstream timeout' : 'upstream fetch failed' }, 504);
  } finally {
    clearTimeout(timer);
  }
});
