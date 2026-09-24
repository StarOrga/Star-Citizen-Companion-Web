#!/usr/bin/env node
/**
 * One-time bulk copy of the ship hulls and icons from the Supabase `ship-skins`
 * bucket to Cloudflare R2 (storage plan 2026-09-24).
 *
 * Reads the paths from public.ship_skins (model_path / icon_path; readable with
 * the publishable key), downloads each object from the public Supabase URL and
 * PUTs it to R2 under `ship-skins/<path>`. Objects already in R2 with the same
 * size are skipped, so the script can be re-run after an interruption.
 *
 *   R2_ACCOUNT_ID=… R2_ACCESS_KEY_ID=… R2_SECRET_ACCESS_KEY=… \
 *     node scripts/r2-migrate-ship-skins.mjs [--dry-run] [--delete-source]
 *
 * --delete-source  after a verified copy, removes the Supabase objects too.
 *                  Needs SUPABASE_SERVICE_ROLE_KEY (never commit it). Run it
 *                  only after the site reads from the Worker
 *                  (environment.assets.r2BaseUrl), otherwise hulls 404.
 *
 * No dependencies: SigV4 is signed with node:crypto.
 */
import { createHash, createHmac } from 'node:crypto';

const SUPABASE_URL = 'https://hcnqhvzlavdycidqyaai.supabase.co';
const PUBLISHABLE_KEY = 'sb_publishable_ZWbS9qWheOQB0s77mlWLvw_wEcmTVDQ';
const BUCKET = process.env.R2_BUCKET || 'sc-companion-assets';
const PREFIX = 'ship-skins/';
const CONTENT_TYPES = { glb: 'model/gltf-binary', webp: 'image/webp' };

const args = new Set(process.argv.slice(2));
const dryRun = args.has('--dry-run');
const deleteSource = args.has('--delete-source');

const { R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, SUPABASE_SERVICE_ROLE_KEY } = process.env;

// ---------- SigV4 (S3, region auto) ----------
const HOST = `${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`;
const sha256 = (data) => createHash('sha256').update(data).digest('hex');
const hmac = (key, data) => createHmac('sha256', key).update(data).digest();

async function r2(method, key, body) {
  const now = new Date();
  const amzDate = now.toISOString().replace(/[-:]|\.\d{3}/g, '');
  const day = amzDate.slice(0, 8);
  const path = `/${BUCKET}/${key.split('/').map(encodeURIComponent).join('/')}`;
  const payloadHash = body ? sha256(body) : sha256('');
  const headers = { host: HOST, 'x-amz-content-sha256': payloadHash, 'x-amz-date': amzDate };
  const signedHeaders = Object.keys(headers).sort().join(';');
  const canonical = [
    method,
    path,
    '',
    ...Object.keys(headers).sort().map((h) => `${h}:${headers[h]}`),
    '',
    signedHeaders,
    payloadHash,
  ].join('\n');
  const scope = `${day}/auto/s3/aws4_request`;
  const toSign = ['AWS4-HMAC-SHA256', amzDate, scope, sha256(canonical)].join('\n');
  let k = hmac(`AWS4${R2_SECRET_ACCESS_KEY}`, day);
  for (const part of ['auto', 's3', 'aws4_request']) k = hmac(k, part);
  const signature = createHmac('sha256', k).update(toSign).digest('hex');
  const auth = `AWS4-HMAC-SHA256 Credential=${R2_ACCESS_KEY_ID}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;
  const extra = body ? { 'content-type': CONTENT_TYPES[key.split('.').pop()] ?? 'application/octet-stream' } : {};
  return fetch(`https://${HOST}${path}`, {
    method,
    headers: { ...headers, ...extra, authorization: auth },
    body: body ?? undefined,
  });
}

// ---------- helpers ----------
async function skinPaths() {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/ship_skins?select=model_path,icon_path`,
    { headers: { apikey: PUBLISHABLE_KEY } },
  );
  if (!res.ok) throw new Error(`ship_skins read failed: HTTP ${res.status}`);
  const rows = await res.json();
  return [...new Set(rows.flatMap((r) => [r.model_path, r.icon_path]).filter(Boolean))].sort();
}

async function removeFromSupabase(paths) {
  const res = await fetch(`${SUPABASE_URL}/storage/v1/object/ship-skins`, {
    method: 'DELETE',
    headers: {
      apikey: SUPABASE_SERVICE_ROLE_KEY,
      authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({ prefixes: paths }),
  });
  if (!res.ok) throw new Error(`Supabase delete failed: HTTP ${res.status} ${await res.text()}`);
}

async function main() {
  const paths = await skinPaths();
  console.log(`${paths.length} objects referenced by ship_skins${dryRun ? ' (dry run)' : ''}`);
  let copied = 0;
  let skipped = 0;
  let bytes = 0;
  const verified = [];
  const failed = [];

  for (const path of paths) {
    const key = PREFIX + path;
    try {
      const src = await fetch(`${SUPABASE_URL}/storage/v1/object/public/ship-skins/${path}`);
      if (!src.ok) throw new Error(`source HTTP ${src.status}`);
      const body = Buffer.from(await src.arrayBuffer());

      const head = await r2('HEAD', key);
      if (head.ok && Number(head.headers.get('content-length')) === body.length) {
        skipped++;
        verified.push(path);
        continue;
      }
      if (dryRun) {
        console.log(`  would copy ${path} (${body.length} B)`);
        continue;
      }
      const put = await r2('PUT', key, body);
      if (!put.ok) throw new Error(`R2 PUT HTTP ${put.status} ${await put.text()}`);
      copied++;
      bytes += body.length;
      verified.push(path);
      console.log(`  ✓ ${path} (${(body.length / 1024 / 1024).toFixed(1)} MB)`);
    } catch (e) {
      failed.push(path);
      console.error(`  ✗ ${path}: ${e.message}`);
    }
  }

  console.log(
    `copied ${copied} (${(bytes / 1024 / 1024).toFixed(0)} MB), already there ${skipped}, failed ${failed.length}`,
  );

  if (deleteSource && !dryRun) {
    if (failed.length) {
      console.error('✗ Not deleting anything from Supabase: some copies failed. Re-run first.');
      process.exitCode = 1;
      return;
    }
    for (let i = 0; i < verified.length; i += 100) {
      await removeFromSupabase(verified.slice(i, i + 100));
    }
    console.log(`removed ${verified.length} objects from the Supabase ship-skins bucket`);
  }
  if (failed.length) process.exitCode = 1;
}

if (!R2_ACCOUNT_ID || !R2_ACCESS_KEY_ID || !R2_SECRET_ACCESS_KEY) {
  console.error('✗ R2_ACCOUNT_ID, R2_ACCESS_KEY_ID and R2_SECRET_ACCESS_KEY must be set.');
  process.exitCode = 1;
} else if (deleteSource && !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('✗ --delete-source needs SUPABASE_SERVICE_ROLE_KEY.');
  process.exitCode = 1;
} else {
  await main();
}
