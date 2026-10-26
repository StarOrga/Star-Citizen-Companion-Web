// supabase/functions/handoff-revoke
// ---------------------------------------------------------------
// The desktop owner signs the connected phone out: deletes exactly the
// auth.sessions row minted by handoff-redeem (refresh tokens cascade), so the
// phone can no longer refresh. The already-issued access JWT stays valid only
// until its own expiry (<= 1 h) unless GoTrue checks session existence, which
// current versions do on /user.
//
// All logic is one SQL call, handoff_revoke(): it marks revoked_at atomically,
// so a redeem still in flight (consumed, session id not attached yet) fails
// closed instead of slipping a live session past us. `revoked: true` is only
// returned when a row actually changed.
//
// Input:  POST { id: uuid } (the handoff row id returned by handoff-create)
//         Authorization: Bearer <user JWT>
// Output: 200 { revoked: boolean, outcome } | 400 bad_request | 401 unauthorized
//         | 404 not_found | 501 revoke_unavailable (no DELETE on auth.sessions) | 500 server_error

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';
import { isRevokeUnavailable, revokeResponse } from './_revoke.ts';

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
  const { data: outcome, error: revErr } = await admin.rpc('handoff_revoke', { p_id: id, p_user: user.id });
  if (revErr) {
    if (isRevokeUnavailable(revErr)) {
      console.error('[handoff-revoke] auth.sessions DELETE not granted - cannot revoke');
      return json({ error: 'revoke_unavailable' }, 501);
    }
    console.error(`[handoff-revoke] rpc failed: ${revErr.message}`);
    return json({ error: 'server_error' }, 500);
  }
  const res = revokeResponse(outcome);
  return json(res.body, res.status);
});
