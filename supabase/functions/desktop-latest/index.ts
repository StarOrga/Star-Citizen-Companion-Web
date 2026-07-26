// supabase/functions/desktop-latest
// ---------------------------------------------------------------
// Auto-update endpoint for the desktop tool.
// Returns electron-updater-compatible YAML metadata for the latest release.
//
// Replaces the originally-planned Vercel Edge-Function (concept Iter 3 § I).
// Supabase Edge avoids the interactive Vercel-setup blocker — same security
// properties (release-token-bound access, no GH-token leak into the Tool).
//
// Auth: EITHER release-token (Tool, pre-login) OR JWT+role (Web UI, logged in)
//   - `X-SC-Release-Token: <token>` → validated against `desktop_releases.release_token`
//     (any active release token grants read of the latest release metadata)
//   - `Authorization: Bearer <jwt>` → user role must be admin/collaborator
//   Token check first; JWT only if no token header was sent.
//
// Products: `?product=uploader` (default) or `?product=starscape`. Starscape is
// the native Rust tray app, which shares this feed but is public-by-design:
//   - its binaries are public GitHub-mirror assets,
//   - so ANY signed-in role may read it (the SQL resolver clamps the channel to
//     the caller's tier anyway), and an unauthenticated request is served as
//     'viewer' → stable. That lets a fresh install see a stable update before
//     the user has ever signed in, without weakening the uploader's gate.
//
// Deploy with --no-verify-jwt because release-token requests have no JWT.
//
// Input:  GET
//         Accept: application/yaml → electron-updater-format (default for Tool)
//         Accept: application/json → human-readable (default for UI, and the
//                 format the Starscape Rust updater parses)
// Output: 200 (yaml or json based on Accept)
//         401 unauthorized
//         403 forbidden — not collaborator+ (uploader JWT path only)
//         404 no_release

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, accept',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
};

const CHANNELS = new Set(['alpha', 'beta', 'stable']);
const PRODUCTS = new Set(['uploader', 'starscape']);

/** Resolve the requested release channel from path suffix or ?channel=. */
function resolveChannel(req: Request): string {
  const url = new URL(req.url);
  const q = url.searchParams.get('channel');
  if (q && CHANNELS.has(q)) return q;
  // electron-updater requests `<feed>/<channel>.yml`; `latest.yml` = legacy stable.
  const last = url.pathname.split('/').pop() ?? '';
  const stem = last.replace(/\.ya?ml$/i, '');
  return CHANNELS.has(stem) ? stem : 'stable';
}

/**
 * Which product's rings to resolve. Defaults to 'uploader' so every existing
 * electron-updater client keeps its exact behaviour — `desktop_channels` is
 * keyed `(product, channel)` since the Starscape-channels migration, and an
 * unfiltered channel lookup would now match more than one row.
 */
function resolveProduct(req: Request): string {
  const q = new URL(req.url).searchParams.get('product') ?? '';
  return PRODUCTS.has(q) ? q : 'uploader';
}

interface ReleaseRow {
  id: string;
  version: string;
  platforms: Record<
    string,
    {
      url: string;
      size_bytes: number;
      sha512?: string;
      sha256?: string;
      kind?: string;
    }
  >;
  notes: string | null;
  created_at: string;
}

function jsonResp(body: unknown, status = 200, extraHeaders: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...CORS, ...extraHeaders },
  });
}

/**
 * electron-updater "generic" provider expects a `latest.yml` file like:
 *
 *   version: 0.2.0
 *   files:
 *     - url: data-uploader-setup-0.2.0-x64.exe
 *       sha512: <hex>
 *       size: 81875966
 *   path: data-uploader-setup-0.2.0-x64.exe
 *   sha512: <hex>
 *   releaseDate: '2026-05-23T20:00:00.000Z'
 *
 * The `sha512` key is HARDCODED in electron-updater's YAML parser. The
 * value MUST be a real SHA-512 — admin populates
 * `desktop_releases.platforms[*].sha512`. Older rows (pre-2026-05-24)
 * only had `sha256` and were missing real SHA-512; we fall back to sha256
 * for backward compat but log a warning so the admin re-uploads. New
 * rows produced by the admin RPC always have sha512.
 */
