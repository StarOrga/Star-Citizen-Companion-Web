#!/usr/bin/env node
// Moves codex_locale_strings rows that are still in the database to R2
// (storage plan, 2026-10-03; layout in supabase/functions/ingest-catalog/
// _locale-shards.ts). New builds are published by ingest-catalog's finalize;
// this script covers builds ingested before that, and redoes a publish that
// failed.
//
// It does not write R2 itself: it calls ingest-catalog `locale_publish`, the
// one writer, which holds the R2 secret, applies the cost guard, writes the
// shards and the index, reads them back through the public Worker, and only
// then (with --delete-source) deletes the rows. No R2 credentials are needed
// here.
//
//   node scripts/codex-locale-to-r2.mjs                     dry run: plan only
//   node scripts/codex-locale-to-r2.mjs --apply             publish, keep rows
//   node scripts/codex-locale-to-r2.mjs --apply --delete-source
//                                                           publish, verify, delete rows
//   options: --build <uuid>  --lang <code>
//
// Env: SUPABASE_ACCESS_TOKEN (personal access token: SQL through the
// Management API, and the service key via api-keys?reveal=true unless
// SUPABASE_SERVICE_ROLE_KEY — the sb_secret_ key — is set).
// SUPABASE_PROJECT_REF (default hcnqhvzlavdycidqyaai), ASSETS_PUBLIC_URL.
// Secrets are never printed.
//
// Deleting rows does not shrink pg_database_size; autovacuum makes the pages
// reusable. Space goes back only with a manual, off-hours
// `vacuum full public.codex_locale_strings;` (storage.md).

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const opt = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};

const APPLY = flag('--apply');
const DELETE_SOURCE = flag('--delete-source');
const ONLY_BUILD = opt('--build');
const ONLY_LANG = opt('--lang');
const REF = process.env.SUPABASE_PROJECT_REF || 'hcnqhvzlavdycidqyaai';
const PAT = (process.env.SUPABASE_ACCESS_TOKEN || '').trim();
const ASSETS = (process.env.ASSETS_PUBLIC_URL || 'https://sc-assets.sc-assets-worker.workers.dev').replace(/\/+$/, '');
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const LANG_RE = /^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,4})?$/;

function fail(msg) {
  console.error(`codex-locale-to-r2: ${msg}`);
  process.exitCode = 1;
}

async function sql(query) {
  const res = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, {
    method: 'POST',
    headers: { authorization: `Bearer ${PAT}`, 'content-type': 'application/json' },
    body: JSON.stringify({ query }),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Management API SQL: HTTP ${res.status} ${text.slice(0, 200)}`);
  return JSON.parse(text);
}

async function serviceKey() {
  const fromEnv = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
  if (fromEnv) return fromEnv;
  const res = await fetch(`https://api.supabase.com/v1/projects/${REF}/api-keys?reveal=true`, {
    headers: { authorization: `Bearer ${PAT}` },
  });
  if (!res.ok) throw new Error(`api-keys: HTTP ${res.status}`);
  // The edge runtime's SUPABASE_SERVICE_ROLE_KEY is the NEW secret key, not the legacy JWT.
  const key = (await res.json()).find((k) => k.type === 'secret')?.api_key;
  if (!key) throw new Error('no secret API key on the project');
  return key;
}

async function publicIndex(build, lang) {
  try {
    const res = await fetch(`${ASSETS}/codex-locale/${build}/${lang}/index.json?check=${Date.now()}`);
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

async function publish(key, build, lang) {
  const res = await fetch(`https://${REF}.supabase.co/functions/v1/ingest-catalog`, {
    method: 'POST',
    headers: { authorization: `Bearer ${key}`, apikey: key, 'content-type': 'application/json' },
    body: JSON.stringify({ op: 'locale_publish', build_id: build, lang, delete_source: DELETE_SOURCE }),
    signal: AbortSignal.timeout(140_000),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`locale_publish ${build}/${lang}: HTTP ${res.status} ${body.error ?? ''} ${body.message ?? ''}`.trim());
  return body.results?.[0];
}

async function main() {
  if (!PAT) return fail('SUPABASE_ACCESS_TOKEN is not set');
  if (ONLY_BUILD && !UUID_RE.test(ONLY_BUILD)) return fail('--build must be a uuid');
  if (ONLY_LANG && !LANG_RE.test(ONLY_LANG)) return fail('--lang is not a language code');
  if (DELETE_SOURCE && !APPLY) return fail('--delete-source needs --apply');

  const where = [
    ONLY_BUILD ? `build_id = '${ONLY_BUILD}'` : null,
    ONLY_LANG ? `lang = '${ONLY_LANG}'` : null,
  ].filter(Boolean);
  const rows = await sql(
    `select build_id::text, lang, count(*)::int n from public.codex_locale_strings ` +
      `${where.length ? `where ${where.join(' and ')} ` : ''}group by 1, 2 order by 1, 2`,
  );
  const [{ db }] = await sql(`select pg_size_pretty(pg_database_size(current_database())) db`);
  console.log(`database ${db}; ${rows.length} build/language sets still in codex_locale_strings`);

  const plan = [];
  for (const r of rows) {
    const idx = await publicIndex(r.build_id, r.lang);
    const inR2 = idx && idx.build_id === r.build_id && idx.lang === r.lang ? `R2 gen ${idx.gen}, ${idx.count} keys` : 'not in R2';
    plan.push({ ...r, inR2 });
    console.log(`  ${r.build_id} ${r.lang.padEnd(7)} ${String(r.n).padStart(6)} rows   ${inR2}`);
  }
  if (!APPLY) {
    console.log('\ndry run — nothing written. --apply publishes, --apply --delete-source also deletes the rows.');
    return;
  }

  const key = await serviceKey();
  let bad = 0;
  for (const r of plan) {
    const res = await publish(key, r.build_id, r.lang);
    const okCount = res && res.count === r.n;
    const okDelete = !DELETE_SOURCE || (res?.verified && res.deleted === r.n);
    if (!okCount || !okDelete) bad++;
    console.log(
      `  ${okCount && okDelete ? 'ok  ' : 'FAIL'} ${r.build_id} ${r.lang.padEnd(7)} ` +
        `rows ${r.n} -> keys ${res?.count ?? '?'} in ${res?.shards ?? '?'} shards, ` +
        `verified ${res?.verified ?? false}, deleted ${res?.deleted ?? 0}`,
    );
  }

  const left = await sql(
    `select count(*)::int n from public.codex_locale_strings${where.length ? ` where ${where.join(' and ')}` : ''}`,
  );
  const [{ db: after }] = await sql(`select pg_size_pretty(pg_database_size(current_database())) db`);
  console.log(`\nrows left: ${left[0].n}; database ${after} (shrinks only after a manual VACUUM FULL)`);
  if (bad) fail(`${bad} set(s) did not verify — their rows were kept`);
}

main().catch((e) => fail(e.message));
