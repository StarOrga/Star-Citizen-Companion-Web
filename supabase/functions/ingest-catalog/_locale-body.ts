// Request-body checks for the ingest-catalog locale ops (locale_sign,
// locale_commit, locale_backfill). Pure, so the Node tests load it directly.

import { SHA256_RE, SHARD_COUNT, isLocaleLang } from './_locale-shards.ts';
import type { LocaleLang } from './_locale-shards.ts';

/** One shard object is a slice of ~1/64 of a language (~30 k strings): far below this. */
export const MAX_SHARD_BYTES = 4 * 1024 * 1024;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type Parsed<T> = { ok: true; value: T } | { ok: false; message: string };

export interface SignBody {
  buildId: string;
  lang: LocaleLang;
  shards: { sha256: string; bytes: number }[];
}

export interface CommitBody {
  buildId: string;
  lang: LocaleLang;
  shards: string[];
  keys: number;
  bytes: number;
}

export interface BackfillBody {
  buildId: string;
  lang: LocaleLang;
}

const isCount = (x: unknown): x is number => Number.isSafeInteger(x) && (x as number) >= 0;

function base(body: Record<string, unknown>): Parsed<BackfillBody> {
  const buildId = String(body.build_id ?? '');
  if (!UUID_RE.test(buildId)) return { ok: false, message: 'build_id must be a uuid' };
  if (!isLocaleLang(body.lang)) return { ok: false, message: "lang must be 'de' or 'en'" };
  return { ok: true, value: { buildId, lang: body.lang } };
}

export function parseBackfill(body: Record<string, unknown>): Parsed<BackfillBody> {
  return base(body);
}

export function parseSign(body: Record<string, unknown>): Parsed<SignBody> {
  const b = base(body);
  if (!b.ok) return b;
  const shards = body.shards;
  if (!Array.isArray(shards) || shards.length !== SHARD_COUNT) {
    return { ok: false, message: `shards must list exactly ${SHARD_COUNT} entries` };
  }
  const out: SignBody['shards'] = [];
  for (const s of shards as { sha256?: unknown; bytes?: unknown }[]) {
    const sha = String(s?.sha256 ?? '');
    if (!SHA256_RE.test(sha)) return { ok: false, message: 'shard sha256 must be 64 lowercase hex chars' };
    if (!isCount(s.bytes) || s.bytes === 0 || s.bytes > MAX_SHARD_BYTES) {
      return { ok: false, message: `shard bytes must be 1..${MAX_SHARD_BYTES}` };
    }
    out.push({ sha256: sha, bytes: s.bytes });
  }
  return { ok: true, value: { ...b.value, shards: out } };
}

export function parseCommit(body: Record<string, unknown>): Parsed<CommitBody> {
  const b = base(body);
  if (!b.ok) return b;
  const shards = body.shards;
  if (!Array.isArray(shards) || shards.length !== SHARD_COUNT) {
    return { ok: false, message: `shards must list exactly ${SHARD_COUNT} sha256 hashes` };
  }
  if (!shards.every((s) => typeof s === 'string' && SHA256_RE.test(s))) {
    return { ok: false, message: 'shard sha256 must be 64 lowercase hex chars' };
  }
  if (!isCount(body.keys) || !isCount(body.bytes)) return { ok: false, message: 'keys and bytes must be counts' };
  return { ok: true, value: { ...b.value, shards: shards as string[], keys: body.keys, bytes: body.bytes } };
}

/** The legacy `locale_strings` op keeps only the languages the app reads. */
export function keepReadLangs<T extends { lang?: unknown }>(rows: T[]): T[] {
  return rows.filter((r) => isLocaleLang(r?.lang));
}
