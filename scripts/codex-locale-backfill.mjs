#!/usr/bin/env node
/**
 * codex-locale-backfill — one-off: moves the de + en global.ini strings of the
 * current LIVE codex build from codex_locale_strings into R2 shards by calling
 * ingest-catalog `locale_backfill` once per language (storage.md "Codex locale
 * strings in R2").
 *
 * Run AFTER the migration 20261003140000_codex_locale_bundles is pushed and
 * ingest-catalog + the assets Worker are deployed. Idempotent: shards already
 * in R2 are skipped, locale_bundles[lang] is simply rewritten.
 *
 * Env:
 *   SUPABASE_SERVICE_ROLE_KEY  required — the ops gate of ingest-catalog
 *   SUPABASE_URL               default https://hcnqhvzlavdycidqyaai.supabase.co
 *   BUILD_ID                   optional — default: the is_current LIVE build
 *
 * Usage: node scripts/codex-locale-backfill.mjs [--dry-run]
 */

const url = (process.env.SUPABASE_URL ?? 'https://hcnqhvzlavdycidqyaai.supabase.co').replace(/\/+$/, '');
const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
const dryRun = process.argv.includes('--dry-run');

async function currentLiveBuild() {
  const res = await fetch(
    `${url}/rest/v1/codex_builds?select=id,patch_version,build_number&is_current=eq.true&channel=eq.LIVE`,
    { headers: { apikey: key, authorization: `Bearer ${key}` } },
  );
  if (!res.ok) throw new Error(`codex_builds lookup failed: HTTP ${res.status} ${await res.text()}`);
  const rows = await res.json();
  if (rows.length !== 1) throw new Error(`expected one current LIVE build, got ${rows.length}`);
  return rows[0];
}

async function backfill(buildId, lang) {
  const res = await fetch(`${url}/functions/v1/ingest-catalog`, {
    method: 'POST',
    headers: { authorization: `Bearer ${key}`, apikey: key, 'content-type': 'application/json' },
    body: JSON.stringify({ op: 'locale_backfill', build_id: buildId, lang }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`${lang}: HTTP ${res.status} ${JSON.stringify(body)}`);
  return body;
}

async function main() {
  if (!key) throw new Error('SUPABASE_SERVICE_ROLE_KEY is not set');
  const build = process.env.BUILD_ID ? { id: process.env.BUILD_ID } : await currentLiveBuild();
  console.log(`build ${build.id}${build.patch_version ? ` (${build.patch_version} ${build.build_number ?? ''})` : ''}`);
  if (dryRun) return;
  for (const lang of ['de', 'en']) {
    const r = await backfill(build.id, lang);
    console.log(`${lang}: ${r.bundle.keys} keys, ${r.bundle.bytes} bytes, ${r.uploaded} of 64 shards uploaded`);
  }
}

// exitCode, never process.exit(): exiting right after a failed fetch aborts
// Node 24 on Windows.
main().catch((e) => {
  console.error(e.message);
  process.exitCode = 1;
});
