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

/**
 * Content-addressed 3D package objects (ingest-skins package_sign): the sha256
 * of the bytes IS the name, so a key never changes content. `_hulls` is the same
 * kind of key and matches KEY_RE already; `_manifests/<sha>.json` is the one
 * shape KEY_RE cannot express (json).
 */
const MANIFEST_RE = /^ship-skins\/_manifests\/[0-9a-f]{64}\.json$/;
const IMMUTABLE_RE = /^ship-skins\/(_hulls|_parts|_interiors)\/[0-9a-f]{64}\.glb$|^ship-skins\/_manifests\/[0-9a-f]{64}\.json$|^ship-skins\/_blueprints\/[0-9a-f]{64}\.svg$/;

/**
 * Blueprint drawings (ingest-skins blueprint_sign, data-uploader/docs/blueprint.md):
 * `ship-skins/_blueprints/<sha>.svg`, content-addressed like the hulls. They exist
 * only in R2 (never in the Supabase bucket), so a miss is a plain 404. Served
 * with a CSP that forbids everything an opened SVG document could run or load;
 * the site itself parses the file and never injects it.
 */
const BLUEPRINT_RE = /^ship-skins\/_blueprints\/[0-9a-f]{64}\.svg$/;
const SVG_CSP = "default-src 'none'; style-src 'unsafe-inline'; sandbox";

/**
 * Cached news images (fetch-verse-news): `news-images/<source hash>/<variant>.<ext>`,
 * e.g. `<hash>/w800.webp` or the older `<hash>/cover.jpg`. Same short cache as
 * ship-skins (a re-cache overwrites the key); a key R2 lacks is streamed from
 * the public Supabase bucket `news-images`. A segment may not start with a dot,
 * so `..` cannot traverse.
 */
const NEWS_RE = /^news-images\/(?:[A-Za-z0-9_-][A-Za-z0-9_.-]*\/){0,3}[A-Za-z0-9_-][A-Za-z0-9_.-]*\.(webp|jpe?g|png|gif|avif)$/;

const CONTENT_TYPES = {
  glb: 'model/gltf-binary',
  webp: 'image/webp',
  json: 'application/json',
  svg: 'image/svg+xml',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  gif: 'image/gif',
  avif: 'image/avif',
};

/**
 * Codex localization shards (ingest-catalog _locale-shards.ts, 2026-10-03):
 * `codex-locale/<build uuid>/<lang>/index.json` names the current generation,
 * `codex-locale/<build uuid>/<lang>/<gen>/<shard>.json` never changes content.
 * They exist only in R2, so a miss is a plain 404, never a Supabase proxy.
 */
const LOCALE_DIR = String.raw`codex-locale\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/[A-Za-z]{2,3}(-[A-Za-z0-9]{2,4})?`;
const LOCALE_INDEX_RE = new RegExp(String.raw`^${LOCALE_DIR}\/index\.json$`);
const LOCALE_SHARD_RE = new RegExp(String.raw`^${LOCALE_DIR}\/[0-9a-z]{6,16}\/[a-z0-9_]{1,24}-\d{1,4}\.json$`);
/** A republish points the index at a new generation, so it must not stick for long. */
const LOCALE_INDEX_CACHE_CONTROL = 'public, max-age=300';

function isLocaleKey(key) {
  return LOCALE_INDEX_RE.test(key) || LOCALE_SHARD_RE.test(key);
}

/**
 * Paths are NOT versioned — a re-upload overwrites the same key — so the cache
 * lifetime stays short and revalidation goes through the ETag.
 */
const CACHE_CONTROL = 'public, max-age=3600, stale-while-revalidate=86400';
/** Content-addressed keys can be cached for good. */
const IMMUTABLE_CACHE_CONTROL = 'public, max-age=31536000, immutable';

function cacheControlFor(key) {
  if (LOCALE_INDEX_RE.test(key)) return LOCALE_INDEX_CACHE_CONTROL;
  if (LOCALE_SHARD_RE.test(key)) return IMMUTABLE_CACHE_CONTROL;
  return IMMUTABLE_RE.test(key) ? IMMUTABLE_CACHE_CONTROL : CACHE_CONTROL;
}

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
  return KEY_RE.test(key) || MANIFEST_RE.test(key) || BLUEPRINT_RE.test(key) || isLocaleKey(key) || NEWS_RE.test(key)
    ? key
    : null;
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
    'cache-control': cacheControlFor(key),
    'x-content-type-options': 'nosniff',
    'accept-ranges': 'bytes',
    ...(BLUEPRINT_RE.test(key) ? { 'content-security-policy': SVG_CSP } : {}),
  };
}

/** Headers for an object read from R2 — the 200, 206, 304 and HEAD paths share them. */
function objectHeaders(key, object) {
  const headers = new Headers(baseHeaders(key));
  object.writeHttpMetadata(headers);
  // writeHttpMetadata may carry an upload-time Content-Type; the key's
  // extension is the contract, so it wins.
  headers.set('content-type', contentTypeFor(key));
  headers.set('cache-control', cacheControlFor(key));
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

/**
 * Public Supabase bucket a key falls back to: the key's first segment
 * (`ship-skins`, `news-images`). null = R2 only (codex-locale), no fallback.
 */
export function fallbackBucket(key) {
  if (BLUEPRINT_RE.test(key)) return null;
  const bucket = key.slice(0, key.indexOf('/'));
  return bucket === 'ship-skins' || bucket === 'news-images' ? bucket : null;
}

async function fromSupabase(env, key, request) {
  const bucket = fallbackBucket(key);
  if (!bucket) return plain(404, 'not found');
  const upstream = `${env.SUPABASE_URL}/storage/v1/object/public/${bucket}/${key.slice(bucket.length + 1)}`;
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
