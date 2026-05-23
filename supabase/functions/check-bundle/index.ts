// supabase/functions/check-bundle
// ---------------------------------------------------------------
// Pre-upload check: does a bundle for (channel, patch, build) already exist?
// Tool calls this before uploading and warns the user if exists.
//
// Input:  GET ?channel=LIVE&patch=4.0.0&build=9123456
// Output: 200 { exists: bool, latest_id?: uuid, quality_score?: number,
//               uploaded_at?: iso, uploader_email?: string }
//         400 { error: 'missing_params' }
//         401 { error: 'unauthorized' }
//         403 { error: 'forbidden' }

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...CORS },
  });
}

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS });
  if (req.method !== 'GET') return json({ error: 'method_not_allowed' }, 405);

  const authHeader = req.headers.get('authorization');
  if (!authHeader) return json({ error: 'unauthorized' }, 401);

  const url = new URL(req.url);
  const channel = url.searchParams.get('channel') ?? '';
  const patch = url.searchParams.get('patch') ?? '';
  const build = url.searchParams.get('build') ?? '';
  if (!channel || !patch) {
    return json({ error: 'missing_params', message: 'channel + patch required' }, 400);
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
  });

  // Auth + role-gate (must be collaborator+)
  const {
    data: { user },
    error: authErr,
  } = await userClient.auth.getUser();
  if (authErr || !user) return json({ error: 'unauthorized' }, 401);
  const { data: profile } = await userClient
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .maybeSingle();
  if (!profile || !['admin', 'collaborator'].includes((profile as { role?: string }).role ?? '')) {
    return json({ error: 'forbidden' }, 403);
  }

  // Look up active (non-disabled) latest bundle for this combo
  const { data, error } = await userClient
    .from('p4k_bundles')
    .select('id, quality_score, created_at, uploaded_by')
    .eq('channel', channel)
    .eq('patch_version', patch)
    .eq('build_number', build)
    .eq('disabled', false)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) return json({ error: 'query_failed', message: error.message }, 500);

  if (!data) return json({ exists: false });

  // Resolve uploader email for nicer UX
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  let uploaderEmail: string | undefined;
  if (serviceKey) {
    const adminClient = createClient(supabaseUrl, serviceKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const { data: u } = await adminClient.auth.admin.getUserById(
      (data as { uploaded_by: string }).uploaded_by,
    );
    uploaderEmail = u?.user?.email;
  }

  const row = data as { id: string; quality_score: number | null; created_at: string };
  return json({
    exists: true,
    latest_id: row.id,
    quality_score: row.quality_score,
    uploaded_at: row.created_at,
    uploader_email: uploaderEmail,
  });
});
