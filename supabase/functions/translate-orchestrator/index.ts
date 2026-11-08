// translate-orchestrator — game-string translation job state machine.
// Contract: docs/translation/ARCHITECTURE.md. Operations: docs/translation/OPERATIONS.md.
//
//   POST { op: 'tick' }                              advance every open job one step
//   POST { op: 'approve' | 'cancel', job_id }        admin
//   POST { op: 'estimate', build_id, lang, mode? }   admin dry run, no writes
//   POST { op: 'start_full', build_id, lang }        admin, always parks in awaiting_approval
//   POST { op: 'import_seed', source_id }            admin, community pack -> TM (licensed|permitted only)
//   POST { op: 'sync_sources' }                      daily pg_cron (publishable key) or admin
//   POST { op: 'learn', lang }                       admin, learning backfill (hook)
//   POST { op: 'draft_outreach', source_id }         admin, maintainer message DRAFT (never sent)
//
// AUTH (verify_jwt = false in config.toml; checked here):
//   * service-role key       -> every op
//   * the project's anon key -> `tick` ONLY (pg_cron has no vault for the service key). Safe:
//                               a tick only advances existing jobs and spends nothing unless
//                               settings.enabled and a job is queued/approved. Concurrent ticks
//                               are harmless: every transition is a compare-and-set.
//   * the anon/publishable key -> also `sync_sources` (daily cron): it only re-imports enabled
//                               licensed|permitted sources whose upstream changed.
//   * a user JWT whose profiles.role = 'admin' -> every op
// The Anthropic key is TRANSLATE_ANTHROPIC_API_KEY only; absent -> jobs fail with
// `translate.no_api_key`. It is never the sc-events-sync key.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';
import { deleteObject, getObject, putObject, r2FromEnv } from '../ingest-skins/_r2.ts';
import { BUILD_ID_RE, LANG_RE } from '../ingest-catalog/_locale-shards.ts';
import { makeLlm } from './_anthropic.ts';
import { makeDb } from './_db.ts';
import { approve, cancel, dryRun, startFull, tick, TranslateError } from './_machine.ts';
import type { Deps } from './_machine.ts';
import type { Store } from './_io.ts';
import { learningHooks } from './_hooks.ts';
import { draftOutreach, importSeed, listSources, syncSources } from './_sources.ts';
import { buildOverlayMeta } from './_io.ts';
import { writeAlerts } from './_alerts.ts';
import { makeLearnDb } from './_learn_db.ts';

function logWarn(msg: string, data?: Record<string, unknown>): void {
  console.warn(`translate-orchestrator: ${msg}`, data ? JSON.stringify(data) : '');
}
function logError(msg: string, data?: Record<string, unknown>): void {
  console.error(`translate-orchestrator: ${msg}`, data ? JSON.stringify(data) : '');
}

const SOURCE_ID_RE = /^[a-z0-9][a-z0-9_-]{0,63}$/;

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, 'content-type': 'application/json' } });
}

