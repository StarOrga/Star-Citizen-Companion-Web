// supabase/functions/ingest-skins
// ---------------------------------------------------------------
// Ship-skin (3D livery) ingest from the desktop data-uploader. Same auth shape
// as ingest-bundle (user JWT + release-token + admin/collaborator role), but
// the heavy glb/webp assets never travel through this function: we hand the
// client short-lived *signed upload URLs* so it PUTs each object straight into
// the public `ship-skins` bucket. The desktop binary therefore needs NO
// service-role secret — the service role lives only here, server-side.
//
// Two actions:
//   POST { action:'sign',   ship_id, objects:[{skin_id, ext:'glb'|'webp'}] }
//        -> 200 { uploads:[{path, token, signedUrl}] }
//   POST { action:'commit', ship_id, skins:[{skin_id, name, description?,
//          source?, name_verified?, has_model, has_icon, model_bytes?, sort?}] }
//        -> 200 { ok:true, count }
//
// Object paths are ALWAYS derived server-side from validated ids
// (`<ship_id>/<skin_id>.<ext>`) — the client never supplies a storage path,
// so a malicious client can't traverse the bucket.
//
//   400 invalid_json | invalid_body | unsafe_id
//   401 unauthorized
//   403 forbidden | unknown_release_token | release_token_revoked
//   500 server_misconfigured | sign_failed | commit_failed

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';

const BUCKET = 'ship-skins';
const SAFE_ID = /^[A-Za-z0-9_-]+$/;
const ALLOWED_SOURCES = new Set(['store', 'event', 'subscriber', 'factory', 'pu_npc']);

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

interface SkinRowIn {
  skin_id?: string;
  name?: string;
  description?: string;
  source?: string;
  name_verified?: boolean;
  has_model?: boolean;
  has_icon?: boolean;
  model_bytes?: number;
  sort?: number;
}

interface Body {
  action?: 'sign' | 'commit';
  ship_id?: string;
  objects?: { skin_id?: string; ext?: string }[];
  skins?: SkinRowIn[];
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

  // === Auth + role gate (mirrors ingest-bundle) ===
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
  // is_current was dropped by the desktop-channels migration; validity is now a
  // known + non-revoked token (mirrors desktop-latest / ingest-bundle). A query
  // error surfaces as 500 rather than masquerading as an unknown token.
  const { data: release, error: relErr } = await adminClient
    .from('desktop_releases')
    .select('id, token_revoked')
    .eq('release_token', releaseToken)
    // product='uploader' only — the Starscape tray app bakes a release token into
    // a public, unsigned binary, so an unscoped match would accept it here too.
    .eq('product', 'uploader')
    .maybeSingle();
  if (relErr) return json({ error: 'server_misconfigured', message: relErr.message }, 500);
  if (!release) return json({ error: 'unknown_release_token' }, 403);
  if ((release as { token_revoked: boolean }).token_revoked) {
    return json({ error: 'release_token_revoked' }, 403);
  }

  // === Body ===
  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return json({ error: 'invalid_json' }, 400);
  }

  const shipId = (body.ship_id ?? '').trim();
  if (!SAFE_ID.test(shipId)) {
    return json({ error: 'unsafe_id', message: `ship_id must match ${SAFE_ID}` }, 400);
  }

  // ---- action: sign ----
  if (body.action === 'sign') {
    const objects = Array.isArray(body.objects) ? body.objects : [];
    if (!objects.length) return json({ error: 'invalid_body', message: 'objects required' }, 400);

    const uploads: { path: string; token: string; signedUrl: string }[] = [];
    for (const o of objects) {
      const skinId = (o.skin_id ?? '').trim();
      const ext = (o.ext ?? '').trim().toLowerCase();
      if (!SAFE_ID.test(skinId)) {
        return json({ error: 'unsafe_id', message: `skin_id must match ${SAFE_ID}` }, 400);
      }
      if (ext !== 'glb' && ext !== 'webp') {
        return json({ error: 'invalid_body', message: 'ext must be glb|webp' }, 400);
      }
      const path = `${shipId}/${skinId}.${ext}`;
      const { data, error } = await adminClient.storage
        .from(BUCKET)
        .createSignedUploadUrl(path, { upsert: true });
      if (error || !data) {
        return json({ error: 'sign_failed', message: error?.message ?? 'no url', path }, 500);
      }
      uploads.push({ path: data.path, token: data.token, signedUrl: data.signedUrl });
    }
    return json({ ok: true, uploads });
  }

  // ---- action: commit ----
  if (body.action === 'commit') {
    const skins = Array.isArray(body.skins) ? body.skins : [];
    if (!skins.length) return json({ error: 'invalid_body', message: 'skins required' }, 400);

    const rows: Record<string, unknown>[] = [];
    for (const s of skins) {
      const skinId = (s.skin_id ?? '').trim();
      if (!SAFE_ID.test(skinId)) {
        return json({ error: 'unsafe_id', message: `skin_id must match ${SAFE_ID}` }, 400);
      }
      const name = (s.name ?? '').trim();
      if (!name) return json({ error: 'invalid_body', message: `name required for ${skinId}` }, 400);
      const source = ALLOWED_SOURCES.has(s.source ?? '') ? s.source : 'store';
      // Paths are derived here — never trusted from the client.
      rows.push({
        ship_id: shipId,
        skin_id: skinId,
        name,
        description: s.description ?? '',
        source,
        name_verified: !!s.name_verified,
        model_path: s.has_model ? `${shipId}/${skinId}.glb` : null,
        icon_path: s.has_icon ? `${shipId}/${skinId}.webp` : null,
        model_bytes: typeof s.model_bytes === 'number' ? Math.round(s.model_bytes) : null,
        sort: typeof s.sort === 'number' ? s.sort : skinId === 'standard' ? 10 : 100,
      });
    }

    const { error } = await adminClient
      .from('ship_skins')
      .upsert(rows, { onConflict: 'ship_id,skin_id' });
    if (error) return json({ error: 'commit_failed', message: error.message }, 500);
    return json({ ok: true, count: rows.length });
  }

  return json({ error: 'invalid_body', message: "action must be 'sign' or 'commit'" }, 400);
});
