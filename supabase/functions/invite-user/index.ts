// supabase/functions/invite-user
// ---------------------------------------------------------------
// Admin-only invite: sends a Supabase Auth invite email and seeds
// the new user's profile.role to the chosen target role.
//
// Input:  POST { email: string, role: 'admin' | 'collaborator' | 'viewer' }
// Output: 200 { ok: true, userId, email, role }
//         400 { error: <message> }
//         401 { error: 'unauthorized' }
//         403 { error: 'forbidden' }

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';

interface InviteBody {
  email?: string;
  role?: string;
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
  let body: InviteBody;
  try {
    body = (await req.json()) as InviteBody;
  } catch {
    return json({ error: 'invalid json' }, 400);
  }
  const email = (body.email ?? '').trim().toLowerCase();
  const role = (body.role ?? 'collaborator').trim().toLowerCase();
  if (!email.match(/^[^\s@]+@[^\s@]+\.[^\s@]+$/)) {
    return json({ error: 'invalid email' }, 400);
  }
  if (!ALLOWED_ROLES.has(role)) {
    return json({ error: 'invalid role' }, 400);
  }

  // 3. Use service_role to invite + upsert profile role
  const adminClient = createClient(supabaseUrl, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { data: inviteData, error: inviteErr } =
    await adminClient.auth.admin.inviteUserByEmail(email);

  if (inviteErr || !inviteData?.user) {
    // Surface "user already exists" as a friendlier error
    const msg = inviteErr?.message ?? 'invite failed';
    if (/already.*registered|exists/i.test(msg)) {
      return json(
        {
          error: 'user_exists',
          message: 'Diese E-Mail ist bereits registriert. Promote/Demote über die Liste unten.',
        },
        409,
      );
    }
    return json({ error: msg }, 400);
  }

  const newUserId = inviteData.user.id;

  // The handle_new_user trigger has already inserted a profile row
  // with role=viewer (or admin if jeremy.treder@gmail.com). Set our target.
  const { error: updErr } = await adminClient
    .from('profiles')
    .update({ role })
    .eq('id', newUserId);
  if (updErr) {
    return json({ error: 'invited but role-assign failed: ' + updErr.message }, 500);
  }

  return json({ ok: true, userId: newUserId, email, role });
});
