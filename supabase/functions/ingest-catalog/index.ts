// supabase/functions/ingest-catalog
// ---------------------------------------------------------------
// Batched ingest of the extracted Codex catalog (ships / weapons /
// components / items / ammunition / manufacturers / blueprints + item-ports +
// blueprint ingredients + localized strings) into the codex_* tables. The
// extractor emits ~25k typed entities + ~115k generic records; that is far more
// than one edge-function body can hold, so this function is BATCHED and STATEFUL
// around a codex_builds row:
//
//   POST { op: "init",             build: {...} }                      -> { build_id }
//   POST { op: "upsert",           build_id, table, rows: [...] }      -> { upserted }
//   POST { op: "ports",            build_id, rows: [...] }             -> { inserted, degraded? }
//        (rows may carry hardpoint coordinates: helper_name/position/rotation)
//   POST { op: "clear_ports",      build_id }                          -> { ok }
//   POST { op: "ingredients",      build_id, rows: [...] }             -> { inserted }
//   POST { op: "clear_ingredients",build_id }                          -> { ok }
//   POST { op: "strings",          build_id, rows: [...] }             -> { upserted }
//   POST { op: "locale_strings",   build_id, rows: [...] }             -> { upserted }
//   POST { op: "silhouettes",      build_id, rows: [...] }             -> { upserted }
//        (rows: {kind, class_name, view_box, path, bbox, anchors, unresolved,
//         meta, generated_at} — Holotable outline contract, see wave0-research
//         §C1. Pinned column set like PORT_COLUMNS.)
//   POST { op: "clear_silhouettes",build_id }                          -> { ok }
//        (mirror of clear_ports)
//   POST { op: "constellation",    build_id, candidates: [...] }       -> { patch_line, class_name, kind }
//        (candidates: {class_name, kind:'ship'|'ground', points:[[x,y]×7]} —
//         the Verse-hub stars the uploader precomputed per ship silhouette;
//         the patch's newest vehicle is written into verse_constellations;
//         locked per patch line — a later build of the same patch keeps the
//         first pick and answers { locked: true } with the stored row)
//   POST { op: "preview",          build_number, name, content_base64 } -> { path }
//   POST { op: "finalize",         build_id, entity_counts? }          -> { ok, current, locale_publish }
//        (then, after the response: publishes the build's locale strings to R2
//         and deletes the rows once the public Worker serves them — see below)
//   POST { op: "locale_publish",   build_id, lang?, delete_source? }   -> { ok, results }
//        (service role or the gates below; one language per call keeps it short)
//
// LOCALIZATION STRINGS live in R2 since 2026-10-03 (storage plan): the
// `locale_strings` rows are only the staging area of a running ingest. See
// _locale-shards.ts for the layout and _locale-publish.ts for the order of steps.
//
// Each `upsert` carries one batch (recommend <= 500 rows) for ONE table; the
// caller loops over kinds and chunks. Writes use the service-role key (RLS is
// service-role-write only), so this function — not the client — owns writes.
//
// AUTH — two accepted gates:
//   (a) Production: Authorization: Bearer <jwt> of a collaborator/admin user
//       + X-SC-Release-Token: <uuid> of a current desktop_releases row.
//       (Mirrors ingest-bundle.)
//   (c) Operator: Authorization: Bearer <SUPABASE_SERVICE_ROLE_KEY> (the
//       sb_secret_ key) — scripts/codex-locale-to-r2.mjs.
//   (b) Seed:       X-SC-Seed-Token: <token> matching a row in
//       public.codex_seed_tokens (used by supabase/scripts/seed-codex via the
//       edge function so the local machine never needs the service-role key).
//
// Response codes: 200 ok; 400 invalid_body; 401 unauthorized; 403 forbidden;
//   500 ingest_failed; 503 ingest_timeout (Postgres cancelled the statement —
//   the caller should halve the batch and retry, see catalog-bridge.ts).

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';
import { bucketBytes, deleteObject, listObjects, putObject, r2FromEnv, readUsage } from '../ingest-skins/_r2.ts';
import { usageGate } from '../ingest-skins/_r2-usage.ts';
import { BUILD_ID_RE, LANG_RE } from './_locale-shards.ts';
import { publishLocale } from './_locale-publish.ts';
import {
  type ConstellationRow,
  type ConstellationStore,
  earliestByClass,
  lockConstellation,
  patchLineOf,
  pickNewest,
  sanitizeCandidates,
} from './_constellation.ts';
import type { PublishDeps, PublishResult } from './_locale-publish.ts';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type, x-sc-release-token, x-sc-seed-token',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...CORS },
  });
}

