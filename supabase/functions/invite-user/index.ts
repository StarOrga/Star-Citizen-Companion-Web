// supabase/functions/invite-user
// ---------------------------------------------------------------
// Admin-only "Registrieren": always allowlists an email so it may sign in
// and be auto-approved, optionally approves an already-existing account in
// place, and optionally sends a Supabase Auth invite mail.
//
// Input:  POST { email: string, role: 'admin' | 'collaborator' | 'viewer', sendInvite: boolean }
// Output: 200 { status: 'invited', ok: true, userId, email, role }
//         200 { status: 'approved_existing', ok: true, userId, email, role }
//         200 { status: 'allowlisted', ok: true, email, role }
//         400 { error: <message> }
//         401 { error: 'unauthorized' }
//         403 { error: 'forbidden' }
//         409 { error: 'user_exists', message: <string> }  -- sendInvite=true,
//              account already exists; use approved_existing instead
//         409 { error: <string> }  -- an existing account could not be updated
//              in place (e.g. a protected admin); the email was still allowlisted
//
// Design doc: docs/superpowers/specs/2026-08-05-access-control-allowlist-design.md (C5)

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';

interface RegisterBody {
  email?: string;
  role?: string;
  sendInvite?: boolean;
}

const ALLOWED_ROLES = new Set(['admin', 'collaborator', 'viewer']);

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
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
  if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405);

  const authHeader = req.headers.get('authorization');
  if (!authHeader) return json({ error: 'unauthorized' }, 401);

  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  if (!supabaseUrl || !anonKey || !serviceKey) {
    return json({ error: 'server misconfigured (missing env)' }, 500);
  }

  // 1. Verify caller is admin (using user JWT against anon client)
  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
  });
  const {
    data: { user },
    error: authErr,
  } = await userClient.auth.getUser();
  if (authErr || !user) return json({ error: 'unauthorized' }, 401);

  const { data: callerProfile, error: profErr } = await userClient
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .maybeSingle();
  if (profErr || callerProfile?.role !== 'admin') {
    return json({ error: 'forbidden — admin role required' }, 403);
  }

  // 2. Parse + validate body
  let body: RegisterBody;
  try {
    body = (await req.json()) as RegisterBody;
  } catch {
    return json({ error: 'invalid json' }, 400);
  }
  const email = (body.email ?? '').trim().toLowerCase();
  const role = (body.role ?? 'viewer').trim().toLowerCase();
  const sendInvite = body.sendInvite === true;
  if (!email.match(/^[^\s@]+@[^\s@]+\.[^\s@]+$/)) {
    return json({ error: 'invalid email' }, 400);
  }
  if (!ALLOWED_ROLES.has(role)) {
    return json({ error: 'invalid role' }, 400);
  }

  const adminClient = createClient(supabaseUrl, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  // 3. Always allowlist the email — the source of truth so this email may
  // sign in (self-serve or via invite) and is auto-approved at `role`.
  const { error: allowErr } = await adminClient
    .from('allowed_emails')
    .upsert(
      { email, role, added_by: user.id },
      { onConflict: 'email' },
    );
  if (allowErr) {
    return json({ error: 'allowlist write failed: ' + allowErr.message }, 500);
  }

  // 4. If an auth.users account already exists for this email, approve it
  // in place (it may have been created before the allowlist entry, or
  // signed up and been denied by approvedGuard). email_to_user_id() is a
  // service-role-only SECURITY DEFINER lookup — the admin JS SDK's
  // listUsers() has no reliable server-side email filter across versions.
  const { data: existingUserId, error: lookupErr } = await adminClient.rpc(
    'email_to_user_id',
    { target_email: email },
  );
  if (lookupErr) {
    return json({ error: 'user lookup failed: ' + lookupErr.message }, 500);
  }

  if (existingUserId) {
    // Read current state first. A no-op (already at the target role AND
    // approved) needs no write — which is also what lets an admin "register" an
    // existing PROTECTED founder at their current role without tripping
    // profiles_protected_admin_guard (which rejects even service_role).
    const { data: existingProfile } = await adminClient
      .from('profiles')
      .select('role, is_approved')
      .eq('id', existingUserId)
      .maybeSingle();

    if (!(existingProfile?.role === role && existingProfile?.is_approved === true)) {
      const { error: updErr } = await adminClient
        .from('profiles')
        .update({ role, is_approved: true })
        .eq('id', existingUserId);
      if (updErr) {
        // The allowlist write (step 3) already succeeded; only the in-place
        // update of the existing account failed — most likely a protected
        // founder frozen by profiles_protected_admin_guard. Surface that the
        // email is allowlisted but the account was left unchanged (409, not a
        // bare 500) so the admin knows the allowlist part landed.
        return json(
          {
            error:
              'allowlisted, but the existing account was not updated (it may be a protected admin): ' +
              updErr.message,
          },
          409,
        );
      }
    }
    return json({
      status: 'approved_existing',
      ok: true,
      userId: existingUserId,
      email,
      role,
    });
  }

  // 5. No existing account. Allowlist-only unless the admin also asked for
  // an invite mail.
  if (!sendInvite) {
    return json({ status: 'allowlisted', ok: true, email, role });
  }

  const { data: inviteData, error: inviteErr } =
    await adminClient.auth.admin.inviteUserByEmail(email);

  if (inviteErr || !inviteData?.user) {
    const msg = inviteErr?.message ?? 'invite failed';
    if (/already.*registered|exists/i.test(msg)) {
      // The email is allowlisted regardless (step 3 already ran) — surface
      // the friendlier status instead of a hard error.
      return json(
        {
          error: 'user_exists',
          message: 'Diese E-Mail ist bereits registriert. Die Allowlist wurde trotzdem aktualisiert.',
        },
        409,
      );
    }
    return json({ error: msg }, 400);
  }

  const newUserId = inviteData.user.id;

  // The handle_new_user trigger has already inserted a profile row
  // (is_approved=true because inviteUserByEmail stamps invited_at, or via
  // the allowlist branch). Re-assert role + approval explicitly so the
  // invited user is never gated out by timing between the trigger and this
  // update.
  const { error: updErr } = await adminClient
    .from('profiles')
    .update({ role, is_approved: true })
    .eq('id', newUserId);
  if (updErr) {
    return json({ error: 'invited but role-assign failed: ' + updErr.message }, 500);
  }

  return json({ status: 'invited', ok: true, userId: newUserId, email, role });
});
