// supabase/functions/delete-user
// ---------------------------------------------------------------
// Admin-only delete: removes a user from auth.users. The FK chain
// (profiles → uploads → bundles, all ON DELETE CASCADE) cleans up
// the rest automatically. Self-delete is permitted unless the
// caller is the last remaining admin.
//
// Input:  POST { userId: string }
// Output: 200 { ok: true, userId, deletedSelf: boolean }
//         400 { error: 'invalid_body' }
//         401 { error: 'unauthorized' }
//         403 { error: 'forbidden' }
//         403 { error: 'protected_admin' }
//         404 { error: 'user_not_found' }
//         409 { error: 'cannot_delete_last_admin' }
//
// Founder protection (admin_feedback #83): accounts listed in
// public.protected_admins can never be deleted here. This check is a
// UX nicety only — the real enforcement is in the database (FK
// ON DELETE RESTRICT + the profiles_protected_admin_guard trigger from
// migration 20260802080000), so even a caller that bypasses this
// function entirely cannot delete a protected account.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';

interface DeleteBody {
  userId?: string;
}

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
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);

  const authHeader = req.headers.get('authorization');
  if (!authHeader) return json({ error: 'unauthorized' }, 401);

  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  if (!supabaseUrl || !anonKey || !serviceKey) {
    return json({ error: 'server_misconfigured' }, 500);
  }

  // 1. Verify caller is admin
  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
  });
  const {
    data: { user },
    error: authErr,
  } = await userClient.auth.getUser();
  if (authErr || !user) return json({ error: 'unauthorized' }, 401);

  const { data: callerProfile } = await userClient
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .maybeSingle();
  if (callerProfile?.role !== 'admin') {
    return json({ error: 'forbidden' }, 403);
  }

  // 2. Parse body
  let body: DeleteBody;
  try {
    body = (await req.json()) as DeleteBody;
  } catch {
    return json({ error: 'invalid_body' }, 400);
  }
  const userId = (body.userId ?? '').trim();
  if (!userId || !userId.match(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i)) {
    return json({ error: 'invalid_body', message: 'missing/malformed userId' }, 400);
  }

  // 3. Service-role client for privileged ops
  const adminClient = createClient(supabaseUrl, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  // 4. Look up target's role
  const { data: target, error: targetErr } = await adminClient
    .from('profiles')
    .select('role')
    .eq('id', userId)
    .maybeSingle();
  if (targetErr || !target) {
    return json({ error: 'user_not_found' }, 404);
  }

  // 5a. Founder protection — mirrors the DB guard so the admin gets a
  //     readable 403 instead of a raw constraint-violation 500.
  const { data: protectedRow } = await adminClient
    .from('protected_admins')
    .select('user_id')
    .eq('user_id', userId)
    .maybeSingle();
  if (protectedRow) {
    return json(
      {
        error: 'protected_admin',
        message:
          'Dieser Account ist geschützt und kann nicht gelöscht werden. Die Schutzmarkierung muss zuerst serverseitig (service_role) entfernt werden.',
      },
      403,
    );
  }

  // 5. Last-admin protection — applies whether the caller is deleting
  //    themselves or another admin. Prevents leaving the system without
  //    any admin.
  if (target.role === 'admin') {
    const { count } = await adminClient
      .from('profiles')
      .select('id', { count: 'exact', head: true })
      .eq('role', 'admin');
    if ((count ?? 0) <= 1) {
      return json(
        {
          error: 'cannot_delete_last_admin',
          message:
            'Letzter Admin kann nicht gelöscht werden. Promote vorher einen anderen User zum Admin.',
        },
        409,
      );
    }
  }

  // 6. Delete from auth.users — FK cascade handles profiles/uploads/bundles.
  const { error: delErr } = await adminClient.auth.admin.deleteUser(userId);
  if (delErr) {
    return json({ error: 'delete_failed', message: delErr.message }, 500);
  }

  return json({ ok: true, userId, deletedSelf: userId === user.id });
});
