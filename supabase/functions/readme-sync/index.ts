// supabase/functions/readme-sync
// -----------------------------------------------------------------------
// Admin-only one-way publish of the repo's documentation source
// (docs/readme-io/pages/*.md, bundled into content.ts) to the project's
// ReadMe (readme.io) site.
//
// Input:  POST { mode?: 'probe' | 'sync', branch?: string, dryRun?: boolean,
//                apiVersion?: 'v1' | 'v2' }
//         GET  ?mode=probe        (read-only, same admin gate)
// Output: 200 { ok, mode, apiVersion, branch, counts, pages: [...] }
//         207 partial — some pages failed (see per-page `error`)
//         401 { error: 'unauthorized' } / 403 { error: 'forbidden' }
//         500 { error: 'README_IO_API_KEY not configured' }
//
// Direction is repo → ReadMe, always. The markdown in the repo is the source of
// truth; a sync overwrites the remote page body. Nothing is ever deleted — a
// page removed from the repo is left standing in ReadMe for a human to retire,
// so a bad generator run cannot wipe the documentation site.
//
// API version is auto-detected (see readme-api.ts): v2 when the project is on
// ReadMe Refactored, v1 otherwise. `apiVersion` in the body forces one.
//
// `mode=probe` performs only GETs and reports which API answers, the resolved
// branch, category resolution, and the pages that would be written. Run it
// first after any ReadMe-side change.
//
// The API key lives ONLY as the edge-function secret `README_IO_API_KEY`
// (CLAUDE.md: no third-party keys in the repo or client bundle).
// -----------------------------------------------------------------------

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';

import { PAGES } from './content.ts';
import {
  ReadmeApi,
  anyPageCategoryRef,
  detectApiVersion,
  findCategoryRef,
  firstCategoryRef,
  pickBranch,
  type ApiVersion,
  type PagePayload,
} from './readme-api.ts';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
};

const CATEGORY_TITLES: Record<string, string> = {
  documentation: 'Documentation',
};

interface SyncBody {
  mode?: string;
  branch?: string;
  dryRun?: boolean;
  apiVersion?: string;
}

interface PageResult {
  slug: string;
  action: 'created' | 'updated' | 'skipped' | 'failed';
  status?: number;
  error?: string;
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
  // role, so accepting it grants nothing new — it just makes the sync runnable
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
  let body: SyncBody = {};
  if (req.method === 'POST') {
    try {
      body = ((await req.json()) ?? {}) as SyncBody;
    } catch {
      body = {};
    }
  }
  const mode = (
    body.mode ??
    url.searchParams.get('mode') ??
    (req.method === 'GET' ? 'probe' : 'sync')
  ).toLowerCase();
  if (mode !== 'probe' && mode !== 'sync') {
    return json({ error: "mode must be 'probe' or 'sync'" }, 400);
  }
  const dryRun = body.dryRun === true || url.searchParams.get('dryRun') === 'true';
  const branchHint = body.branch ?? url.searchParams.get('branch') ?? undefined;
  const forcedVersion = (body.apiVersion ?? url.searchParams.get('apiVersion') ?? '')
    .toLowerCase();

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

  // ---- 3. Resolve branch + which API this project actually serves -------
  const branchProbe = new ReadmeApi(apiKey, 'v2', '1.0');
  const branchesRes = await branchProbe.probePath('/branches');
  const branch = pickBranch(branchesRes.body, branchHint);

  let apiVersion: ApiVersion;
  let detection: { v2Branches: number; v2Guides: number } | null = null;
  if (forcedVersion === 'v1' || forcedVersion === 'v2') {
    apiVersion = forcedVersion;
  } else {
    const detected = await detectApiVersion(apiKey, branch);
    apiVersion = detected.version;
    detection = { v2Branches: detected.v2Branches, v2Guides: detected.v2Guides };
  }

  const api = new ReadmeApi(apiKey, apiVersion, branch);

  // ---- 4. Resolve category references ----------------------------------
  const categories = await api.listCategories();
  const existingPages = await api.listGuides();