function toLatestYaml(release: ReleaseRow): string {
  const winSetup = release.platforms['win-x64-setup'] ?? release.platforms['win-x64'];
  if (!winSetup) {
    return `version: ${release.version}\nfiles: []\nreleaseDate: '${release.created_at}'\n`;
  }
  const hash = winSetup.sha512 ?? winSetup.sha256 ?? '';
  if (!winSetup.sha512 && winSetup.sha256) {
    console.warn(
      `[desktop-latest] release ${release.id} has only sha256, no sha512 — ` +
        `electron-updater verification WILL fail. Re-register with a real sha512sum.`,
    );
  }
  const fileName = winSetup.url.split('/').pop() ?? 'unknown.exe';
  return [
    `version: ${release.version}`,
    'files:',
    `  - url: ${winSetup.url}`,
    `    sha512: ${hash}`,
    `    size: ${winSetup.size_bytes}`,
    `path: ${fileName}`,
    `sha512: ${hash}`,
    `releaseDate: '${release.created_at}'`,
  ].join('\n') + '\n';
}

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS });
  if (req.method !== 'GET') return jsonResp({ error: 'method_not_allowed' }, 405, { Allow: 'GET, OPTIONS' });

  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

  const releaseToken = req.headers.get('x-sc-release-token');
  const authHeader = req.headers.get('authorization');
  const product = resolveProduct(req);

  // --- Starscape: the role clamp is ALWAYS authoritative ---------------------
  // Starscape's ring is locked at download time and cannot be changed in-app, so
  // the ONLY thing keeping a viewer off beta/alpha is the SQL clamp. The release
  // token therefore must not act as a channel bypass the way it does for the
  // uploader (where the ring is a user-chosen, role-gated setting): here it is
  // only proof of a known, non-revoked build, plus the kill switch for a leaked
  // one. Whatever auth is present decides the tier; none at all means viewer.
  if (product === 'starscape') {
    if (releaseToken) {
      if (!serviceKey) return jsonResp({ error: 'service_misconfigured' }, 500);
      const adminClient = createClient(supabaseUrl, serviceKey);
      const { data: tokenRow } = await adminClient
        .from('desktop_releases')
        .select('id')
        .eq('release_token', releaseToken)
        .eq('product', 'starscape')
        .eq('token_revoked', false)
        .maybeSingle();
      if (!tokenRow) return jsonResp({ error: 'invalid_or_revoked_release_token' }, 401);
    }
    // An Authorization header that does not resolve to a user is not fatal —
    // an expired JWT simply degrades to the anonymous (stable) view instead of
    // failing the silent background check with a 401.
    const client = authHeader
      ? createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: authHeader } } })
      : createClient(supabaseUrl, anonKey);
    return await respondForChannel(client, req, resolveChannel(req), true, 'starscape');
  }

  // --- Auth path 1: release-token (Tool, pre-login) ---
  if (releaseToken) {
    if (!serviceKey) return jsonResp({ error: 'service_misconfigured' }, 500);
    const adminClient = createClient(supabaseUrl, serviceKey);
    // Token validity is decoupled from is_current ON PURPOSE. Gating on
    // is_current here (as this used to) meant that the instant a newer release
    // was registered — flipping older rows to is_current=false via
    // dr_dedupe_current — every already-installed older build's baked token got
    // 401'd and could NEVER auto-update. So we accept any KNOWN, non-revoked
    // release token and then serve the CURRENT release below. token_revoked is
    // the explicit kill-switch for a leaked token (preserves the intent of the
    // Codex 2026-05-24 HIGH 1 finding) without self-defeating the updater.
    // Scope the token to its own product: a Starscape token must not unlock the
    // uploader's rings (and vice versa) now that both share this feed.
    const { data: tokenRow } = await adminClient
      .from('desktop_releases')
      .select('id')
      .eq('release_token', releaseToken)
      .eq('product', product)
      .eq('token_revoked', false)
      .maybeSingle();
    if (!tokenRow) return jsonResp({ error: 'invalid_or_revoked_release_token' }, 401);
    // Token valid → serve the requested channel's pointer. No server-side role
    // clamp on the token path: binaries are public (GitHub mirror) and the
    // channel picker is UI-gated per role; the token only proves "a known build".
    return await respondForChannel(adminClient, req, resolveChannel(req), false, product);
  }

  // --- Auth path 2: JWT + role (Web UI) ---
  if (!authHeader) return jsonResp({ error: 'unauthorized' }, 401);
  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
  });
  const {
    data: { user },
    error: authErr,
  } = await userClient.auth.getUser();
  if (authErr || !user) return jsonResp({ error: 'unauthorized' }, 401);

  const { data: profile } = await userClient
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .maybeSingle();
  if (!profile || !['admin', 'collaborator'].includes((profile as { role?: string }).role ?? '')) {
    return jsonResp({ error: 'forbidden' }, 403);
  }

  // Role known here → clamp the requested channel to the caller's tier.
  return await respondForChannel(userClient, req, resolveChannel(req), true, product);
});

async function respondForChannel(
  client: ReturnType<typeof createClient>,
  req: Request,
  channel: string,
  clamp: boolean,
  product: string,
): Promise<Response> {
  let release: ReleaseRow | null = null;
  if (clamp) {
    // Role-clamped resolver (security-definer RPC decides the effective channel).
    const rpc = product === 'starscape' ? 'starscape_release_for_channel' : 'desktop_release_for_channel';
    const { data, error } = await client.rpc(rpc, { p_channel: channel });
    if (error) return jsonResp({ error: 'query_failed', message: error.message }, 500);
    release = ((Array.isArray(data) ? data[0] : data) as unknown as ReleaseRow) ?? null;
  } else {
    // Service client (token path) — read the channel pointer directly. The
    // product filter is REQUIRED: `desktop_channels` is keyed (product, channel),
    // so an unfiltered lookup matches one row per product and maybeSingle() errors.
    const { data, error } = await client
      .from('desktop_channels')
      .select('desktop_releases!inner(id, version, platforms, notes, created_at)')
      .eq('channel', channel)
      .eq('product', product)
      .maybeSingle();
    if (error) return jsonResp({ error: 'query_failed', message: error.message }, 500);
    release = (data as { desktop_releases?: ReleaseRow } | null)?.desktop_releases ?? null;
  }
  if (!release) return jsonResp({ error: 'no_release' }, 404);

  const accept = (req.headers.get('accept') ?? '').toLowerCase();
  if (accept.includes('yaml') || accept.includes('yml')) {
    return new Response(toLatestYaml(release), {
      status: 200,
      headers: {
        'content-type': 'application/yaml; charset=utf-8',
        // RFC 9111: make caching intentional on the most-polled endpoint. Private
        // (never shared) because the JWT path clamps the response to the caller's
        // role — a shared cache could serve one role's channel pointer to another.
        'cache-control': 'private, max-age=60',
        ...CORS,
      },
    });
  }

  // Default: JSON for human/UI consumption
  return jsonResp(
    {
      version: release.version,
      notes: release.notes,
      releaseDate: release.created_at,
      platforms: release.platforms,
      channel,
      product,
    },
    200,
    { 'cache-control': 'private, max-age=60' },
  );
}
