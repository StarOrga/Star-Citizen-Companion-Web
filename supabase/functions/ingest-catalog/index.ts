// supabase/functions/ingest-catalog
// ---------------------------------------------------------------
// Batched ingest of the extracted Codex catalog (ships / weapons /
// components / items / ammunition / manufacturers + item-ports + localized
// strings) into the codex_* tables. The extractor emits ~25k typed entities +
// ~115k generic records; that is far more than one edge-function body can hold,
// so this function is BATCHED and STATEFUL around a codex_builds row:
//
//   POST { op: "init",     build: {...} }                      -> { build_id }
//   POST { op: "upsert",   build_id, table, rows: [...] }      -> { upserted }
//   POST { op: "ports",    build_id, rows: [...] }             -> { inserted }
//   POST { op: "strings",  build_id, rows: [...] }             -> { upserted }
//   POST { op: "locale_strings", build_id, rows: [...] }       -> { upserted }
//   POST { op: "preview", build_number, name, content_base64 } -> { path }
//   POST { op: "finalize", build_id, entity_counts? }          -> { ok, current }
//
// Each `upsert` carries one batch (recommend <= 500 rows) for ONE table; the
// caller loops over kinds and chunks. Writes use the service-role key (RLS is
// service-role-write only), so this function — not the client — owns writes.
//
// AUTH — two accepted gates:
//   (a) Production: Authorization: Bearer <jwt> of a collaborator/admin user
//       + X-SC-Release-Token: <uuid> of a current desktop_releases row.
//       (Mirrors ingest-bundle.)
//   (b) Seed:       X-SC-Seed-Token: <token> matching a row in
//       public.codex_seed_tokens (used by supabase/scripts/seed-codex via the
//       edge function so the local machine never needs the service-role key).
//
// Response codes: 200 ok; 400 invalid_body; 401 unauthorized; 403 forbidden.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type, x-sc-release-token, x-sc-seed-token',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...CORS },
  });
}

