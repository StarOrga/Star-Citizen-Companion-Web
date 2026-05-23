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

  // === Find previous active bundle of same channel/patch family for diff ===
  const { data: prev } = await adminClient
    .from('p4k_bundles')
    .select('id')
    .eq('channel', channel)
    .eq('patch_version', patch)
    .eq('disabled', false)
    .neq('build_number', build) // not the same build
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  const prevId = (prev as { id: string } | null)?.id ?? null;

  // === Insert bundle ===
  const { data: inserted, error: insertErr } = await adminClient
    .from('p4k_bundles')
    .insert({
      uploaded_by: user.id,
      channel,
      patch_version: patch,
      build_number: build,
      schema_version: body.schema_version ?? 1,
      quality_score: body.quality_score ?? null,
      entity_counts: body.entity_counts ?? {},
      manifest: body.manifest ?? {},
      data_url: null, // future: signed URL after large-blob upload to storage
      tool_version: body.tool_version ?? null,
    })
    .select('id')
    .single();

  if (insertErr) {
    if (insertErr.code === '23505') {
      return json({ error: 'duplicate', message: 'Bundle for this channel/patch/build/user already exists' }, 409);
    }
    return json({ error: 'insert_failed', message: insertErr.message }, 500);
  }

  const newId = (inserted as { id: string }).id;

  // === Compute diff vs. previous bundle ===
  let diffSummary: unknown = null;
  if (prevId) {
    const { data: diff } = await adminClient.rpc('diff_bundle', {
      prev_id: prevId,
      new_id: newId,
    });
    diffSummary = diff;
    if (diff) {
      await adminClient
        .from('p4k_bundles')
        .update({ diff_summary: diff })
        .eq('id', newId);
    }
  }

  return json({
    ok: true,
    bundle_id: newId,
    prev_bundle_id: prevId,
    diff_summary: diffSummary,
  });
});
