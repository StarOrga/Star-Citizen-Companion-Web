// supabase/functions/readme-sync
// -----------------------------------------------------------------------
// Admin-only, **read-only** health check for the project's ReadMe (readme.io)
// documentation site.
//
// This function used to publish docs/readme-io/pages/*.md over the ReadMe
// content API. It cannot, and never could: the ReadMe project is Git-backed,
// and ReadMe blocks the content API for Git-backed projects by design
// (403 API_ACCESS_UNAVAILABLE). Publishing now happens through ReadMe's own
// Git Sync — see docs/readme-io/GIT-SYNC-SETUP.md.
//
// Rather than delete the function (the deployed name and its secret are worth
// keeping) it was reduced to the part that still works and is still useful:
//
//   * confirm README_IO_API_KEY is present and accepted,
//   * confirm the API is still closed *and why* — so if ReadMe ever opens it,
//     or the project silently changes tier, somebody finds out,
//   * report the page inventory this repository expects to be live, which is
//     what a Git-Sync run should have produced.
//
// The write path is gone. A request that asks to publish gets an explicit
// 409 pointing at Git Sync — it never silently no-ops and never pretends.
//
// Input:  GET  (no body)              — run the check
//         POST { branch?: string }    — same, with an explicit branch
//         POST { mode: 'sync' }       — 409, publishing moved to Git Sync
// Output: 200 { ok, state, publish, api, repo }
//         401 { error: 'unauthorized' } / 403 { error: 'forbidden' }
//         409 { error: 'publish_via_git_sync' }
//         500 { error: 'README_IO_API_KEY not configured' }
//
// The API key lives ONLY as the edge-function secret `README_IO_API_KEY`
// (CLAUDE.md: no third-party keys in the repo or client bundle).
// -----------------------------------------------------------------------

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';

import { PAGES } from './content.ts';
import { ReadmeApi, classify, pickBranch } from './readme-api.ts';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
};

const SETUP_DOC =
  'https://github.com/StarOrga/Star-Citizen-Companion-Web/blob/main/docs/readme-io/GIT-SYNC-SETUP.md';

interface RequestBody {
  mode?: string;
  branch?: string;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...CORS },
  });
}

/**
 * Read the `role` claim out of a JWT **without** verifying it — the platform's
 * `verify_jwt = true` gate has already checked the signature by the time this
 * runs, so this only reads an already-authenticated token. Returns null for
 * anything that is not a well-formed JWT (e.g. opaque `sb_*` keys).
 */
function jwtRole(token: string): string | null {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  try {
    const pad = '='.repeat((4 - (parts[1].length % 4)) % 4);
    const payload = JSON.parse(
      atob(parts[1].replace(/-/g, '+').replace(/_/g, '/') + pad),
    ) as { role?: unknown };
    return typeof payload.role === 'string' ? payload.role : null;
  } catch {
    return null;
  }
}

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS });
  if (req.method !== 'POST' && req.method !== 'GET') {
    return json({ error: 'method not allowed' }, 405);
  }

  // ---- 1. Admin gate (same pattern as invite-user) ----------------------
  const authHeader = req.headers.get('authorization');
  if (!authHeader) return json({ error: 'unauthorized' }, 401);

  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  if (!supabaseUrl || !anonKey) {
    return json({ error: 'server misconfigured (missing env)' }, 500);
  }

  // A service_role bearer counts as admin: it already outranks every profile
  // role, so accepting it grants nothing new — it just makes the check runnable
  // headlessly (CI / release scripts) instead of only from a browser session.
  //
  // Two forms are accepted because the project may be on legacy JWT keys or the
  // newer opaque `sb_secret_*` keys: an exact match against the env secret, or
  // a `role: service_role` claim. Trusting the claim is sound here precisely
  // because `verify_jwt = true` (config.toml) — the platform has already
  // validated the signature against this project before we ever see the token,
  // and an anon JWT carries `role: anon`, so it cannot pass.
  const bearer = authHeader.replace(/^Bearer\s+/i, '').trim();
  const isServiceRole =
    (!!serviceKey && bearer === serviceKey) || jwtRole(bearer) === 'service_role';

  if (!isServiceRole) {
    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const {
      data: { user },
      error: authErr,
    } = await userClient.auth.getUser();
    if (authErr || !user) return json({ error: 'unauthorized' }, 401);

    const { data: profile, error: profErr } = await userClient
      .from('profiles')
      .select('role')
      .eq('id', user.id)
      .maybeSingle();
    if (profErr || profile?.role !== 'admin') {
      return json({ error: 'forbidden — admin role required' }, 403);
    }
  }

  // ---- 2. Input ---------------------------------------------------------
  const url = new URL(req.url);
  let body: RequestBody = {};
  if (req.method === 'POST') {
    try {
      body = ((await req.json()) ?? {}) as RequestBody;
    } catch {
      body = {};
    }
  }

  // The old contract had `mode=sync` publish every page. Answer loudly rather
  // than accepting the request and doing nothing.
  const mode = (body.mode ?? url.searchParams.get('mode') ?? '').toLowerCase();
  if (mode === 'sync') {
    return json(
      {
        error: 'publish_via_git_sync',
        message:
          'This function no longer publishes. The ReadMe project is Git-backed, so the content API rejects writes; docs are published by ReadMe Git Sync from docs/readme-io/pages/.',
        setup: SETUP_DOC,
      },
      409,
    );
  }

  const apiKey = Deno.env.get('README_IO_API_KEY') ?? '';
  if (!apiKey) {
    return json(
      {
        error: 'README_IO_API_KEY not configured',
        hint: 'Set it as an edge-function secret: supabase secrets set README_IO_API_KEY=...',
      },
      500,
    );
  }

  // ---- 3. Read-only probe ----------------------------------------------
  const branchProbe = new ReadmeApi(apiKey, 'v2', '1.0');
  const branches = await branchProbe.listBranches();
  const branch = pickBranch(branches.body, body.branch ?? url.searchParams.get('branch') ?? undefined);

  const v1 = new ReadmeApi(apiKey, 'v1', branch);
  const v2 = new ReadmeApi(apiKey, 'v2', branch);
  const [v1Guides, v2Guides] = await Promise.all([v1.listGuides(), v2.listGuides()]);

  const state = classify(v1Guides, v2Guides);

  // `git_backed` is the expected state: ReadMe is correctly enforcing that a
  // Git-backed project publishes from Git. Anything else deserves attention.
  const ok = state === 'git_backed';

  const categories = [...new Set(PAGES.map((p) => p.category))];

  return json({
    ok,
    state,
    note:
      state === 'git_backed'
        ? 'Expected. ReadMe blocks the content API for Git-backed projects; publishing runs through Git Sync.'
        : state === 'api_open'
          ? 'Unexpected: a ReadMe content endpoint answered. The project may have been migrated — revisit the publishing strategy.'
          : 'Unexpected. Check README_IO_API_KEY and the raw statuses below.',
    publish: {
      channel: 'readme-git-sync',
      source: 'docs/readme-io/pages/',
      setup: SETUP_DOC,
    },
    api: {
      branch,
      branches: { status: branches.status, ok: branches.ok },
      v1Guides: { status: v1Guides.status, ok: v1Guides.ok },
      v2Guides: { status: v2Guides.status, ok: v2Guides.ok },
    },
    repo: {
      pages: PAGES.length,
      categories,
      inventory: PAGES.map((p) => ({
        slug: p.slug,
        title: p.title,
        category: p.category,
        bytes: p.body.length,
        source: p.source,
      })),
    },
  });
});
