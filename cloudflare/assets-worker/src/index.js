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
// copy (scripts/r2-migrate-ship-skins.mjs) has run. A 404 means "this key does
// not exist"; a 502 (no-store) means "the source is unreachable right now", so
// a client can tell a missing asset from an outage. The site does not use that
// yet: src/app/codex/fallback-image.component.ts still switches to its
// placeholder for good on any error (AUD-043).

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
  'Access-Control-Expose-Headers': 'etag, content-length, content-range, accept-ranges',
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

/**
 * One `bytes=` range against an object of `size` bytes (RFC 9110 §14).
 * null            → serve the whole object (no header, other unit, several
 *                   ranges, syntax error — a server may ignore Range);
 * 'unsatisfiable' → answer 416;
 * otherwise the exact slice to read.
 */
export function parseRange(header, size) {
  if (!header) return null;
  const m = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!m || (m[1] === '' && m[2] === '')) return null;
  if (m[1] === '') {
    // suffix form: the last n bytes
    const n = Number(m[2]);
    if (n === 0 || size === 0) return 'unsatisfiable';
    const length = Math.min(n, size);
    return { offset: size - length, length };
  }
  const start = Number(m[1]);
  if (m[2] !== '' && Number(m[2]) < start) return null; // invalid range → ignore the header
  if (start >= size) return 'unsatisfiable';
  const end = m[2] === '' ? size - 1 : Math.min(Number(m[2]), size - 1);
  return { offset: start, length: end - start + 1 };
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
    'accept-ranges': 'bytes',
  };
}

/** Headers for an object read from R2 — the 200, 206, 304 and HEAD paths share them. */
function objectHeaders(key, object) {
  const headers = new Headers(baseHeaders(key));
  object.writeHttpMetadata(headers);
  // writeHttpMetadata may carry an upload-time Content-Type; the key's
  // extension is the contract, so it wins.
  headers.set('content-type', contentTypeFor(key));
  headers.set('cache-control', CACHE_CONTROL);
  headers.set('etag', object.httpEtag);
  return headers;
}

function unsatisfiable(size) {
  return new Response('range not satisfiable', {
    status: 416,
    headers: { ...CORS, 'content-type': 'text/plain', 'content-range': `bytes */${size}` },
  });
}

function plain(status, text) {
  return new Response(text, { status, headers: { ...CORS, 'content-type': 'text/plain' } });
}

/** Upstream answers that mean "this key is not there". Anything else non-OK is an outage. */
const UPSTREAM_MISSING = new Set([400, 403, 404, 410]);
/** Deadline for the upstream's HEADERS only — a large hull's body must stream as long as the client needs. */
const UPSTREAM_HEADERS_TIMEOUT_MS = 10_000;

function unavailable() {
  return new Response('upstream unavailable', {
    status: 502,
    headers: { ...CORS, 'content-type': 'text/plain', 'cache-control': 'no-store' },
  });
}

async function fromSupabase(env, key, request) {
  const upstream = `${env.SUPABASE_URL}/storage/v1/object/public/${key}`;
  // A plain object on purpose: the tests read init.headers.range directly.
  const upstreamHeaders = {};
  const inm = request.headers.get('if-none-match');
  if (inm) upstreamHeaders['if-none-match'] = inm;
  const range = request.headers.get('range');
  if (range && request.method === 'GET') upstreamHeaders.range = range;

  // Not AbortSignal.timeout: that signal stays attached to the body and would
  // cut a slowly streamed 30 MB hull mid-transfer. The timer is cleared as soon
  // as the headers are in (or fetch threw), so it never outlives the call.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), UPSTREAM_HEADERS_TIMEOUT_MS);
  let res;
  try {
    res = await fetch(upstream, { method: request.method, headers: upstreamHeaders, signal: controller.signal });
  } catch {
    return unavailable();
  } finally {
    clearTimeout(timer);
  }

  if (res.status === 304) {
    const headers = new Headers(baseHeaders(key));
    const etag = res.headers.get('etag');
    if (etag) headers.set('etag', etag);
    return new Response(null, { status: 304, headers });
  }
  if (UPSTREAM_MISSING.has(res.status)) return plain(404, 'not found');
  if (res.status === 416) {
    const headers = { ...CORS, 'content-type': 'text/plain' };
    const cr = res.headers.get('content-range');
    if (cr) headers['content-range'] = cr;
    return new Response('range not satisfiable', { status: 416, headers });
  }
  if (!res.ok) return unavailable();

  const headers = new Headers(baseHeaders(key));
  const etag = res.headers.get('etag');
  if (etag) headers.set('etag', etag);
  const len = res.headers.get('content-length');
  if (len) headers.set('content-length', len);
  headers.set('x-sc-origin', 'supabase');
  const partial = res.status === 206;
  if (partial) {
    const cr = res.headers.get('content-range');
    if (cr) headers.set('content-range', cr);
  }
  return new Response(request.method === 'HEAD' ? null : res.body, { status: partial ? 206 : 200, headers });
}

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      return plain(405, 'method not allowed');
    }

    const key = keyFor(new URL(request.url).pathname);
    if (!key) return plain(404, 'not found');

    // A single Range is resolved here, against the object's size, and handed to
    // R2 as an explicit { offset, length }, so Content-Range is built from our
    // own numbers (R2 echoes its range with `suffix: undefined`, which once
    // produced "bytes NaN-NaN"). The extra head() only happens for Range
    // requests, which browsers do not send for .glb/.webp; the Free plan counts
    // requests, not subrequests.
    if (request.method === 'GET' && request.headers.has('range')) {
      const meta = await env.ASSETS.head(key);
      if (!meta) return fromSupabase(env, key, request);
      const range = parseRange(request.headers.get('range'), meta.size);
      if (range === 'unsatisfiable') return unsatisfiable(meta.size);
      if (range) {
        const part = await env.ASSETS.get(key, { onlyIf: request.headers, range });
        if (!part) return fromSupabase(env, key, request);
        const headers = objectHeaders(key, part);
        if (!('body' in part)) return new Response(null, { status: 304, headers });
        headers.set('content-range', `bytes ${range.offset}-${range.offset + range.length - 1}/${meta.size}`);
        headers.set('content-length', String(range.length));
        return new Response(part.body, { status: 206, headers });
      }
      // null: the header is ignored (several ranges, other unit, invalid) → 200 below.
    }

    const object =
      request.method === 'HEAD'
        ? await env.ASSETS.head(key)
        : await env.ASSETS.get(key, { onlyIf: request.headers });

    if (!object) return fromSupabase(env, key, request);

    const headers = objectHeaders(key, object);

    // A conditional GET that matched: R2 returns the object without a body.
    if (request.method === 'GET' && !('body' in object)) {
      return new Response(null, { status: 304, headers });
    }
    if (request.method === 'HEAD') {
      headers.set('content-length', String(object.size));
      return new Response(null, { status: 200, headers });
    }
    headers.set('content-length', String(object.size));
    return new Response(object.body, { status: 200, headers });
  },
};
