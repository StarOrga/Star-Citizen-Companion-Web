// R2 usage gate — the cost kill-switch (storage plan 2026-09-25).
//
// Cloudflare offers no spending cap for R2: budget alerts only send email and
// fire after overage has started. Every R2 write goes through a URL that
// ingest-skins signs, and only this function holds the secret. So "stop
// signing" works as a kill-switch. Before it signs, ingest-skins asks the
// GraphQL Analytics API how much of the account's free tier this month has
// used, and refuses at LIMIT_SHARE of any allowance. It fails closed: if usage
// is unknown (no CF_ANALYTICS_TOKEN, API error), nothing is signed, unless a
// good reading from the same month, at most 24 h old, bridges the outage
// (usageGate below).
//
// Reads through cloudflare/assets-worker do not use the token. They are capped
// by the Workers Free plan (100k requests/day ≈ 3.1M/month, below the 10M
// Class B allowance).
//
// Pure logic only, no Deno or network imports, so the Node tests can load it
// (`node --test supabase/functions/ingest-skins/_r2-usage.test.mjs`).

/** Free tier per account and month (R2 pricing, Standard storage class). */
export const FREE_TIER = {
  storageBytes: 10e9, // 10 GB, counted with 10^9 on purpose (the smaller reading)
  classA: 1_000_000,
  classB: 10_000_000,
} as const;

/** Refuse at this share of any allowance. Analytics data is sampled and lags. */
export const LIMIT_SHARE = 0.8;

/** Official R2 Class A operations (R2 pricing). */
const CLASS_A = new Set([
  'ListBuckets', 'PutBucket', 'ListObjects', 'PutObject', 'CopyObject',
  'CompleteMultipartUpload', 'CreateMultipartUpload', 'LifecycleStorageTierTransition',
  'ListMultipartUploads', 'UploadPart', 'UploadPartCopy', 'ListParts',
  'PutBucketEncryption', 'PutBucketCors', 'PutBucketLifecycleConfiguration',
]);
/** Official R2 Class B operations (R2 pricing). */
const CLASS_B = new Set([
  'HeadBucket', 'HeadObject', 'GetObject', 'UsageSummary', 'GetBucketEncryption',
  'GetBucketLocation', 'GetBucketCors', 'GetBucketLifecycleConfiguration',
]);
/** Free operations. Any action outside all three lists counts as Class A, to be safe. */
const FREE_OPS = new Set(['DeleteObject', 'DeleteBucket', 'AbortMultipartUpload']);

export type OpClass = 'A' | 'B' | 'free';

export function classifyAction(actionType: string): OpClass {
  if (CLASS_B.has(actionType)) return 'B';
  if (FREE_OPS.has(actionType)) return 'free';
  return 'A'; // CLASS_A and anything unknown
}

export const USAGE_QUERY = `query R2Usage($accountTag: string!, $start: Time!, $end: Time!) {
  viewer {
    accounts(filter: { accountTag: $accountTag }) {
      storage: r2StorageAdaptiveGroups(
        limit: 1000
        filter: { datetime_geq: $start, datetime_leq: $end }
        orderBy: [datetime_DESC]
      ) {
        max { payloadSize metadataSize }
        dimensions { datetime bucketName }
      }
      ops: r2OperationsAdaptiveGroups(
        limit: 10000
        filter: { datetime_geq: $start, datetime_leq: $end }
      ) {
        sum { requests }
        dimensions { actionType }
      }
    }
  }
}`;

/** First instant of the current calendar month (UTC). The billing cycle may differ; the margin covers it. */
export function monthStart(now: Date): string {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
}

export interface R2Usage {
  storageBytes: number;
  classA: number;
  classB: number;
}

interface StorageRow {
  max?: { payloadSize?: number; metadataSize?: number };
  dimensions?: { datetime?: string; bucketName?: string };
}
interface OpsRow {
  sum?: { requests?: number };
  dimensions?: { actionType?: string };
}

/**
 * Reads a GraphQL response into usage totals. Throws on GraphQL errors or on
 * an unexpected shape, because unknown usage must never read as zero usage.
 */