const CATALOG_TABLES = new Set([
  'codex_manufacturers', 'codex_ships', 'codex_weapons',
  'codex_components', 'codex_items', 'codex_ammunition',
]);
const NAT_CONFLICT = 'channel,patch_version,build_number,class_name';

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);

  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  if (!supabaseUrl || !serviceKey) return json({ error: 'server_misconfigured' }, 500);

  const admin = createClient(supabaseUrl, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  // === Auth: seed-token OR collaborator-jwt+release-token ===
  const seedToken = req.headers.get('x-sc-seed-token');
  const authHeader = req.headers.get('authorization');
  const releaseToken = req.headers.get('x-sc-release-token');

  let authed = false;
  if (seedToken) {
    const { data: tok } = await admin
      .from('codex_seed_tokens')
      .select('token, expires_at, disabled')
      .eq('token', seedToken)
      .maybeSingle();
    if (
      tok && !(tok as { disabled?: boolean }).disabled &&
      (!(tok as { expires_at?: string }).expires_at ||
        new Date((tok as { expires_at: string }).expires_at) > new Date())
    ) {
      authed = true;
    } else {
      return json({ error: 'forbidden', message: 'invalid seed token' }, 403);
    }
  } else if (authHeader && anonKey) {
    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user } } = await userClient.auth.getUser();
    if (!user) return json({ error: 'unauthorized' }, 401);
    const { data: profile } = await userClient
      .from('profiles').select('role').eq('id', user.id).maybeSingle();
    const role = (profile as { role?: string } | null)?.role ?? '';
    if (!['admin', 'collaborator'].includes(role)) return json({ error: 'forbidden' }, 403);
    if (!releaseToken) return json({ error: 'missing_release_token' }, 400);
    const { data: release } = await admin
      .from('desktop_releases').select('id, is_current')
      .eq('release_token', releaseToken).maybeSingle();
    if (!release || !(release as { is_current: boolean }).is_current) {
      return json({ error: 'forbidden', message: 'release token invalid/revoked' }, 403);
    }
    authed = true;
  }
  if (!authed) return json({ error: 'unauthorized' }, 401);

  // === Parse body ===
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json({ error: 'invalid_json' }, 400);
  }
  const op = String(body.op ?? '');

  try {
    if (op === 'init') {
      const b = (body.build ?? {}) as Record<string, unknown>;
      const channel = String(b.channel ?? '').trim();
      const patch = String(b.patch_version ?? '').trim();
      const build = String(b.build_number ?? '').trim();
      if (!channel || !patch) return json({ error: 'invalid_body', message: 'channel + patch_version required' }, 400);
      const { data, error } = await admin
        .from('codex_builds')
        .upsert(
          {
            channel, patch_version: patch, build_number: build,
            schema_version: b.schema_version ?? 1,
            quality_score: b.quality_score ?? null,
            tool_version: b.tool_version ?? null,
            entity_counts: b.entity_counts ?? {},
            manifest: b.manifest ?? {},
            extracted_at: new Date().toISOString(),
          },
          { onConflict: 'channel,patch_version,build_number' },
        )
        .select('id')
        .single();
      if (error) throw error;
      return json({ ok: true, build_id: (data as { id: string }).id });
    }

    if (op === 'upsert') {
      const table = String(body.table ?? '');
      const rows = body.rows as unknown[];
      if (!CATALOG_TABLES.has(table)) return json({ error: 'invalid_body', message: 'bad table' }, 400);
      if (!Array.isArray(rows) || rows.length === 0) return json({ error: 'invalid_body', message: 'rows required' }, 400);
      const { error } = await admin.from(table).upsert(rows, { onConflict: NAT_CONFLICT });
      if (error) throw error;
      return json({ ok: true, upserted: rows.length });
    }

    if (op === 'strings') {
      const rows = body.rows as unknown[];
      if (!Array.isArray(rows) || rows.length === 0) return json({ error: 'invalid_body', message: 'rows required' }, 400);
      const { error } = await admin
        .from('codex_entity_strings')
        .upsert(rows, { onConflict: 'build_id,entity_class_name,lang,field' });
      if (error) throw error;
      return json({ ok: true, upserted: rows.length });
    }

    if (op === 'ports') {
      const rows = body.rows as unknown[];
      if (!Array.isArray(rows) || rows.length === 0) return json({ error: 'invalid_body', message: 'rows required' }, 400);
      const { error } = await admin.from('codex_item_ports').insert(rows);
      if (error) throw error;
      return json({ ok: true, inserted: rows.length });
    }

    if (op === 'locale_strings') {
      const rows = body.rows as unknown[];
      if (!Array.isArray(rows) || rows.length === 0) return json({ error: 'invalid_body', message: 'rows required' }, 400);
      const { error } = await admin
        .from('codex_locale_strings')
        .upsert(rows, { onConflict: 'build_id,lang,key' });
      if (error) throw error;
      return json({ ok: true, upserted: rows.length });
    }

    if (op === 'preview') {
      // Upload a single preview image (base64) to the public codex-previews
      // bucket at <build_number>/<name>. Only the deduped, actually-used files
      // are sent by the seeder, so the bucket holds just the final art.
      const build = String(body.build_number ?? '').trim();
      const name = String(body.name ?? '').trim();
      const b64 = String(body.content_base64 ?? '');
      if (!build || !name || !b64) return json({ error: 'invalid_body', message: 'build_number+name+content_base64 required' }, 400);
      const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
      const path = `${build}/${name}`;
      const { error } = await admin.storage
        .from('codex-previews')
        .upload(path, bytes, { contentType: 'image/webp', upsert: true });
      if (error) throw error;
      return json({ ok: true, path });
    }

    if (op === 'clear_ports') {
      const buildId = String(body.build_id ?? '');
      if (!buildId) return json({ error: 'invalid_body' }, 400);
      const { error } = await admin.from('codex_item_ports').delete().eq('build_id', buildId);
      if (error) throw error;
      return json({ ok: true });
    }

    if (op === 'finalize') {
      const buildId = String(body.build_id ?? '');
      if (!buildId) return json({ error: 'invalid_body' }, 400);
      if (body.entity_counts) {
        await admin.from('codex_builds').update({ entity_counts: body.entity_counts }).eq('id', buildId);
      }
      const { error } = await admin.rpc('set_current_codex_build', { p_build_id: buildId });
      if (error) throw error;
      return json({ ok: true, current: true });
    }

    return json({ error: 'invalid_body', message: `unknown op '${op}'` }, 400);
  } catch (e) {
    return json({ error: 'ingest_failed', message: (e as Error).message }, 500);
  }
});