const CATALOG_TABLES = new Set([
  'codex_manufacturers', 'codex_ships', 'codex_weapons',
  'codex_components', 'codex_items', 'codex_ammunition',
  'codex_blueprints',
]);
const NAT_CONFLICT = 'channel,patch_version,build_number,class_name';

// ── item ports ───────────────────────────────────────────────────────────────
// Ports are INSERTed verbatim, so the accepted column set is pinned here: an
// extractor that grows a new field cannot accidentally reach the table (and a
// typo'd key surfaces as a dropped value instead of a 400 for the whole batch).
// `helper_name` / `position` / `rotation` are the hardpoint coordinates added by
// migration 20260726220000 — optional in both directions (see the `ports` op).
const PORT_COLUMNS = [
  'build_id', 'channel', 'patch_version', 'build_number',
  'parent_class_name', 'parent_kind', 'port_name',
  'min_size', 'max_size', 'types', 'flags', 'port_index',
  'helper_name', 'position', 'rotation',
] as const;
const PORT_TRANSFORM_COLUMNS = ['helper_name', 'position', 'rotation'] as const;

// ── silhouettes (Holotable outline contract, wave0-research §C1) ──────────────
// Same pinned-column discipline as PORT_COLUMNS: an uploader field that has no
// matching DB column is dropped, not blindly forwarded.
const SILHOUETTE_COLUMNS = [
  'build_id', 'channel', 'patch_version', 'build_number',
  'kind', 'class_name', 'view_box', 'path', 'bbox', 'anchors',
  'unresolved', 'meta', 'generated_at',
] as const;
const SILHOUETTE_CONFLICT = 'channel,patch_version,build_number,kind,class_name';

function sanitizeSilhouetteRow(row: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of SILHOUETTE_COLUMNS) {
    if (row[key] !== undefined) out[key] = row[key];
  }
  return out;
}

function sanitizePortRow(row: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of PORT_COLUMNS) {
    if (row[key] !== undefined) out[key] = row[key];
  }
  return out;
}

function stripTransform(row: Record<string, unknown>): Record<string, unknown> {
  const out = { ...row };
  for (const key of PORT_TRANSFORM_COLUMNS) delete out[key];
  return out;
}

/** True when Postgres rejected the insert because a transform column is absent. */
function isMissingTransformColumn(error: unknown): boolean {
  const e = error as { code?: string; message?: string };
  const msg = (e?.message ?? '').toLowerCase();
  const missingColumn = e?.code === 'PGRST204' || e?.code === '42703' ||
    msg.includes('could not find') || msg.includes('does not exist') ||
    msg.includes('column');
  return missingColumn && PORT_TRANSFORM_COLUMNS.some((c) => msg.includes(c));
}

// ── localization strings → R2 ────────────────────────────────────────────────
type R2 = NonNullable<ReturnType<typeof r2FromEnv>>;
type Admin = ReturnType<typeof createClient>;
/** Rows per export/delete RPC — ~1-2 s each, measured 2026-10-03. */
const LOCALE_PAGE = 20_000;
/** Languages the web app reads (src/app/codex/codex.types.ts `Lang`). */
const READ_LANGS = new Set(['de', 'en']);

/** Public read path the publish verifies against (cloudflare/assets-worker). */
function assetsPublicBase(): string {
  return (Deno.env.get('ASSETS_PUBLIC_URL') ?? 'https://sc-assets.sc-assets-worker.workers.dev').replace(/\/+$/, '');
}

/** Run `p` after the response is flushed (fallback: just let it run). */
function afterResponse(p: Promise<unknown>): void {
  (globalThis as { EdgeRuntime?: { waitUntil(promise: Promise<unknown>): void } }).EdgeRuntime?.waitUntil?.(p);
}

/**
 * The same cost kill-switch ingest-skins applies before signing (storage.md
 * § R2 cost guard): fail closed while usage is unknown, refuse near the free
 * tier or past the bucket quota. null = writes may go ahead.
 */
