// supabase/functions/ingest-bundle
// ---------------------------------------------------------------
// Bundle upload from the desktop tool. Validates auth + release-token,
// inserts the bundle row, computes diff vs. previous bundle of same
// (channel, patch) family, returns the diff_summary.
//
// Input:  POST { channel, patch_version, build_number, schema_version,
//                quality_score, entity_counts, manifest, data?, tool_version }
//         Headers: Authorization: Bearer <jwt>
//                  X-SC-Release-Token: <uuid>
// Output: 200 { ok: true, bundle_id, diff_summary }
//         400 { error: 'invalid_body' | 'invalid_release_token' }
//         401 { error: 'unauthorized' }
//         403 { error: 'forbidden' | 'unknown_release_token' }
//         409 { error: 'duplicate', existing_id }

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';

interface IngestBody {
  channel?: string;
  patch_version?: string;
  build_number?: string;
  schema_version?: number;
  quality_score?: number;
  entity_counts?: Record<string, number>;
  manifest?: unknown;
  data?: unknown;
  tool_version?: string;
}

const ALLOWED_CHANNELS = new Set(['live', 'ptu', 'eptu', 'tech-preview']);

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type, x-sc-release-token, x-sc-tool-version',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...CORS },
  });
}

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);

  const authHeader = req.headers.get('authorization');
  const releaseToken = req.headers.get('x-sc-release-token');
  if (!authHeader) return json({ error: 'unauthorized' }, 401);
  if (!releaseToken) return json({ error: 'missing_release_token' }, 400);

  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  if (!supabaseUrl || !anonKey || !serviceKey) {
    return json({ error: 'server_misconfigured' }, 500);
  }

  // === Auth + role gate ===
  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
  });
  const {
    data: { user },
    error: authErr,
  } = await userClient.auth.getUser();
  if (authErr || !user) return json({ error: 'unauthorized' }, 401);
  const { data: profile } = await userClient
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .maybeSingle();
  if (!profile || !['admin', 'collaborator'].includes((profile as { role?: string }).role ?? '')) {
    return json({ error: 'forbidden' }, 403);
  }

  // === Release-token validation ===
  const adminClient = createClient(supabaseUrl, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data: release } = await adminClient
    .from('desktop_releases')
    .select('id, version, is_current')
    .eq('release_token', releaseToken)
    .maybeSingle();
  if (!release) return json({ error: 'unknown_release_token' }, 403);
  if (!(release as { is_current: boolean }).is_current) {
    return json({ error: 'release_token_revoked' }, 403);
  }

  // === Parse + validate body ===
  let body: IngestBody;
  try {
    body = (await req.json()) as IngestBody;
  } catch {
    return json({ error: 'invalid_json' }, 400);
  }

  const channel = (body.channel ?? '').trim().toLowerCase();
  const patch = (body.patch_version ?? '').trim();
  const build = (body.build_number ?? '').trim();
  if (!ALLOWED_CHANNELS.has(channel)) {
    return json({ error: 'invalid_body', message: 'channel must be live/ptu/eptu/tech-preview' }, 400);
  }
  if (!patch) {
    return json({ error: 'invalid_body', message: 'patch_version required' }, 400);
  }

  // === Atomic ingest via RPC ===
  // ingest_bundle_atomic does prev_id lookup + insert + diff under a
  // per-(channel, patch) advisory lock so concurrent uploads of different
  // builds in the same patch family can't both diff against the same
  // predecessor (Codex review 2026-05-24, MED 5). A re-upload of the same
  // (channel, patch, build) by the same operator either SUPERSEDES the active
  // bundle (strictly higher uploader tool_version → old row retired to history,
  // new row active) or, on an equal/lower tool_version, returns HTTP 409. The
  // RPC also enforces retention (max 3 tool-versions per build, 20 bundles
  // total) — see migration 20260614000000_bundle_supersede_retention.
  //
  // MUST call via userClient (not adminClient): the RPC is security-definer
  // and re-checks `is_collaborator()` as defense-in-depth, which reads
  // `auth.uid()`. Service-role calls have no JWT context → auth.uid() is
  // NULL → role coalesces to 'viewer' → RPC raises "forbidden". RLS is
  // already bypassed by `security definer`, so userClient is safe for
  // the INSERT side.
  const { data: rpcRows, error: rpcErr } = await userClient.rpc(
    'ingest_bundle_atomic',
    {
      p_uploader: user.id,
      p_channel: channel,
      p_patch_version: patch,
      p_build_number: build,
      p_schema_version: body.schema_version ?? 1,
      p_quality_score: body.quality_score ?? null,
      p_entity_counts: body.entity_counts ?? {},
      p_manifest: body.manifest ?? {},
      p_tool_version: body.tool_version ?? null,
    },
  );

  if (rpcErr) {
    // Postgres unique_violation = 23505. Postgrest wraps it differently
    // depending on the client version, so match on substring too.
    if (rpcErr.code === '23505' || /duplicate/i.test(rpcErr.message ?? '')) {
      return json(
        {
          error: 'duplicate',
          message:
            'A bundle with an equal or newer uploader version already exists for this channel/patch/build. Re-upload with a higher uploader version to replace it.',
        },
        409,
      );
    }
    return json({ error: 'ingest_failed', message: rpcErr.message }, 500);
  }

  const row = (Array.isArray(rpcRows) ? rpcRows[0] : rpcRows) as {
    bundle_id?: string;
    prev_bundle_id?: string | null;
    superseded_id?: string | null;
    diff_summary?: unknown;
  } | null;

  return json({
    ok: true,
    bundle_id: row?.bundle_id,
    prev_bundle_id: row?.prev_bundle_id ?? null,
    superseded_id: row?.superseded_id ?? null,
    diff_summary: row?.diff_summary ?? null,
  });
});