function bearer(req: Request): string {
  const h = req.headers.get('authorization') ?? '';
  return h.startsWith('Bearer ') ? h.slice(7).trim() : '';
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);

  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
  const admin = createClient(supabaseUrl, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } });

  // deno-lint-ignore no-explicit-any
  let body: any;
  try {
    body = await req.json();
  } catch {
    return json({ error: 'bad_json' }, 400);
  }
  const op = String(body?.op ?? '');

  // ── auth ──
  const token = bearer(req) || (req.headers.get('apikey') ?? '');
  let actor: string | null = null; // admin user id; null for service role
  let allowed = false;
  if (token && serviceKey && token === serviceKey) allowed = true;
  // tick is the pg_cron entry point. The cron job sends the public sb_publishable_* key, which
  // the runtime's SUPABASE_ANON_KEY may not equal (it can still hold the legacy JWT). Both are
  // public, and tick only advances jobs already inside the caps, so either one is enough.
  else if ((op === 'tick' || op === 'sync_sources') && token && ((anonKey && token === anonKey) || token.startsWith('sb_publishable_'))) allowed = true;
  else if (token) {
    const { data: { user } } = await admin.auth.getUser(token);
    if (user) {
      const { data: p } = await admin.from('profiles').select('role').eq('id', user.id).maybeSingle();
      if ((p as { role?: string } | null)?.role === 'admin') {
        allowed = true;
        actor = user.id;
      } else return json({ error: 'forbidden' }, 403);
    }
  }
  if (!allowed) return json({ error: 'unauthorized' }, 401);

  const r2 = r2FromEnv((k) => Deno.env.get(k));
  if (!r2) return json({ error: 'translate.r2_not_configured' }, 503);
  const store: Store = {
    async getJson(key) {
      try {
        return JSON.parse(new TextDecoder().decode(await getObject(r2, key, 128 * 1024 * 1024)));
      } catch (e) {
        if (/HTTP 404/.test(String((e as Error).message))) return null;
        throw e;
      }
    },
    putJson: (key, value) => putObject(r2, key, JSON.stringify(value), 'application/json'),
    deleteKey: (key) => deleteObject(r2, key),
  };
  const apiKey = (Deno.env.get('TRANSLATE_ANTHROPIC_API_KEY') ?? '').trim();
  const deps: Deps = {
    db: makeDb(admin, () => new Date()),
    store,
    llm: apiKey ? makeLlm(apiKey) : null,
    now: () => new Date(),
    log: (msg, data) => logWarn(msg, data),
    learn: makeLearnDb(admin, () => new Date()),
    overlayMeta: async (lang, entries, tm) => buildOverlayMeta(lang, entries, tm, await listSources(admin, lang)),
    alerts: async (lang, buildId, rows) => {
      await writeAlerts(admin, lang, buildId, rows);
    },
  };

  try {
    switch (op) {
      case 'tick': {
        const work = tick(deps);
        // A tick can outlast the response; the platform keeps the isolate alive for it.
        (globalThis as { EdgeRuntime?: { waitUntil(p: Promise<unknown>): void } }).EdgeRuntime?.waitUntil?.(work.catch(() => {}));
        return json({ ok: true, jobs: await work });
      }
      case 'approve':
        if (!body.job_id) return json({ error: 'job_id_required' }, 400);
        return json({ ok: true, job: await approve(deps, String(body.job_id), actor) });
      case 'cancel':
        if (!body.job_id) return json({ error: 'job_id_required' }, 400);
        return json({ ok: true, job: await cancel(deps, String(body.job_id)) });
      case 'estimate':
      case 'start_full': {
        const build_id = String(body.build_id ?? '');
        const lang = String(body.lang ?? '');
        if (!BUILD_ID_RE.test(build_id) || !LANG_RE.test(lang)) return json({ error: 'bad_params' }, 400);
        if (op === 'start_full') return json({ ok: true, job: await startFull(deps, build_id, lang) });
        const mode = body.mode === 'full' ? 'full' : 'delta';
        let base: string | null = null;
        if (mode === 'delta') {
          base = BUILD_ID_RE.test(String(body.base_build_id ?? '')) ? String(body.base_build_id) : null;
        }
        return json({ ok: true, estimate: await dryRun(deps, build_id, lang, mode, base) });
      }
      case 'import_seed': {
        const sourceId = String(body.source_id ?? '');
        if (!SOURCE_ID_RE.test(sourceId)) return json({ error: 'bad_params' }, 400);
        return json({ ok: true, ...(await importSeed(deps, admin, sourceId, { ghToken: Deno.env.get('GITHUB_TOKEN') ?? undefined })) });
      }
      case 'sync_sources': {
        const work = syncSources(deps, admin, { ghToken: Deno.env.get('GITHUB_TOKEN') ?? undefined });
        (globalThis as { EdgeRuntime?: { waitUntil(p: Promise<unknown>): void } }).EdgeRuntime?.waitUntil?.(work.catch(() => {}));
        return json({ ok: true, ...(await work) });
      }
      case 'learn': {
        const lang = String(body.lang ?? '');
        if (!LANG_RE.test(lang)) return json({ error: 'bad_params' }, 400);
        return json({ ok: true, lang, result: await learningHooks.runLearning(deps, lang, 'backfill') });
      }
      case 'draft_outreach': {
        const sourceId = String(body.source_id ?? '');
        if (!SOURCE_ID_RE.test(sourceId)) return json({ error: 'bad_params' }, 400);
        return json({ ok: true, outreach: await draftOutreach(admin, sourceId) });
      }
      default:
        return json({ error: 'unknown_op' }, 400);
    }
  } catch (e) {
    if (e instanceof TranslateError) return json({ error: e.key }, 409);
    // Upstream fetch problems of a community source (not our bug): keep the key, 502.
    const em = String((e as Error)?.message ?? '');
    if (em.startsWith('translate.source_')) return json({ error: em }, 502);
    logError('translate-orchestrator failed', { op, error: String((e as Error)?.message ?? e) });
    return json({ error: 'translate.internal' }, 500);
  }
});