  if (!categories.ok && !existingPages.ok) {
    return json(
      {
        error: 'readme_api_unreachable',
        detail:
          'Neither the categories nor the pages endpoint answered. Check that README_IO_API_KEY is a valid project key.',
        apiVersion,
        branch,
        status: { categories: categories.status, pages: existingPages.status },
        body: categories.body ?? categories.raw ?? null,
      },
      502,
    );
  }

  const wanted = [...new Set(PAGES.map((p) => p.category))];
  const categoryRefs: Record<string, string> = {};
  const categoryNotes: Record<string, string> = {};

  for (const slug of wanted) {
    let ref = findCategoryRef(categories.body, slug, apiVersion);
    if (ref) {
      categoryNotes[slug] = 'matched by slug';
    } else if (mode === 'sync' && !dryRun) {
      const created = await api.createCategory(slug, CATEGORY_TITLES[slug] ?? slug);
      ref =
        findCategoryRef(created.body, slug, apiVersion) ??
        firstCategoryRef(created.body, apiVersion);
      categoryNotes[slug] = created.ok ? 'created' : `create failed (${created.status})`;
    }
    if (!ref) {
      // Last resort: reuse a category that demonstrably exists — the one an
      // existing page sits in, else the first in the listing. Publishing into a
      // real-but-imperfect category is fixable in the ReadMe UI; failing the
      // whole sync over category placement is not worth it.
      ref =
        anyPageCategoryRef(existingPages.body, apiVersion) ??
        firstCategoryRef(categories.body, apiVersion);
      if (ref) categoryNotes[slug] ??= 'reused an existing category';
    }
    if (ref) categoryRefs[slug] = ref;
    else categoryNotes[slug] ??= 'UNRESOLVED';
  }

  // ---- 5. Probe: read-only report --------------------------------------
  if (mode === 'probe') {
    return json({
      ok: Object.keys(categoryRefs).length === wanted.length,
      mode,
      apiVersion,
      detection,
      branch,
      status: { categories: categories.status, pages: existingPages.status },
      categoryRefs,
      categoryNotes,
      pages: PAGES.map((p) => ({
        slug: p.slug,
        title: p.title,
        category: p.category,
        position: p.position,
        bytes: p.body.length,
        source: p.source,
        categoryResolved: !!categoryRefs[p.category],
      })),
    });
  }

  // ---- 6. Sync: upsert every page --------------------------------------
  const results: PageResult[] = [];

  for (const page of PAGES) {
    const categoryRef = categoryRefs[page.category];
    if (!categoryRef) {
      results.push({
        slug: page.slug,
        action: 'failed',
        error: `could not resolve a category for "${page.category}"`,
      });
      continue;
    }

    const payload: PagePayload = {
      slug: page.slug,
      title: page.title,
      body: page.body,
      excerpt: page.excerpt,
      position: page.position,
      categoryRef,
    };

    const existing = await api.getPage(page.slug);
    const exists = existing.ok;

    if (dryRun) {
      results.push({
        slug: page.slug,
        action: 'skipped',
        status: existing.status,
        error: exists ? undefined : 'would be created',
      });
      continue;
    }

    const res = exists ? await api.updatePage(payload) : await api.createPage(payload);

    results.push({
      slug: page.slug,
      action: res.ok ? (exists ? 'updated' : 'created') : 'failed',
      status: res.status,
      ...(res.ok ? {} : { error: JSON.stringify(res.body ?? res.raw ?? null).slice(0, 300) }),
    });
  }

  const failed = results.filter((r) => r.action === 'failed');
  return json(
    {
      ok: failed.length === 0,
      mode,
      apiVersion,
      dryRun,
      branch,
      counts: {
        created: results.filter((r) => r.action === 'created').length,
        updated: results.filter((r) => r.action === 'updated').length,
        skipped: results.filter((r) => r.action === 'skipped').length,
        failed: failed.length,
      },
      pages: results,
    },
    failed.length === 0 ? 200 : 207,
  );
});
