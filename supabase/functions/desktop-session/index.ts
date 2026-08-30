// supabase/functions/desktop-session
// ---------------------------------------------------------------
// Mint a SEPARATE, long-lived Supabase session for a desktop app, for the
// already-authenticated caller and nobody else.
//
// Why this exists
// ---------------
// Both desktop hand-offs (`/desktop/connect` → Starscape, `/uploader/auth` →
// data-uploader) used to hand the app the BROWSER'S OWN `refresh_token`, putting
// two independent clients on one GoTrue session and therefore one rotation
// chain. Whoever refreshes second is presenting an already-spent token.
//
// Be precise about what that is and is not. Measured against this project on
// 2026-08-30, it does NOT currently sign anyone out: a spent token was still
// accepted well past the 10 s reuse window, so reuse-detection is not biting
// here. This function is therefore HARDENING, not the fix for the "signed out
// again every day" report — that was tracked to `wallpaper-app/src/session.rs`
// discarding the store on transport failures. What it buys is a design that does
// not depend on that leniency: reuse-detection is one dashboard toggle away, and
// two clients sharing one chain race by construction.
//
// One session per client, then. GoTrue has no "create a session for this user"
// admin call, so we take the supported detour: `admin.generateLink` mints a
// magic-link OTP for the caller's own address (it returns the link, it does NOT
// send mail), and a throwaway anon client redeems it. That yields a real,
// independent `auth.sessions` row with its own rotation chain — verified by
// rotating one session and confirming the other still refreshes.
//
// Security notes — read before changing anything here
// ---------------------------------------------------
//   * The email is taken from the VERIFIED JWT, never from the request body.
//     There is no input at all, so there is nothing to spoof: a caller can only
//     ever mint a session for themselves.
//   * This is not a new escalation path. Anyone holding the caller's access
//     token already sits next to the browser's refresh token in the same
//     localStorage; a stolen JWT could always be replayed for its remaining
//     hour. What changes is lifetime, so treat it accordingly: a global
//     `signOut()` (supabase-js's default scope) and a password change both
//     revoke every session of the user, this one included. That is deliberate —
//     signing out on the website must also disconnect the desktop apps.
//   * `verify_jwt` stays ON (no `--no-verify-jwt` for this slug): the gateway
//     rejects anonymous calls before our code runs. The publishable key is
//     `sb_publishable_*`, not a JWT, so it cannot be used to reach this.
//   * Every hand-off adds one `auth.sessions` row and nothing prunes them
//     (timebox is 0 project-wide). Fine at this scale — a handful of rows per
//     user per year — but it is the knob to turn if that ever changes.
//
// Input:  POST, `Authorization: Bearer <user JWT>`, no body
// Output: 200 { access_token, refresh_token, expires_at, email }
//         401 { error: 'unauthorized' }
//         409 { error: 'no_email' }        — account has no address to mint against
//         502 { error: 'mint_failed' }     — GoTrue refused; caller falls back
//         500 { error: 'server_misconfigured' }

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';

const CORS = {
  // `*` is correct here despite the sensitive response: the call carries the
  // caller's JWT in an explicit header, not cookies, so no third-party origin
  // can make the browser attach it. Pinning origins would only break Vercel
  // preview deployments without adding a gate.
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

  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  if (!supabaseUrl || !anonKey || !serviceKey) {
    return json({ error: 'server_misconfigured' }, 500);
  }

  // 1. Who is asking? The JWT is the only identity input this function accepts.
  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
  });
  const {
    data: { user },
    error: authErr,
  } = await userClient.auth.getUser();
  if (authErr || !user) return json({ error: 'unauthorized' }, 401);

  const email = user.email ?? '';
  if (!email) {
    // Every current provider (email, Google) carries an address, so this is the
    // "should not happen" branch — the caller falls back to the old behaviour
    // rather than losing the ability to connect at all.
    console.warn(`[desktop-session] user ${user.id} has no email — cannot mint`);
    return json({ error: 'no_email' }, 409);
  }

  // 2. Mint a one-shot magic-link OTP for that exact address. `generateLink`
  //    RETURNS the link instead of mailing it, which is the whole reason it is
  //    an admin-only call and why this must run with the service key.
  const adminClient = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: link, error: linkErr } = await adminClient.auth.admin.generateLink({
    type: 'magiclink',
    email,
  });
  const tokenHash = link?.properties?.hashed_token ?? '';
  if (linkErr || !tokenHash) {
    console.error(`[desktop-session] generateLink failed: ${linkErr?.message ?? 'no hashed_token'}`);
    return json({ error: 'mint_failed' }, 502);
  }

  // 3. Redeem it on a client that shares NOTHING with the caller's session —
  //    that separation is the entire point of this function. `persistSession`
  //    is off so the redeemed session exists only in this response.
  const freshClient = createClient(supabaseUrl, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: verified, error: verifyErr } = await freshClient.auth.verifyOtp({
    type: 'magiclink',
    token_hash: tokenHash,
  });
  const session = verified?.session;
  if (verifyErr || !session?.refresh_token) {
    console.error(`[desktop-session] verifyOtp failed: ${verifyErr?.message ?? 'no session'}`);
    return json({ error: 'mint_failed' }, 502);
  }

  return json({
    access_token: session.access_token,
    refresh_token: session.refresh_token,
    // UNIX seconds, matching what the hand-off already posts to the loopback.
    expires_at: session.expires_at ?? null,
    email,
  });
});