async function r2WriteBlocked(r2: R2): Promise<{ status: number; code: string; message: string } | null> {
  const { reading, error } = await readUsage(r2);
  const gate = usageGate(reading, error, Date.now());
  if (gate.kind === 'unknown') return { status: 503, code: 'r2_usage_unknown', message: gate.reason };
  if (gate.kind === 'over') return { status: 507, code: 'r2_free_tier_guard', message: `R2 usage near the free tier: ${gate.over}` };
  const used = await bucketBytes(r2);
  if (used >= r2.quotaBytes) {
    return { status: 507, code: 'storage_quota_exceeded', message: `R2 holds ${used} of ${r2.quotaBytes} bytes` };
  }
  return null;
}

function publishDeps(admin: Admin, r2: R2): PublishDeps {
  const base = assetsPublicBase();
  return {
    async exportLang(buildId, lang) {
      // Keyset pages: the authenticator's 8 s statement_timeout covers each RPC.
      const out: Record<string, string> = {};
      let after: string | null = null;
      for (;;) {
        const { data, error } = await admin.rpc('codex_locale_export', {
          p_build_id: buildId, p_lang: lang, p_after: after, p_limit: LOCALE_PAGE,
        });
        if (error) throw error;
        const page = ((data ?? []) as { entries: Record<string, string>; last_key: string | null; n: number }[])[0];
        if (!page || !page.n) return out;
        Object.assign(out, page.entries);
        if (page.n < LOCALE_PAGE || !page.last_key) return out;
        after = page.last_key;
      }
    },
    putJson: (key, body) => putObject(r2, key, body, 'application/json'),
    async readPublic(key) {
      try {
        // The query string only defeats intermediate caches; the Worker keys on the path.
        const res = await fetch(`${base}/${key}?verify=${Date.now()}`, { signal: AbortSignal.timeout(15_000) });
        return res.ok ? await res.json() : null;
      } catch {
        return null;
      }
    },
    listKeys: async (prefix) => (await listObjects(r2, prefix)).map((o) => o.key),
    deleteKey: (key) => deleteObject(r2, key),
    async deleteRows(buildId, lang) {
      let total = 0;
      for (;;) {
        const { data, error } = await admin.rpc('codex_locale_delete', {
          p_build_id: buildId, p_lang: lang, p_limit: LOCALE_PAGE,
        });
        if (error) throw error;
        const n = Number(data ?? 0);
        total += n;
        if (n < LOCALE_PAGE) return total;
      }
    },
  };
}

