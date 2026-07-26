// uex-proxy — server-side proxy to the UEX Corp API 2.0 (https://uexcorp.space).
// The UEX bearer token lives ONLY as the `UEX_API_TOKEN` edge secret and never
// reaches the browser; the client calls this function, we attach the token and
// forward to UEX. Read-only, public shop/price/location data — used by the Codex
// "Where to buy" feature (#254). UEX data is community-crowdsourced and UEX is
// unaffiliated with CIG; the UI surfaces that caveat + attribution.
//
// JWT verification is OFF (config.toml verify_jwt=false, mirrors rsi-upcoming-ships):
// a public catalog reachable by signed-out visitors; the client sends its
// `sb_publishable_*` key, not a JWT. No user data flows through this function.
//
// Only an allow-listed set of GET resources is reachable, and only simple
// key=value filter params are forwarded — this is a narrow read proxy, never an
// open relay.

import 'jsr:@supabase/functions-js/edge-runtime.d.ts';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
};

const UEX_BASE = 'https://api.uexcorp.uk/2.0';
const UEX_TIMEOUT_MS = 12_000;
const UEX_TOKEN = Deno.env.get('UEX_API_TOKEN') ?? '';

// Read-only resources this proxy may reach. Everything the "Where to buy"
// feature needs to map an item → price → terminal → physical location. User-
// specific / write resources (user, data_submit, trades, …) are deliberately
// excluded — they are none of this feature's business.
const ALLOWED_RESOURCES = new Set<string>([
  'items',            // UEX item catalog (match our SC item → UEX id_item)
  'items_prices',     // buy/sell prices per item, references a terminal
  'categories',       // item categories (for filtering)
  'terminals',        // terminal → location (star system / planet / station)
  'cities',
  'space_stations',
  'outposts',
  'planets',
  'star_systems',
]);

// Only forward filter params whose key looks like a UEX filter (snake_case
// alnum) and whose value is a short scalar — no arbitrary passthrough.
const PARAM_KEY_RE = /^[a-z][a-z0-9_]{0,39}$/;
function safeParam(key: string, value: string): boolean {
  return PARAM_KEY_RE.test(key) && value.length <= 120 && /^[\w .,:%\-]*$/.test(value);
}

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

  const url = new URL(req.url);
  const resource = (url.searchParams.get('resource') ?? '').trim();
  if (!resource) return json({ error: 'missing "resource" query param' }, 400);
  if (!ALLOWED_RESOURCES.has(resource)) {
    return json({ error: `resource "${resource}" is not allowed`, allowed: [...ALLOWED_RESOURCES] }, 400);
  }

  // Rebuild a clean upstream query from the forwarded filter params.
  const upstream = new URL(`${UEX_BASE}/${resource}/`);
  for (const [key, value] of url.searchParams) {
    if (key === 'resource') continue;
    if (safeParam(key, value)) upstream.searchParams.append(key, value);
  }

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), UEX_TIMEOUT_MS);
  try {
    const res = await fetch(upstream.toString(), {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${UEX_TOKEN}`,
        Accept: 'application/json',
      },
      signal: ctrl.signal,
    });
    const text = await res.text();
    if (!res.ok) {
      return json({ error: 'upstream error', status: res.status, body: text.slice(0, 500) }, 502);
    }
    let data: unknown;
    try {
      data = JSON.parse(text);
    } catch {
      return json({ error: 'upstream returned non-JSON', body: text.slice(0, 500) }, 502);
    }
    // UEX responses are cacheable for a few minutes — prices move slowly and the
    // upstream rate limit is 120/min, so a short shared cache protects the token.
    return json(data, 200, 300);
  } catch (e) {
    const aborted = (e as Error)?.name === 'AbortError';
    return json({ error: aborted ? 'upstream timeout' : 'upstream fetch failed' }, 504);
  } finally {
    clearTimeout(timer);
  }
});
