#!/usr/bin/env node
/**
 * One-time bulk copy of the cached news images from the Supabase `news-images`
 * bucket to Cloudflare R2 (news-images → R2, 2026-10-03).
 *
 * Lists the bucket through the Storage API, downloads each object from its
 * public Supabase URL and PUTs it to R2 under `news-images/<same path>`, with
 * the original content type and cache-control. Objects already in R2 with the
 * same size are skipped, so the script can be re-run after an interruption.
 *
 * DRY RUN BY DEFAULT — nothing is written until `--apply` is passed.
 *
 *   R2_ACCOUNT_ID=… R2_ACCESS_KEY_ID=… R2_SECRET_ACCESS_KEY=… \
 *   SUPABASE_SERVICE_ROLE_KEY=… node scripts/r2-migrate-news-images.mjs [--apply]
 *
 * SUPABASE_SERVICE_ROLE_KEY is needed for the listing (storage.objects has no
 * public select policy); never commit it. The source objects are left in place:
 * the Worker serves from R2 first, and fetch-verse-news' video pruning clears
 * both homes. Deleting the Supabase copies is a separate, later decision.
 *
 * No dependencies: SigV4 is signed with node:crypto.
 */
import { createHash, createHmac } from 'node:crypto';

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://hcnqhvzlavdycidqyaai.supabase.co';
const SOURCE_BUCKET = 'news-images';
const BUCKET = process.env.R2_BUCKET || 'sc-companion-assets';
const PREFIX = 'news-images/';
const DEFAULT_CACHE_CONTROL = 'public, max-age=31536000, immutable';
const PAGE = 1000;

const apply = process.argv.slice(2).includes('--apply');

const { R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, SUPABASE_SERVICE_ROLE_KEY } = process.env;

// ---------- SigV4 (S3, region auto) ----------
const HOST = `${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`;
const sha256 = (data) => createHash('sha256').update(data).digest('hex');
const hmac = (key, data) => createHmac('sha256', key).update(data).digest();

async function r2(method, key, body, extraHeaders = {}) {
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
  return fetch(`https://${HOST}${path}`, {
    method,
    headers: { ...headers, ...extraHeaders, authorization: auth },
    body: body ?? undefined,
  });
}

// ---------- Supabase listing ----------
/** Every object path in the bucket, depth-first over the `<hash>/` folders. */
async function listBucket(prefix = '') {
  const out = [];
  for (let offset = 0; ; offset += PAGE) {
    const res = await fetch(`${SUPABASE_URL}/storage/v1/object/list/${SOURCE_BUCKET}`, {
      method: 'POST',
      headers: {
        apikey: SUPABASE_SERVICE_ROLE_KEY,
        authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ prefix, limit: PAGE, offset, sortBy: { column: 'name', order: 'asc' } }),
    });
    if (!res.ok) throw new Error(`list ${prefix || '/'} failed: HTTP ${res.status} ${await res.text()}`);
    const entries = await res.json();
    for (const e of entries) {
      const path = prefix ? `${prefix}/${e.name}` : e.name;
      // Folders come back without an id; files carry one plus metadata.
      if (e.id == null) out.push(...(await listBucket(path)));
      else out.push({ path, size: Number(e.metadata?.size ?? -1) });
    }
    if (entries.length < PAGE) break;
  }
  return out;
}

async function main() {
  const objects = await listBucket();
  const total = objects.reduce((s, o) => s + Math.max(o.size, 0), 0);
  console.log(
    `${objects.length} objects (${(total / 1024 / 1024).toFixed(1)} MB) in ${SOURCE_BUCKET}` +
      (apply ? '' : ' — DRY RUN, pass --apply to copy'),
  );
  let copied = 0;
  let skipped = 0;
  let pending = 0;
  let bytes = 0;
  const failed = [];

  for (const { path, size } of objects) {
    const key = PREFIX + path;
    try {
      const head = await r2('HEAD', key);
      if (head.ok && size >= 0 && Number(head.headers.get('content-length')) === size) {
        skipped++;
        continue;
      }
      if (!apply) {
        pending++;
        console.log(`  would copy ${path} (${size} B)`);
        continue;
      }
      const src = await fetch(`${SUPABASE_URL}/storage/v1/object/public/${SOURCE_BUCKET}/${path}`);
      if (!src.ok) throw new Error(`source HTTP ${src.status}`);
      const body = Buffer.from(await src.arrayBuffer());
      const put = await r2('PUT', key, body, {
        'content-type': src.headers.get('content-type') || 'application/octet-stream',
        'cache-control': src.headers.get('cache-control') || DEFAULT_CACHE_CONTROL,
      });
      if (!put.ok) throw new Error(`R2 PUT HTTP ${put.status} ${await put.text()}`);
      copied++;
      bytes += body.length;
    } catch (e) {
      failed.push(path);
      console.error(`  ✗ ${path}: ${e.message}`);
    }
  }

  console.log(
    apply
      ? `copied ${copied} (${(bytes / 1024 / 1024).toFixed(1)} MB), already there ${skipped}, failed ${failed.length}`
      : `would copy ${pending}, already there ${skipped}, failed ${failed.length}`,
  );
  if (failed.length) process.exitCode = 1;
}

if (!R2_ACCOUNT_ID || !R2_ACCESS_KEY_ID || !R2_SECRET_ACCESS_KEY) {
  console.error('✗ R2_ACCOUNT_ID, R2_ACCESS_KEY_ID and R2_SECRET_ACCESS_KEY must be set.');
  process.exitCode = 1;
} else if (!SUPABASE_SERVICE_ROLE_KEY) {
  console.error('✗ SUPABASE_SERVICE_ROLE_KEY must be set to list the bucket.');
  process.exitCode = 1;
} else {
  await main();
}
