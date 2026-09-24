// Cloudflare R2 access for ingest-skins (storage plan 2026-09-24).
//
// R2 speaks the S3 API. We only need four calls — presigned PUT, list, delete
// and the bucket-size sum for the quota guard — so aws4fetch (SigV4 on top of
// fetch, no SDK) is enough.
//
// Enabled only when ALL of R2_ACCOUNT_ID / R2_ACCESS_KEY_ID /
// R2_SECRET_ACCESS_KEY are set as Edge-Function secrets. Until then
// ingest-skins keeps writing to the Supabase `ship-skins` bucket, so shipping
// this code changes nothing on its own.
//
// Cost guard: R2 has no hard spending cap (Cloudflare budget alerts only
// notify). Writes are the one path we control, so `sign` refuses once the
// bucket holds R2_QUOTA_BYTES (default 8 GB, the free tier is 10 GB). Reads go
// through the public Worker (cloudflare/assets-worker), whose Free plan hard
// stops at 100k requests/day, which is below R2's free Class-B allowance.

import { AwsClient } from 'https://esm.sh/aws4fetch@1.0.20';

export interface R2Config {
  accountId: string;
  bucket: string;
  quotaBytes: number;
  client: AwsClient;
}

/** Key prefix inside the shared assets bucket. */
export const SKINS_PREFIX = 'ship-skins/';

const DEFAULT_BUCKET = 'sc-companion-assets';
const DEFAULT_QUOTA_BYTES = 8 * 1024 ** 3;
/** Presigned PUT lifetime. A ship's hull + icons upload well inside it. */
const PUT_EXPIRES_SECONDS = 3600;

export function r2FromEnv(get: (k: string) => string | undefined): R2Config | null {
  const accountId = (get('R2_ACCOUNT_ID') ?? '').trim();
  const accessKeyId = (get('R2_ACCESS_KEY_ID') ?? '').trim();
  const secretAccessKey = (get('R2_SECRET_ACCESS_KEY') ?? '').trim();
  if (!accountId || !accessKeyId || !secretAccessKey) return null;
  const quota = Number(get('R2_QUOTA_BYTES'));
  return {
    accountId,
    bucket: (get('R2_BUCKET') ?? '').trim() || DEFAULT_BUCKET,
    quotaBytes: Number.isFinite(quota) && quota > 0 ? quota : DEFAULT_QUOTA_BYTES,
    client: new AwsClient({ accessKeyId, secretAccessKey, service: 's3', region: 'auto' }),
  };
}

function bucketUrl(cfg: R2Config): string {
  return `https://${cfg.accountId}.r2.cloudflarestorage.com/${cfg.bucket}`;
}

/** Keys are built from SAFE_ID-checked segments only, so no encoding is needed. */
function objectUrl(cfg: R2Config, key: string): string {
  return `${bucketUrl(cfg)}/${key}`;
}

/** Presigned PUT URL for one object. Content-Type stays unsigned on purpose. */
export async function presignPut(cfg: R2Config, key: string): Promise<string> {
  const url = new URL(objectUrl(cfg, key));
  url.searchParams.set('X-Amz-Expires', String(PUT_EXPIRES_SECONDS));
  const signed = await cfg.client.sign(new Request(url, { method: 'PUT' }), {
    aws: { signQuery: true },
  });
  return signed.url;
}

export interface R2Object {
  key: string;
  size: number;
}

/** Pulls <Key>/<Size> pairs out of a ListObjectsV2 XML page. */
export function parseListPage(xml: string): {
  objects: R2Object[];
  next: string | null;
} {
  const objects: R2Object[] = [];
  for (const m of xml.matchAll(/<Contents>([\s\S]*?)<\/Contents>/g)) {
    const key = /<Key>([\s\S]*?)<\/Key>/.exec(m[1])?.[1];
    const size = Number(/<Size>(\d+)<\/Size>/.exec(m[1])?.[1] ?? '0');
    if (key) objects.push({ key: decodeXml(key), size });
  }
  const truncated = /<IsTruncated>true<\/IsTruncated>/.test(xml);
  const next = /<NextContinuationToken>([\s\S]*?)<\/NextContinuationToken>/.exec(xml)?.[1];
  return { objects, next: truncated && next ? decodeXml(next) : null };
}

function decodeXml(s: string): string {
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

/** Every object under `prefix`, following continuation tokens. */
export async function listObjects(cfg: R2Config, prefix: string): Promise<R2Object[]> {
  const all: R2Object[] = [];
  let token: string | null = null;
  do {
    const url = new URL(bucketUrl(cfg));
    url.searchParams.set('list-type', '2');
    url.searchParams.set('prefix', prefix);
    if (token) url.searchParams.set('continuation-token', token);
    const res = await cfg.client.fetch(url.toString());
    if (!res.ok) throw new Error(`R2 list ${prefix} failed: HTTP ${res.status}`);
    const page = parseListPage(await res.text());
    all.push(...page.objects);
    token = page.next;
  } while (token);
  return all;
}

export async function deleteObject(cfg: R2Config, key: string): Promise<void> {
  const res = await cfg.client.fetch(objectUrl(cfg, key), { method: 'DELETE' });
  // 204 on success; a 404 means it is already gone, which is what we wanted.
  if (!res.ok && res.status !== 404) throw new Error(`R2 delete ${key} failed: HTTP ${res.status}`);
}

/** Total bytes stored in the whole bucket (every prefix counts against the free tier). */
export async function bucketBytes(cfg: R2Config): Promise<number> {
  const objects = await listObjects(cfg, '');
  return objects.reduce((sum, o) => sum + o.size, 0);
}
