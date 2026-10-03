// ingest-catalog locale ops: global.ini strings as content-addressed R2 shards
// (contract in _locale-shards.ts, storage.md "Codex locale strings in R2").
//
//   locale_sign     { build_id, lang, shards:[{sha256, bytes}] x64 }
//                   -> { ok, uploads:[{sha256, signedUrl, exists}] }
//                   presigned PUT per shard; a shard R2 already holds comes back
//                   with exists:true and signedUrl ''.
//   locale_commit   { build_id, lang, shards:[sha x64], keys, bytes }
//                   -> { ok, bundle }   409 shard_missing { missing:[sha] }
//                   verifies every object exists, then writes
//                   codex_builds.locale_bundles[lang].
//   locale_backfill { build_id, lang }   ADMIN ONLY
//                   -> { ok, bundle, uploaded }
//                   reads codex_locale_strings of that build+lang, builds the
//                   shards with the same buildShards() and PUTs the missing ones
//                   server-side, then writes locale_bundles[lang].
//
// R2 access and the cost gate (free-tier usage + bucket quota) are the
// ingest-skins helpers. NOTE for deploys: a change to ../ingest-skins/_r2*.ts
// does not mark ingest-catalog as changed for scripts/changed-edge-functions.mjs.

import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';
import { bucketBytes, listObjects, presignPut, r2FromEnv, readUsage } from '../ingest-skins/_r2.ts';
import { usageGate } from '../ingest-skins/_r2-usage.ts';
import { bundleOf, buildShards, shardObjectKey } from './_locale-shards.ts';
import type { LocaleBundle, LocaleLang } from './_locale-shards.ts';
import { parseBackfill, parseCommit, parseSign } from './_locale-body.ts';

type R2 = NonNullable<ReturnType<typeof r2FromEnv>>;
type Json = (body: unknown, status?: number) => Response;

/** Backfill page size: PostgREST's default max-rows. */
const PAGE = 1000;

/** Same kill-switch as ingest-skins: refuse while usage is unknown, near the free tier or past the quota. */
async function r2Gate(r2: R2, json: Json): Promise<Response | null> {
  const { reading, error } = await readUsage(r2);
  const gate = usageGate(reading, error, Date.now());
  if (gate.kind === 'unknown') return json({ error: 'r2_usage_unknown', message: gate.reason }, 503);
  if (gate.kind === 'over') {
    return json({ error: 'r2_free_tier_guard', message: `R2 usage near the free tier: ${gate.over}` }, 507);
  }
  let used: number;
  try {
    used = await bucketBytes(r2);
  } catch (e) {
    return json({ error: 'sign_failed', message: (e as Error).message }, 500);
  }
  if (used >= r2.quotaBytes) {
    return json({ error: 'storage_quota_exceeded', message: `R2 holds ${used} of ${r2.quotaBytes} bytes` }, 507);
  }
  return null;
}

async function mapLimit<T, R>(items: T[], n: number, fn: (x: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(n, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await fn(items[i]);
      }
    }),
  );
  return out;
}

async function exists(r2: R2, sha: string): Promise<boolean> {
  const key = shardObjectKey(sha);
  return (await listObjects(r2, key)).some((o) => o.key === key);
}

async function buildExists(admin: SupabaseClient, buildId: string): Promise<boolean> {
  const { data, error } = await admin.from('codex_builds').select('id').eq('id', buildId).maybeSingle();
  if (error) throw error;
  return !!data;
}

async function writeBundle(admin: SupabaseClient, buildId: string, lang: LocaleLang, bundle: LocaleBundle) {
  const { error } = await admin.rpc('set_codex_locale_bundle', {
    p_build_id: buildId,
    p_lang: lang,
    p_bundle: bundle,
  });
  if (error) throw error;
}

function needR2(json: Json): { r2: R2 } | { refused: Response } {
  const r2 = r2FromEnv((k) => Deno.env.get(k));
  return r2 ? { r2 } : { refused: json({ error: 'r2_required', message: 'locale bundles need R2' }, 501) };
}

export async function localeSign(admin: SupabaseClient, body: Record<string, unknown>, json: Json): Promise<Response> {
  const p = parseSign(body);
  if (!p.ok) return json({ error: 'invalid_body', message: p.message }, 400);
  const env = needR2(json);
  if ('refused' in env) return env.refused;
  if (!(await buildExists(admin, p.value.buildId))) return json({ error: 'build_not_found' }, 404);
  const refused = await r2Gate(env.r2, json);
  if (refused) return refused;
  const uploads = await mapLimit(p.value.shards, 8, async ({ sha256 }) =>
    (await exists(env.r2, sha256))
      ? { sha256, signedUrl: '', exists: true }
      : { sha256, signedUrl: await presignPut(env.r2, shardObjectKey(sha256)), exists: false }
  );
  return json({ ok: true, uploads });
}

export async function localeCommit(admin: SupabaseClient, body: Record<string, unknown>, json: Json): Promise<Response> {
  const p = parseCommit(body);
  if (!p.ok) return json({ error: 'invalid_body', message: p.message }, 400);
  const env = needR2(json);
  if ('refused' in env) return env.refused;
  const unique = [...new Set(p.value.shards)];
  const present = await mapLimit(unique, 8, (sha) => exists(env.r2, sha));
  const missing = unique.filter((_, i) => !present[i]);
  if (missing.length) return json({ error: 'shard_missing', missing }, 409);
  const bundle: LocaleBundle = { v: 1, shards: p.value.shards, keys: p.value.keys, bytes: p.value.bytes };
  await writeBundle(admin, p.value.buildId, p.value.lang, bundle);
  return json({ ok: true, bundle });
}

export async function localeBackfill(
  admin: SupabaseClient,
  body: Record<string, unknown>,
  json: Json,
): Promise<Response> {
  const p = parseBackfill(body);
  if (!p.ok) return json({ error: 'invalid_body', message: p.message }, 400);
  const env = needR2(json);
  if ('refused' in env) return env.refused;
  const { buildId, lang } = p.value;
  if (!(await buildExists(admin, buildId))) return json({ error: 'build_not_found' }, 404);

  // Keyset pagination on the (build_id, lang, key) primary key.
  const strings = new Map<string, string>();
  let after = '';
  for (;;) {
    let q = admin.from('codex_locale_strings').select('key, value')
      .eq('build_id', buildId).eq('lang', lang).order('key').limit(PAGE);
    if (after) q = q.gt('key', after);
    const { data, error } = await q;
    if (error) throw error;
    const rows = (data ?? []) as { key: string; value: string }[];
    for (const r of rows) strings.set(r.key, r.value);
    if (rows.length < PAGE) break;
    after = rows[rows.length - 1].key;
  }
  if (strings.size === 0) return json({ error: 'no_strings', message: `no ${lang} strings for this build` }, 404);

  const refused = await r2Gate(env.r2, json);
  if (refused) return refused;
  const shards = await buildShards(lang, strings);
  const uploaded = await mapLimit(shards, 8, async (s) => {
    if (await exists(env.r2, s.sha256)) return false;
    const url = await presignPut(env.r2, shardObjectKey(s.sha256));
    const res = await fetch(url, {
      method: 'PUT',
      body: s.body,
      headers: { 'content-type': 'application/json' },
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) throw new Error(`R2 put shard ${s.shard} failed: HTTP ${res.status}`);
    return true;
  });
  const bundle = bundleOf(shards);
  await writeBundle(admin, buildId, lang, bundle);
  return json({ ok: true, bundle, uploaded: uploaded.filter(Boolean).length });
}
