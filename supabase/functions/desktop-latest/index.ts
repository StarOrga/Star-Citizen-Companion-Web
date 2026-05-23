// supabase/functions/desktop-latest
// ---------------------------------------------------------------
// Auto-update endpoint for the desktop tool.
// Returns electron-updater-compatible YAML metadata for the latest release.
//
// Replaces the originally-planned Vercel Edge-Function (concept Iter 3 § I).
// Supabase Edge avoids the interactive Vercel-setup blocker — same security
// properties (JWT-verified user, service-side GH access, no GH-token leak
// into the Tool binary).
//
// Input:  GET (with Authorization: Bearer <jwt>)
//         Accept: application/yaml → electron-updater-format
//         Accept: application/json → human-readable
// Output: 200 (yaml or json based on Accept)
//         401 unauthorized
//         403 forbidden — not collaborator+

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, accept',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
};

interface ReleaseRow {
  id: string;
  version: string;
  platforms: Record<string, { url: string; size_bytes: number; sha256: string; kind?: string }>;
  notes: string | null;
  created_at: string;
}

function jsonResp(body: unknown, status = 200, extraHeaders: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...CORS, ...extraHeaders },
  });
}

/**
 * electron-updater "generic" provider expects a `latest.yml` file like:
 *
 *   version: 0.2.0
 *   files:
 *     - url: sc-companion-setup-0.2.0-x64.exe
 *       sha512: <base64>
 *       size: 81875966
 *   path: sc-companion-setup-0.2.0-x64.exe
 *   sha512: <base64>
 *   releaseDate: '2026-05-23T20:00:00.000Z'
 *
 * We return our own metadata in that shape so electron-updater can consume
 * it directly. (sha512 vs sha256: electron-updater accepts both with the
 * right config; we expose sha256 here, the Tool's config sets `algo: 'sha256'`.)
 */
function toLatestYaml(release: ReleaseRow): string {
  const winSetup = release.platforms['win-x64-setup'] ?? release.platforms['win-x64'];
  if (!winSetup) {
    return `version: ${release.version}\nfiles: []\nreleaseDate: '${release.created_at}'\n`;
  }
  const fileName = winSetup.url.split('/').pop() ?? 'unknown.exe';
  return [
    `version: ${release.version}`,
    'files:',
    `  - url: ${winSetup.url}`,
    `    sha512: ${winSetup.sha256}`,
    `    size: ${winSetup.size_bytes}`,
    `path: ${fileName}`,
    `sha512: ${winSetup.sha256}`,
    `releaseDate: '${release.created_at}'`,
  ].join('\n') + '\n';
}

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS });
  if (req.method !== 'GET') return jsonResp({ error: 'method_not_allowed' }, 405);

  const authHeader = req.headers.get('authorization');
  if (!authHeader) return jsonResp({ error: 'unauthorized' }, 401);

  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
  });

  const {
    data: { user },
    error: authErr,
  } = await userClient.auth.getUser();
  if (authErr || !user) return jsonResp({ error: 'unauthorized' }, 401);

  const { data: profile } = await userClient
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .maybeSingle();
  if (!profile || !['admin', 'collaborator'].includes((profile as { role?: string }).role ?? '')) {
    return jsonResp({ error: 'forbidden' }, 403);
  }

  // Latest is_current release
  const { data, error } = await userClient
    .from('desktop_releases')
    .select('id, version, platforms, notes, created_at')
    .eq('is_current', true)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) return jsonResp({ error: 'query_failed', message: error.message }, 500);
  if (!data) return jsonResp({ error: 'no_release' }, 404);

  const release = data as unknown as ReleaseRow;

  const accept = (req.headers.get('accept') ?? '').toLowerCase();
  if (accept.includes('yaml') || accept.includes('yml')) {
    return new Response(toLatestYaml(release), {
      status: 200,
      headers: { 'content-type': 'application/yaml; charset=utf-8', ...CORS },
    });
  }

  // Default: JSON for human/UI consumption
  return jsonResp({
    version: release.version,
    notes: release.notes,
    releaseDate: release.created_at,
    platforms: release.platforms,
  });
});