export function parseUsage(body: unknown): R2Usage {
  const b = body as { errors?: unknown[]; data?: { viewer?: { accounts?: unknown[] } } };
  if (b?.errors && b.errors.length) throw new Error(`analytics: ${JSON.stringify(b.errors).slice(0, 200)}`);
  const account = b?.data?.viewer?.accounts?.[0] as
    | { storage?: StorageRow[]; ops?: OpsRow[] }
    | undefined;
  if (!account || !Array.isArray(account.storage) || !Array.isArray(account.ops)) {
    throw new Error('analytics: unexpected response shape');
  }
  // Storage: the newest row per bucket (rows arrive newest first), summed over buckets.
  const seen = new Set<string>();
  let storageBytes = 0;
  for (const row of account.storage) {
    const bucket = row.dimensions?.bucketName ?? '';
    if (seen.has(bucket)) continue;
    seen.add(bucket);
    storageBytes += (row.max?.payloadSize ?? 0) + (row.max?.metadataSize ?? 0);
  }
  let classA = 0;
  let classB = 0;
  for (const row of account.ops) {
    const n = row.sum?.requests ?? 0;
    const cls = classifyAction(row.dimensions?.actionType ?? '');
    if (cls === 'A') classA += n;
    else if (cls === 'B') classB += n;
  }
  return { storageBytes, classA, classB };
}

/** The first allowance at or above LIMIT_SHARE, or null when every allowance has room. */
export function overLimit(u: R2Usage): string | null {
  if (u.storageBytes >= FREE_TIER.storageBytes * LIMIT_SHARE) return `storage ${u.storageBytes} B`;
  if (u.classA >= FREE_TIER.classA * LIMIT_SHARE) return `class A ${u.classA}`;
  if (u.classB >= FREE_TIER.classB * LIMIT_SHARE) return `class B ${u.classB}`;
  return null;
}

/** A reading is reused without asking Cloudflare again for this long (a catalog run signs ~150 ships). */
export const USAGE_TTL_MS = 5 * 60 * 1000;
/** When Cloudflare cannot be asked, a good reading this old still decides — never older, never from another month. */
export const USAGE_STALE_MAX_MS = 24 * 60 * 60 * 1000;

/** One good usage reading and when it was taken (epoch ms). */
export interface UsageReading {
  at: number;
  usage: R2Usage;
}

/**
 * What the sign step does with the usage it could (or could not) read:
 *  - ok      → sign
 *  - over    → 507 r2_free_tier_guard
 *  - unknown → 503 r2_usage_unknown (fail closed)
 * `stale` marks a decision taken on an older reading because Analytics failed.
 */
export type UsageGate =
  | { kind: 'ok'; stale: boolean }
  | { kind: 'over'; over: string; stale: boolean }
  | { kind: 'unknown'; reason: string };

/** A reading young enough to skip asking Cloudflare again. */
export function isFresh(r: UsageReading | null, now: number): boolean {
  return r !== null && now - r.at < USAGE_TTL_MS;
}

function decide(reading: UsageReading, stale: boolean): UsageGate {
  const over = overLimit(reading.usage);
  return over ? { kind: 'over', over, stale } : { kind: 'ok', stale };
}

/**
 * The cost gate as one pure decision. Without a read error the reading
 * decides. With one, the last good reading still decides when it is at most
 * USAGE_STALE_MAX_MS old AND from the same calendar month (usage resets
 * monthly, so last month's numbers say nothing about this one). Otherwise —
 * including no reading at all — usage is unknown and nothing is signed.
 */
export function usageGate(reading: UsageReading | null, readError: string | null, now: number): UsageGate {
  if (!readError) {
    return reading ? decide(reading, false) : { kind: 'unknown', reason: 'no usage reading' };
  }
  if (
    reading &&
    now - reading.at <= USAGE_STALE_MAX_MS &&
    monthStart(new Date(reading.at)) === monthStart(new Date(now))
  ) {
    return decide(reading, true);
  }
  return { kind: 'unknown', reason: readError };
}
