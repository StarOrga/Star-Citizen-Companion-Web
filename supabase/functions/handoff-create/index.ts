// supabase/functions/handoff-create
// ---------------------------------------------------------------
// Signed-in desktop asks for a ONE-TIME code that lets the user's phone sign in
// without typing credentials ("Continue on your phone"). See handoff-redeem for
// the other half and docs/concepts/2026-10-25-header-footer-subheader-analyse/
// briefs/contract-handoff.md for the threat model.
//
//   * 256-bit random code, returned ONCE; only its SHA-256 is stored.
//   * TTL 60 s, single use (enforced atomically in handoff_redeem()).
//   * target_path must be a same-origin relative path (open-redirect guard).
//   * Rate limit: 5 codes per user per 10 minutes.
//   * verify_jwt stays ON (default) like desktop-session; identity comes from
//     getUser(), never from the body.
//
// Input:  POST { target_path: string }, Authorization: Bearer <user JWT>
// Output: 200 { id, code, expires_at }
//         400 invalid_path | 401 unauthorized | 429 rate_limited | 500 server_error

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';
import {
  CODE_TTL_SECONDS,
  RATE_LIMIT_COUNT,
  RATE_LIMIT_WINDOW_MS,
  generateCode,
  hashCode,
  validateTargetPath,
} from './_handoff.ts';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store', ...CORS },
  });
}

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);

  const authHeader = req.headers.get('authorization');
  if (!authHeader) return json({ error: 'unauthorized' }, 401);

  const url = Deno.env.get('SUPABASE_URL') ?? '';
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  if (!url || !anonKey || !serviceKey) return json({ error: 'server_error' }, 500);

  const userClient = createClient(url, anonKey, { global: { headers: { Authorization: authHeader } } });
  const {
    data: { user },
    error: authErr,
  } = await userClient.auth.getUser();
  if (authErr || !user) return json({ error: 'unauthorized' }, 401);

  let body: { target_path?: unknown } = {};
  try {
    body = await req.json();
  } catch {
    /* empty body -> invalid_path below */
  }
  const targetPath = validateTargetPath(body.target_path);
  if (!targetPath) return json({ error: 'invalid_path' }, 400);

  const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });

  // On-read cleanup of this user's stale rows (the pg_cron job does the rest).
  await admin
    .from('handoff_codes')
    .delete()
    .eq('user_id', user.id)
    .is('consumed_at', null)
    .lt('expires_at', new Date().toISOString());

  const since = new Date(Date.now() - RATE_LIMIT_WINDOW_MS).toISOString();
  const { count, error: countErr } = await admin
    .from('handoff_codes')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', user.id)
    .gte('created_at', since);
  if (countErr) {
    console.error(`[handoff-create] rate-limit count failed: ${countErr.message}`);
    return json({ error: 'server_error' }, 500);
  }
  if ((count ?? 0) >= RATE_LIMIT_COUNT) return json({ error: 'rate_limited' }, 429);

  const code = generateCode();
  const expiresAt = new Date(Date.now() + CODE_TTL_SECONDS * 1000).toISOString();
  const { data: row, error: insErr } = await admin
    .from('handoff_codes')
    .insert({
      user_id: user.id,
      code_hash: await hashCode(code),
      target_path: targetPath,
      expires_at: expiresAt,
    })
    .select('id')
    .single();
  if (insErr || !row) {
    console.error(`[handoff-create] insert failed: ${insErr?.message ?? 'no row'}`);
    return json({ error: 'server_error' }, 500);
  }

  return json({ id: row.id, code, expires_at: expiresAt });
});
