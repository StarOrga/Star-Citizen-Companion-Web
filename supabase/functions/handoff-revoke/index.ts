// supabase/functions/handoff-revoke
// ---------------------------------------------------------------
// The desktop owner signs the connected phone out: deletes exactly the
// auth.sessions row minted by handoff-redeem (refresh tokens cascade), so the
// phone can no longer refresh. The already-issued access JWT stays valid only
// until its own expiry (<= 1 h) unless GoTrue checks session existence, which
// current versions do on /user.
//
// Input:  POST { id: uuid } (the handoff row id returned by handoff-create)
//         Authorization: Bearer <user JWT>
// Output: 200 { revoked: boolean } | 400 bad_request | 401 unauthorized | 404 not_found | 500 server_error

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';

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

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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

  let id: unknown;
  try {
    id = (await req.json()).id;
  } catch {
    return json({ error: 'bad_request' }, 400);
  }
  if (typeof id !== 'string' || !UUID.test(id)) return json({ error: 'bad_request' }, 400);

  const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: row, error: rowErr } = await admin
    .from('handoff_codes')
    .select('session_id')
    .eq('id', id)
    .eq('user_id', user.id)
    .maybeSingle();
  if (rowErr) {
    console.error(`[handoff-revoke] lookup failed: ${rowErr.message}`);
    return json({ error: 'server_error' }, 500);
  }
  if (!row) return json({ error: 'not_found' }, 404);

  if (!row.session_id) {
    // Never redeemed: just burn the code so it can no longer be used.
    await admin
      .from('handoff_codes')
      .update({ consumed_at: new Date().toISOString(), revoked_at: new Date().toISOString() })
      .eq('id', id)
      .is('consumed_at', null);
    return json({ revoked: true });
  }

  const { data: revoked, error: revErr } = await admin.rpc('handoff_revoke_session', {
    p_session: row.session_id,
    p_user: user.id,
  });
  if (revErr) {
    console.error(`[handoff-revoke] rpc failed: ${revErr.message}`);
    return json({ error: 'server_error' }, 500);
  }
  return json({ revoked: revoked === true });
});
