// sc-assets — public read path for the Cloudflare R2 assets bucket
// (storage plan 2026-09-24).
//
// Why a Worker and not a public bucket: the r2.dev URL is rate-limited and
// meant for development, and a custom R2 domain needs a zone on Cloudflare
// DNS, which the project does not have. A Worker on *.workers.dev needs
// neither, and its Free plan HARD-STOPS at 100k requests/day (error 1027,
// never a bill), which caps R2 reads below the free Class-B allowance. R2 has
// no spending cap of its own, so this Worker is the read-side cost guard.
//
// Serves GET/HEAD for an allowlisted key shape only. Anything the bucket does
// not hold yet is proxied (streamed, not copied) from the Supabase bucket it
// is migrating away from, so the site can switch to this host before the bulk
// copy (scripts/r2-migrate-ship-skins.mjs) has run.

/** `ship-skins/<ship_id>/<skin_id>.<glb|webp>` — the exact paths ingest-skins derives. */
const KEY_RE = /^ship-skins\/[A-Za-z0-9_-]+\/[A-Za-z0-9_-]+\.(glb|webp)$/;

const CONTENT_TYPES = { glb: 'model/gltf-binary', webp: 'image/webp' };

/**
 * Paths are NOT versioned — a re-upload overwrites the same key — so the cache
 * lifetime stays short and revalidation goes through the ETag.
 */
const CACHE_CONTROL = 'public, max-age=3600, stale-while-revalidate=86400';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
  'Access-Control-Allow-Headers': 'range, if-none-match, if-modified-since',
  'Access-Control-Expose-Headers': 'etag, content-length, content-range',
  'Access-Control-Max-Age': '86400',
};

/** Object key for a request path, or null when the path is not servable. */
export function keyFor(pathname) {
  let key;
  try {
    key = decodeURIComponent(pathname.replace(/^\/+/, ''));
  } catch {
    return null;
  }
  return KEY_RE.test(key) ? key : null;
}

function contentTypeFor(key) {
  return CONTENT_TYPES[key.slice(key.lastIndexOf('.') + 1)] ?? 'application/octet-stream';
}

function baseHeaders(key) {
  return {
    ...CORS,
    'content-type': contentTypeFor(key),
    'cache-control': CACHE_CONTROL,
    'x-content-type-options': 'nosniff',
  };
}

function plain(status, text) {
  return new Response(text, { status, headers: { ...CORS, 'content-type': 'text/plain' } });
}

async function fromSupabase(env, key, request) {
  const upstream = `${env.SUPABASE_URL}/storage/v1/object/public/${key}`;
  const res = await fetch(upstream, {
    method: request.method,
    headers: request.headers.get('if-none-match')
      ? { 'if-none-match': request.headers.get('if-none-match') }
      : {},
  });
  if (res.status === 304) return new Response(null, { status: 304, headers: baseHeaders(key) });
  if (!res.ok) return plain(404, 'not found');
  const headers = new Headers(baseHeaders(key));
  const etag = res.headers.get('etag');
  if (etag) headers.set('etag', etag);
  const len = res.headers.get('content-length');
  if (len) headers.set('content-length', len);
  headers.set('x-sc-origin', 'supabase');
  return new Response(request.method === 'HEAD' ? null : res.body, { status: 200, headers });
}

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      return plain(405, 'method not allowed');
    }

    const key = keyFor(new URL(request.url).pathname);
    if (!key) return plain(404, 'not found');

    const object =
      request.method === 'HEAD'
        ? await env.ASSETS.head(key)
        : await env.ASSETS.get(key, { onlyIf: request.headers, range: request.headers });

    if (!object) return fromSupabase(env, key, request);

    const headers = new Headers(baseHeaders(key));
    object.writeHttpMetadata(headers);
    // writeHttpMetadata may carry an upload-time Content-Type; the key's
    // extension is the contract, so it wins.
    headers.set('content-type', contentTypeFor(key));
    headers.set('cache-control', CACHE_CONTROL);
    headers.set('etag', object.httpEtag);

    // A conditional GET that matched: R2 returns the object without a body.
    if (request.method === 'GET' && !('body' in object)) {
      return new Response(null, { status: 304, headers });
    }
    if (request.method === 'HEAD') {
      headers.set('content-length', String(object.size));
      return new Response(null, { status: 200, headers });
    }
    if (object.range && request.headers.has('range')) {
      const r = object.range;
      const offset = 'suffix' in r ? object.size - r.suffix : (r.offset ?? 0);
      const length = 'suffix' in r ? r.suffix : (r.length ?? object.size - offset);
      headers.set('content-range', `bytes ${offset}-${offset + length - 1}/${object.size}`);
      headers.set('content-length', String(length));
      return new Response(object.body, { status: 206, headers });
    }
    headers.set('content-length', String(object.size));
    return new Response(object.body, { status: 200, headers });
  },
};
