// supabase/functions/handoff-redeem
// ---------------------------------------------------------------
// The phone presents a hand-off code (from the QR / link fragment) and receives
// a NEW session of its own. UNAUTHENTICATED by design (verify_jwt = false in
// config.toml): the phone has no session yet, the code IS the credential.
//
// Two calls, both POST:
//   { code, peek: true }  read-only: who would this sign in as? -> { email_masked }
//                         Consumes nothing. The page shows it and waits for an
//                         explicit tap (login-CSRF guard: a link someone else
//                         made must never sign the browser in on its own).
//   { code }              redeem -> { access_token, refresh_token, expires_at, target_path }
//
// How the session is minted (and why this way)
// --------------------------------------------
// GoTrue has no "create session for user" admin call. The supported detour,
// already proven in desktop-session: `admin.generateLink({type:'magiclink'})`
// returns a hashed OTP WITHOUT sending mail, and a throwaway anon client
// redeems it with `verifyOtp` -> a real, independent auth.sessions row with its
// own refresh-token chain. The desktop's tokens are never read, copied or
// returned. Side effect: generateLink replaces a pending magic-link/recovery OTP
// of that user (see contract note, rollout).
//
//   * Atomic single use: handoff_redeem() is one UPDATE ... WHERE
//     consumed_at IS NULL AND revoked_at IS NULL AND expires_at > now().
//     Replays, expired, revoked and unknown codes are indistinguishable (404).
//   * Fail closed. After minting, handoff_attach_session() stores the session id
//     unless the owner revoked meanwhile. If that returns false / errors, or the
//     session id cannot be read, the just-minted session is killed and NO tokens
//     are returned (409 revoked / 502 mint_failed). The code stays burned.
//   * Throttle: every call (peek or redeem) counts per IP; failures count extra.
//     Best effort per isolate - the 256-bit entropy is the real defence.
//   * No tokens or codes are logged.
//
// Output errors: 400 bad_request | 404 invalid_code | 409 revoked | 429 rate_limited
//   (our throttle) | 429 auth_rate_limited (GoTrue quota) | 502 mint_failed
//   | 500 server_error

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';
import {
  type Throttle,
  deviceLabel,
  hashCode,
  isRateLimited,
  isThrottled,
  looksLikeCode,
  maskEmail,
  sessionIdOf,
  touch,
} from './_hash.ts';

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

const throttles = new Map<string, Throttle>();

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

  const throttle = touch(throttles, ipOf(req), Date.now());
  if (isThrottled(throttle)) return json({ error: 'rate_limited' }, 429);
  const fail = (): Response => {
    throttle.failures += 1;
    return json({ error: 'invalid_code' }, 404);
  };

  let body: { code?: unknown; peek?: unknown } = {};
  try {
    body = await req.json();
  } catch {
    return json({ error: 'bad_request' }, 400);
  }
  if (!looksLikeCode(body.code)) return fail();

  const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const hash = await hashCode(body.code);

  // Best-effort kill of a session we minted but must not hand out.
  const kill = async (accessToken: string, sessionId: string | null, userId: string): Promise<void> => {
    try {
      if (sessionId) {
        const { error } = await admin.rpc('handoff_kill_session', { p_session: sessionId, p_user: userId });
        if (!error) return;
        console.error(`[handoff-redeem] kill rpc failed: ${error.message}`);
      }
      const { error: soErr } = await admin.auth.admin.signOut(accessToken, 'local');
      if (soErr) console.error(`[handoff-redeem] signOut fallback failed: ${soErr.message}`);
    } catch (e) {
      console.error(`[handoff-redeem] kill threw: ${e instanceof Error ? e.message : 'unknown'}`);
    }
  };

  // ---- peek: read-only, consumes nothing -------------------------------------
  if (body.peek === true) {
    const { data: peeked, error: peekErr } = await admin.rpc('handoff_peek', { p_hash: hash });
    if (peekErr) {
      console.error(`[handoff-redeem] peek rpc failed: ${peekErr.message}`);
      return json({ error: 'server_error' }, 500);
    }
    const who = Array.isArray(peeked) ? peeked[0] : null;
    if (!who) return fail();
    const { data: pu } = await admin.auth.admin.getUserById(who.user_id);
    const mail = pu?.user?.email ?? '';
    return json({ email_masked: mail ? maskEmail(mail) : '***' });
  }

  // ---- redeem ------------------------------------------------------------------
  const { data: rows, error: redeemErr } = await admin.rpc('handoff_redeem', {
    p_hash: hash,
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
    return isRateLimited(linkErr) ? json({ error: 'auth_rate_limited' }, 429) : json({ error: 'mint_failed' }, 502);
  }

  const fresh = createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: verified, error: verifyErr } = await fresh.auth.verifyOtp({
    type: 'magiclink',
    token_hash: tokenHash,
  });
  const session = verified?.session;
  if (verifyErr || !session?.refresh_token) {
    console.error(`[handoff-redeem] verifyOtp failed: ${verifyErr?.message ?? 'no session'}`);
    return isRateLimited(verifyErr) ? json({ error: 'auth_rate_limited' }, 429) : json({ error: 'mint_failed' }, 502);
  }

  // Attach the phone's session to the row unless the owner revoked meanwhile.
  // Anything but a clear "true" fails closed: the session dies, no tokens leave.
  const sessionId = sessionIdOf(session.access_token);
  if (!sessionId) {
    console.error('[handoff-redeem] no session_id claim - failing closed');
    await kill(session.access_token, null, hit.user_id);
    return json({ error: 'mint_failed' }, 502);
  }
  const { data: attached, error: attachErr } = await admin.rpc('handoff_attach_session', {
    p_id: hit.id,
    p_session: sessionId,
  });
  if (attachErr || attached !== true) {
    if (attachErr) console.error(`[handoff-redeem] attach failed: ${attachErr.message}`);
    await kill(session.access_token, sessionId, hit.user_id);
    return attachErr ? json({ error: 'mint_failed' }, 502) : json({ error: 'revoked' }, 409);
  }

  return json({
    access_token: session.access_token,
    refresh_token: session.refresh_token,
    expires_at: session.expires_at ?? null,
    target_path: hit.target_path,
  });
});
