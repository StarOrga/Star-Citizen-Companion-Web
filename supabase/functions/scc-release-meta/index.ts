// supabase/functions/scc-release-meta
// ---------------------------------------------------------------
// Public GET: version + installer size of the SCC App alias release
// (`scc-app-latest` on the binaries repo). The Apps menu used to ask
// api.github.com from every browser (60 req/h per IP, unauthenticated);
// this proxy asks once per isolate per 10 minutes instead.
//
// Output: 200 {version, sizeBytes} - both null when GitHub is unreachable or
//         the release has no readable data (the menu then shows a bare row).
// Optional secret GITHUB_TOKEN raises GitHub's limit; never required.
// Deploy with --no-verify-jwt (public, see config.toml).

import { parseSccRelease, type SccReleaseMeta } from './_parse.ts';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, accept',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
};

const RELEASE_API =
  'https://api.github.com/repos/StarOrga/Star-Citizen-Companion-Binaries/releases/tags/scc-app-latest';
const TTL_MS = 10 * 60 * 1000;
const FAIL_TTL_MS = 60 * 1000;

let cache: { at: number; ttl: number; meta: SccReleaseMeta } | null = null;

async function fetchMeta(): Promise<{ meta: SccReleaseMeta; ok: boolean }> {
  const headers: Record<string, string> = {
    Accept: 'application/vnd.github+json',
    'User-Agent': 'verse-companion-scc-release-meta',
  };
  const token = Deno.env.get('GITHUB_TOKEN');
  if (token) headers.Authorization = `Bearer ${token}`;
  try {
    const res = await fetch(RELEASE_API, { headers, signal: AbortSignal.timeout(8000) });
    if (!res.ok) return { meta: { version: null, sizeBytes: null }, ok: false };
    return { meta: parseSccRelease(await res.json()), ok: true };
  } catch {
    return { meta: { version: null, sizeBytes: null }, ok: false };
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  if (req.method !== 'GET') return new Response('method_not_allowed', { status: 405, headers: CORS });

  const now = Date.now();
  if (!cache || now - cache.at > cache.ttl) {
    const { meta, ok } = await fetchMeta();
    // A failure is remembered briefly so a GitHub outage is not hammered per request.
    cache = { at: now, ttl: ok ? TTL_MS : FAIL_TTL_MS, meta };
  }
  return new Response(JSON.stringify(cache.meta), {
    status: 200,
    headers: {
      ...CORS,
      'Content-Type': 'application/json',
      'Cache-Control': `public, max-age=${Math.floor(cache.ttl / 1000)}`,
    },
  });
});