/** Publishes the given languages (null = every language the build has rows for). */
async function publishBuildLocales(
  admin: Admin,
  r2: R2,
  buildId: string,
  langs: string[] | null,
  deleteSource: boolean,
  gateChecked = false,
): Promise<PublishResult[]> {
  if (!gateChecked) {
    const blocked = await r2WriteBlocked(r2);
    if (blocked) throw new Error(`${blocked.code}: ${blocked.message}`);
  }
  let list = langs;
  if (!list) {
    const { data, error } = await admin.rpc('codex_locale_langs', { p_build_id: buildId });
    if (error) throw error;
    list = ((data ?? []) as { lang: string }[]).map((r) => r.lang).filter((l) => LANG_RE.test(l));
  }
  const deps = publishDeps(admin, r2);
  const results: PublishResult[] = [];
  for (const lang of list) results.push(await publishLocale(deps, buildId, lang, { deleteSource }));
  return results;
}

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);

  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  if (!supabaseUrl || !serviceKey) return json({ error: 'server_misconfigured' }, 500);

  const admin = createClient(supabaseUrl, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  // === Auth: seed-token OR collaborator-jwt+release-token ===
  const seedToken = req.headers.get('x-sc-seed-token');
  const authHeader = req.headers.get('authorization');
  const releaseToken = req.headers.get('x-sc-release-token');

  let authed = false;
  if (authHeader && authHeader === `Bearer ${serviceKey}`) {
    authed = true;
  } else if (seedToken) {
    const { data: tok } = await admin
      .from('codex_seed_tokens')
      .select('token, expires_at, disabled')
      .eq('token', seedToken)
      .maybeSingle();
    if (
      tok && !(tok as { disabled?: boolean }).disabled &&
      (!(tok as { expires_at?: string }).expires_at ||
        new Date((tok as { expires_at: string }).expires_at) > new Date())
    ) {
      authed = true;
    } else {
      return json({ error: 'forbidden', message: 'invalid seed token' }, 403);
    }
  } else if (authHeader && anonKey) {
    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user } } = await userClient.auth.getUser();
    if (!user) return json({ error: 'unauthorized' }, 401);
    const { data: profile } = await userClient
      .from('profiles').select('role').eq('id', user.id).maybeSingle();
    const role = (profile as { role?: string } | null)?.role ?? '';
    if (!['admin', 'collaborator'].includes(role)) return json({ error: 'forbidden' }, 403);
    if (!releaseToken) return json({ error: 'missing_release_token' }, 400);
    // is_current was dropped by the desktop-channels migration; a known,
    // non-revoked token is valid (mirrors desktop-latest / ingest-bundle).
    // product='uploader' only — the Starscape tray app bakes a release token into
    // a public, unsigned binary, so an unscoped match would accept it here too.
    const { data: release, error: relErr } = await admin
      .from('desktop_releases').select('id, token_revoked')
      .eq('release_token', releaseToken).eq('product', 'uploader').maybeSingle();
    if (relErr) return json({ error: 'server_misconfigured', message: relErr.message }, 500);
    if (!release || (release as { token_revoked: boolean }).token_revoked) {
      return json({ error: 'forbidden', message: 'release token invalid/revoked' }, 403);
    }
    authed = true;
  }
  if (!authed) return json({ error: 'unauthorized' }, 401);

  // === Parse body ===
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json({ error: 'invalid_json' }, 400);
  }
  const op = String(body.op ?? '');

  try {
    if (op === 'init') {
      const b = (body.build ?? {}) as Record<string, unknown>;
      const channel = String(b.channel ?? '').trim();
      const patch = String(b.patch_version ?? '').trim();
      const build = String(b.build_number ?? '').trim();
      if (!channel || !patch) return json({ error: 'invalid_body', message: 'channel + patch_version required' }, 400);
      const { data, error } = await admin
        .from('codex_builds')
        .upsert(
          {
            channel, patch_version: patch, build_number: build,
            schema_version: b.schema_version ?? 1,
            quality_score: b.quality_score ?? null,
            tool_version: b.tool_version ?? null,
            entity_counts: b.entity_counts ?? {},
            manifest: b.manifest ?? {},
            extracted_at: new Date().toISOString(),
          },
          { onConflict: 'channel,patch_version,build_number' },
        )
        .select('id')
        .single();
      if (error) throw error;
      return json({ ok: true, build_id: (data as { id: string }).id });
    }

    if (op === 'upsert') {
      const table = String(body.table ?? '');
      const rows = body.rows as unknown[];
      if (!CATALOG_TABLES.has(table)) return json({ error: 'invalid_body', message: 'bad table' }, 400);
      if (!Array.isArray(rows) || rows.length === 0) return json({ error: 'invalid_body', message: 'rows required' }, 400);
      const { error } = await admin.from(table).upsert(rows, { onConflict: NAT_CONFLICT });
      if (error) throw error;
      return json({ ok: true, upserted: rows.length });
    }

    if (op === 'keybinds') {
      const rows = body.rows as unknown[];
      if (!Array.isArray(rows) || rows.length === 0) return json({ error: 'invalid_body', message: 'rows required' }, 400);
      const { error } = await admin
        .from('codex_keybinds')
        .upsert(rows, { onConflict: 'channel,patch_version,build_number,actionmap,action_name' });
      if (error) throw error;
      return json({ ok: true, upserted: rows.length });
    }

    if (op === 'strings') {
      const rows = body.rows as unknown[];
      if (!Array.isArray(rows) || rows.length === 0) return json({ error: 'invalid_body', message: 'rows required' }, 400);
      const { error } = await admin
        .from('codex_entity_strings')
        .upsert(rows, { onConflict: 'build_id,entity_class_name,lang,field' });
      if (error) throw error;
      return json({ ok: true, upserted: rows.length });
    }

    if (op === 'ports') {
      const rows = body.rows as unknown[];
      if (!Array.isArray(rows) || rows.length === 0) return json({ error: 'invalid_body', message: 'rows required' }, 400);
      const clean = (rows as Record<string, unknown>[]).map(sanitizePortRow);
      const { error } = await admin.from('codex_item_ports').insert(clean);
      if (!error) return json({ ok: true, inserted: clean.length });
      // Forwards compatibility: an uploader that already sends hardpoint
      // coordinates must not fail against a project where the additive
      // 20260726220000 migration has not been applied yet. Retry once without the
      // transform columns and say so, rather than losing the whole port batch.
      if (!isMissingTransformColumn(error)) throw error;
      const legacy = clean.map(stripTransform);
      const retry = await admin.from('codex_item_ports').insert(legacy);
      if (retry.error) throw retry.error;
      return json({ ok: true, inserted: legacy.length, degraded: 'no_transform_columns' });
    }

    if (op === 'locale_strings') {
      const rows = body.rows as unknown[];
      if (!Array.isArray(rows) || rows.length === 0) return json({ error: 'invalid_body', message: 'rows required' }, 400);
      // The app reads de + en only; other languages would just inflate the
      // staging table and the R2 publish.
      const kept = rows.filter((r) => READ_LANGS.has(String((r as { lang?: unknown })?.lang ?? '')));
      if (kept.length > 0) {
        const { error } = await admin
          .from('codex_locale_strings')
          .upsert(kept, { onConflict: 'build_id,lang,key' });
        if (error) throw error;
      }
      return json({ ok: true, upserted: kept.length, skipped: rows.length - kept.length });
    }

    if (op === 'preview') {
      // Upload a single preview image (base64) to the public codex-previews
      // bucket at <build_number>/<name>. Only the deduped, actually-used files
      // are sent by the seeder, so the bucket holds just the final art.
      const build = String(body.build_number ?? '').trim();
      const name = String(body.name ?? '').trim();
      const b64 = String(body.content_base64 ?? '');
      if (!build || !name || !b64) return json({ error: 'invalid_body', message: 'build_number+name+content_base64 required' }, 400);
      const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
      const path = `${build}/${name}`;
      const { error } = await admin.storage
        .from('codex-previews')
        .upload(path, bytes, { contentType: 'image/webp', upsert: true });
      if (error) throw error;
      return json({ ok: true, path });
    }

    if (op === 'clear_ports') {
      const buildId = String(body.build_id ?? '');
      if (!buildId) return json({ error: 'invalid_body' }, 400);
      const { error } = await admin.from('codex_item_ports').delete().eq('build_id', buildId);
      if (error) throw error;
      return json({ ok: true });
    }

    if (op === 'silhouettes') {
      const rows = body.rows as unknown[];
      if (!Array.isArray(rows) || rows.length === 0) return json({ error: 'invalid_body', message: 'rows required' }, 400);
      const clean = (rows as Record<string, unknown>[]).map(sanitizeSilhouetteRow);
      // Forward-compat degrade (mirrors `ports`): a project without the
      // additive codex_silhouettes migration applied yet must not fail the
      // whole catalog run — the caller's finalize still succeeds, just
      // without Holotable art for this build.
      const { error } = await admin.from('codex_silhouettes').upsert(clean, { onConflict: SILHOUETTE_CONFLICT });
      if (!error) return json({ ok: true, upserted: clean.length });
      const msg = ((error as { message?: string })?.message ?? '').toLowerCase();
      const missingTable = msg.includes('could not find the table') || msg.includes('does not exist') ||
        (error as { code?: string })?.code === 'PGRST205' || (error as { code?: string })?.code === '42P01';
      if (!missingTable) throw error;
      return json({ ok: true, upserted: 0, degraded: 'no_silhouettes_table' });
    }

    if (op === 'clear_silhouettes') {
      const buildId = String(body.build_id ?? '');
      if (!buildId) return json({ error: 'invalid_body' }, 400);
      const { error } = await admin.from('codex_silhouettes').delete().eq('build_id', buildId);
      if (!error) return json({ ok: true });
      const msg = ((error as { message?: string })?.message ?? '').toLowerCase();
      const missingTable = msg.includes('could not find the table') || msg.includes('does not exist') ||
        (error as { code?: string })?.code === 'PGRST205' || (error as { code?: string })?.code === '42P01';
      if (!missingTable) throw error;
      return json({ ok: true, degraded: 'no_silhouettes_table' });
    }

    if (op === 'constellation') {
      // Verse-hub constellation: the uploader sends every ship silhouette's
      // precomputed 7 stars; we keep the patch's newest vehicle (see
      // _constellation.ts). The first pick per patch line is locked: a later
      // build of the same patch never overwrites it. Missing
      // verse_constellations table degrades like `silhouettes` — the catalog
      // run must not fail over it.
      const buildId = String(body.build_id ?? '');
      if (!buildId) return json({ error: 'invalid_body', message: 'build_id required' }, 400);
      const candidates = sanitizeCandidates(body.candidates);
      if (candidates.length === 0) return json({ ok: true, skipped: 'no_candidates' });

      const { data: build, error: bErr } = await admin
        .from('codex_builds').select('patch_version').eq('id', buildId).maybeSingle();
      if (bErr) throw bErr;
      if (!build) return json({ error: 'invalid_body', message: 'unknown build_id' }, 400);
      const patchLine = patchLineOf((build as { patch_version?: string }).patch_version);
      if (!patchLine) return json({ ok: true, skipped: 'no_patch_line' });

      const constellationMissing = (error: unknown) => {
        const msg = ((error as { message?: string })?.message ?? '').toLowerCase();
        const code = (error as { code?: string })?.code;
        return msg.includes('could not find the table') || msg.includes('does not exist') ||
          code === 'PGRST205' || code === '42P01';
      };
      const store: ConstellationStore = {
        async find(line) {
          const { data, error } = await admin.from('verse_constellations')
            .select('patch_line, class_name, kind, points, source_build_id')
            .eq('patch_line', line).maybeSingle();
          if (error) throw error;
          return (data as ConstellationRow | null) ?? null;
        },
        async insertIfAbsent(row) {
          // ignoreDuplicates = INSERT ... ON CONFLICT (patch_line) DO NOTHING;
          // the returned rows are empty when the patch line already had one.
          const { data, error } = await admin.from('verse_constellations')
            .upsert(row, { onConflict: 'patch_line', ignoreDuplicates: true })
            .select('patch_line');
          if (error) throw error;
          return (data ?? []).length > 0;
        },
      };
      const lockedReply = (row: ConstellationRow) =>
        json({ ok: true, locked: true, patch_line: row.patch_line, class_name: row.class_name, kind: row.kind });

      // Already locked: skip the candidate scoring (two paged scans) entirely.
      let existing: ConstellationRow | null;
      try {
        existing = await store.find(patchLine);
      } catch (e) {
        if (!constellationMissing(e)) throw e;
        return json({ ok: true, degraded: 'no_constellations_table' });
      }
      if (existing) return lockedReply(existing);

      const names = candidates.map((c) => c.class_name);
      const PAGE = 1000;
      const NAME_CHUNK = 100;
      // Drop AI/template variants the extractor flagged on this build's ships.
      const playable = new Set<string>();
      for (let i = 0; i < names.length; i += NAME_CHUNK) {
        const { data, error } = await admin.from('codex_ships').select('class_name')
          .eq('build_id', buildId).eq('is_variant', false).in('class_name', names.slice(i, i + NAME_CHUNK));
        if (error) throw error;
        for (const r of (data ?? []) as { class_name: string }[]) playable.add(r.class_name);
      }
      // No ship rows found (e.g. ships not uploaded yet): judge every candidate.
      const pool = playable.size > 0 ? candidates.filter((c) => playable.has(c.class_name)) : candidates;

      const seenRows: { class_name: string; created_at: string }[] = [];
      const poolNames = pool.map((c) => c.class_name);
      for (let i = 0; i < poolNames.length; i += NAME_CHUNK) {
        for (let from = 0; ; from += PAGE) {
          const { data, error } = await admin.from('codex_ships').select('class_name, created_at')
            .neq('build_id', buildId).in('class_name', poolNames.slice(i, i + NAME_CHUNK))
            .order('id', { ascending: true }).range(from, from + PAGE - 1);
          if (error) throw error;
          const page = (data ?? []) as { class_name: string; created_at: string }[];
          seenRows.push(...page);
          if (page.length < PAGE) break;
        }
      }
      const pick = pickNewest(pool, earliestByClass(seenRows));
      if (!pick) return json({ ok: true, skipped: 'no_candidates' });

      try {
        const { row, created } = await lockConstellation(store, {
          patch_line: patchLine,
          class_name: pick.class_name,
          kind: pick.kind,
          points: pick.points,
          source_build_id: buildId,
        });
        // Lost a race against a parallel upload of the same patch.
        if (!created) return lockedReply(row);
        return json({ ok: true, patch_line: patchLine, class_name: pick.class_name, kind: pick.kind });
      } catch (e) {
        if (!constellationMissing(e)) throw e;
        return json({ ok: true, degraded: 'no_constellations_table' });
      }
    }

    if (op === 'ingredients') {
      const rows = body.rows as unknown[];
      if (!Array.isArray(rows) || rows.length === 0) return json({ error: 'invalid_body', message: 'rows required' }, 400);
      // Idempotent on the natural key: the uploader's resumable chunk sender
      // persists its cursor BEFORE the call it guards, so a run killed
      // mid-flight replays exactly one chunk on resume. A plain insert
      // duplicated those recipe rows (and `clear_ingredients` only runs when a
      // phase starts from scratch, so it could never clean them up).
      // Requires the codex_bp_ingredients_natural_idx unique index — apply the
      // migration before deploying this function.
      const { error } = await admin
        .from('codex_blueprint_ingredients')
        .upsert(rows, {
          onConflict: 'build_id,blueprint_class_name,ingredient_index',
          ignoreDuplicates: false,
        });
      if (error) throw error;
      return json({ ok: true, inserted: rows.length });
    }

    if (op === 'clear_ingredients') {
      const buildId = String(body.build_id ?? '');
      if (!buildId) return json({ error: 'invalid_body' }, 400);
      const { error } = await admin.from('codex_blueprint_ingredients').delete().eq('build_id', buildId);
      if (error) throw error;
      return json({ ok: true });
    }

    if (op === 'finalize') {
      const buildId = String(body.build_id ?? '');
      if (!buildId) return json({ error: 'invalid_body' }, 400);
      if (body.entity_counts) {
        // A failed counts write must stop the finalize: the build would
        // otherwise go current without its entity counts (empty category
        // badges, "no blueprints" gates). The outer catch maps it to
        // 500 ingest_failed, or 503 on a statement timeout the uploader retries.
        const { error: countsErr } = await admin
          .from('codex_builds')
          .update({ entity_counts: body.entity_counts })
          .eq('id', buildId);
        if (countsErr) throw countsErr;
      }
      const { error } = await admin.rpc('set_current_codex_build', { p_build_id: buildId });
      if (error) throw error;
      const r2 = r2FromEnv((k) => Deno.env.get(k));
      if (!r2) return json({ ok: true, current: true, locale_publish: 'r2_not_configured' });
      // After the response: the uploader's finalize must not wait ~30 s for
      // 11 languages. A failure only leaves the rows in place (clients keep
      // reading them); locale_publish or the backfill script can redo it.
      afterResponse(
        publishBuildLocales(admin, r2, buildId, null, true)
          .then((results) => console.log(`ingest-catalog: locale publish ${buildId}: ${JSON.stringify(results)}`))
          .catch((e) => console.error(`ingest-catalog: locale publish ${buildId} failed: ${(e as Error).message}`)),
      );
      return json({ ok: true, current: true, locale_publish: 'started' });
    }

    if (op === 'locale_publish') {
      const buildId = String(body.build_id ?? '');
      const lang = body.lang === undefined || body.lang === null ? null : String(body.lang);
      if (!BUILD_ID_RE.test(buildId) || (lang !== null && !LANG_RE.test(lang))) {
        return json({ error: 'invalid_body', message: 'build_id (uuid) and optional lang required' }, 400);
      }
      const r2 = r2FromEnv((k) => Deno.env.get(k));
      if (!r2) return json({ error: 'r2_not_configured' }, 503);
      const blocked = await r2WriteBlocked(r2);
      if (blocked) return json({ error: blocked.code, message: blocked.message }, blocked.status);
      const results = await publishBuildLocales(admin, r2, buildId, lang ? [lang] : null, body.delete_source === true, true);
      return json({ ok: true, results });
    }

    return json({ error: 'invalid_body', message: `unknown op '${op}'` }, 400);
  } catch (e) {
    // A cancelled statement is NOT a broken request: the batch was simply too
    // heavy for the role's statement budget. Classifying it separately lets the
    // uploader do the only thing that actually helps — halve the batch and
    // retry — instead of treating a whole multi-hour run as failed. 503 +
    // Retry-After also stops any generic client from hammering it.
    const err = e as { code?: string; message?: string };
    const msg = err?.message ?? String(e);
    const timedOut = err?.code === '57014' || /statement timeout|canceling statement/i.test(msg);
    if (timedOut) {
      return new Response(
        JSON.stringify({ error: 'ingest_timeout', code: err?.code ?? '57014', message: msg }),
        { status: 503, headers: { 'content-type': 'application/json', 'retry-after': '2', ...CORS } },
      );
    }
    return json({ error: 'ingest_failed', code: err?.code ?? null, message: msg }, 500);
  }
});
