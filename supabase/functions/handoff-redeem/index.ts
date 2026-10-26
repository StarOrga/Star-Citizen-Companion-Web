// supabase/functions/handoff-redeem
// ---------------------------------------------------------------
// The phone presents a hand-off code (from the QR / link) and receives a NEW
// session of its own. UNAUTHENTICATED by design (verify_jwt = false in
// config.toml): the phone has no session yet, the code IS the credential.
//
// How the session is minted (and why this way)
// --------------------------------------------
// GoTrue has no "create session for user" admin call. The supported detour,
// already proven in desktop-session: `admin.generateLink({type:'magiclink'})`
// returns a hashed OTP WITHOUT sending mail, and a throwaway anon client
// redeems it with `verifyOtp` -> a real, independent auth.sessions row with its
// own refresh-token chain. The desktop's tokens are never read, copied or
// returned; revoking the phone (handoff-revoke) deletes only that session.
//
//   * Atomic single use: handoff_redeem() is one UPDATE ... WHERE
//     consumed_at IS NULL AND expires_at > now(). Replays, expired codes and
//     unknown codes are indistinguishable to the caller (404 invalid_code).
//   * If minting fails AFTER consumption the code stays burned (fail closed);
//     the user simply requests a new one (502 mint_failed).
//   * Brute force: 256-bit codes; additionally a shape check before any DB work
//     and a small per-isolate failure throttle per IP (best effort).
//   * No tokens or codes are logged.
//
// Input:  POST { code: string }
// Output: 200 { access_token, refresh_token, expires_at, target_path }
//         400 bad_request | 404 invalid_code | 429 rate_limited | 502 mint_failed | 500 server_error

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';
import { deviceLabel, hashCode, looksLikeCode, sessionIdOf } from './_hash.ts';

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

// Best-effort failure throttle (isolates are short-lived; the entropy is the real defence).
const failures = new Map<string, { n: number; reset: number }>();
const MAX_FAILURES = 10;
const FAILURE_WINDOW_MS = 10 * 60 * 1000;

function ipOf(req: Request): string {
  return (req.headers.get('x-forwarded-for') ?? '').split(',')[0].trim() || 'unknown';
}

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);

  const url = Deno.env.get('SUPABASE_URL') ?? '';
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  if (!url || !anonKey || !serviceKey) return json({ error: 'server_error' }, 500);

  const ip = ipOf(req);
  const now = Date.now();
  const f = failures.get(ip);
  if (f && f.reset > now && f.n >= MAX_FAILURES) return json({ error: 'rate_limited' }, 429);
  const fail = (): Response => {
    const cur = failures.get(ip);
    if (cur && cur.reset > now) cur.n += 1;
    else failures.set(ip, { n: 1, reset: now + FAILURE_WINDOW_MS });
    return json({ error: 'invalid_code' }, 404);
  };

  let body: { code?: unknown } = {};
  try {
    body = await req.json();
  } catch {
    return json({ error: 'bad_request' }, 400);
  }
  if (!looksLikeCode(body.code)) return fail();

  const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });

  const { data: rows, error: redeemErr } = await admin.rpc('handoff_redeem', {
    p_hash: await hashCode(body.code),
    p_device: deviceLabel(req.headers.get('user-agent')),
  });
  if (redeemErr) {
    console.error(`[handoff-redeem] rpc failed: ${redeemErr.message}`);
    return json({ error: 'server_error' }, 500);
  }
  const hit = Array.isArray(rows) ? rows[0] : null;
  if (!hit) return fail();

  const { data: u, error: userErr } = await admin.auth.admin.getUserById(hit.user_id);
  const email = u?.user?.email ?? '';
  if (userErr || !email) {
    console.error(`[handoff-redeem] user lookup failed: ${userErr?.message ?? 'no email'}`);
    return json({ error: 'mint_failed' }, 502);
  }

  const { data: link, error: linkErr } = await admin.auth.admin.generateLink({ type: 'magiclink', email });
  const tokenHash = link?.properties?.hashed_token ?? '';
  if (linkErr || !tokenHash) {
    console.error(`[handoff-redeem] generateLink failed: ${linkErr?.message ?? 'no hashed_token'}`);
    return json({ error: 'mint_failed' }, 502);
  }

  const fresh = createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: verified, error: verifyErr } = await fresh.auth.verifyOtp({
    type: 'magiclink',
    token_hash: tokenHash,
  });
  const session = verified?.session;
  if (verifyErr || !session?.refresh_token) {
    console.error(`[handoff-redeem] verifyOtp failed: ${verifyErr?.message ?? 'no session'}`);
    return json({ error: 'mint_failed' }, 502);
  }

  // Remember the phone's session so the owner can revoke exactly it.
  const sessionId = sessionIdOf(session.access_token);
  if (sessionId) {
    const { error: upErr } = await admin.from('handoff_codes').update({ session_id: sessionId }).eq('id', hit.id);
    if (upErr) console.error(`[handoff-redeem] session_id store failed: ${upErr.message}`);
  }

  return json({
    access_token: session.access_token,
    refresh_token: session.refresh_token,
    expires_at: session.expires_at ?? null,
    target_path: hit.target_path,
  });
});
