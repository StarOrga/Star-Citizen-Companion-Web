// R2 I/O for the news image cache. Reuses ingest-skins' R2 config and the
// shared usage gate (the cost kill-switch, see ingest-skins/_r2-usage.ts).
//
// Everything here is best effort and never throws: on missing R2 secrets, a
// refused or unknown usage gate, or any R2 error the caller falls back to the
// Supabase `news-images` bucket, which the assets Worker still serves from. The
// news feed must never break over an image write.

import { deleteObject, listObjects, r2FromEnv, readUsage } from '../ingest-skins/_r2.ts';
import type { R2Config } from '../ingest-skins/_r2.ts';
import { usageGate } from '../ingest-skins/_r2-usage.ts';
import { newsR2FolderPrefix, newsR2Key } from './news-image-store.ts';

const R2_PUT_TIMEOUT_MS = 10_000;

/** R2 configured at all (secrets set). Deletes do not need the usage gate. */
export function newsR2Config(): R2Config | null {
  try {
    return r2FromEnv((k) => Deno.env.get(k));
  } catch {
    return null;
  }
}

/**
 * R2 config when writes are allowed right now, else null (and why). The usage
 * reading is cached per isolate for five minutes, so a warm pass costs at most
 * one Analytics call.
 */
export async function newsR2Writer(): Promise<{ cfg: R2Config | null; reason: string | null }> {
  const cfg = newsR2Config();
  if (!cfg) return { cfg: null, reason: 'R2 not configured' };
  try {
    const { reading, error } = await readUsage(cfg);
    const gate = usageGate(reading, error, Date.now());
    if (gate.kind === 'ok') return { cfg, reason: null };
    return { cfg: null, reason: gate.kind === 'over' ? `R2 free-tier guard: ${gate.over}` : `R2 usage unknown: ${gate.reason}` };
  } catch (e) {
    return { cfg: null, reason: `R2 usage check failed: ${(e as Error).message}` };
  }
}

/** PUT one object under `news-images/<path>`. Returns false on any failure. */
export async function putNewsObject(
  cfg: R2Config,
  path: string,
  bytes: Uint8Array,
  contentType: string,
  cacheControl: string,
): Promise<boolean> {
  try {
    const url = `https://${cfg.accountId}.r2.cloudflarestorage.com/${cfg.bucket}/${newsR2Key(path)}`;
    const res = await cfg.client.fetch(url, {
      method: 'PUT',
      body: bytes,
      headers: { 'content-type': contentType, 'cache-control': cacheControl },
      signal: AbortSignal.timeout(R2_PUT_TIMEOUT_MS),
    });
    await res.body?.cancel();
    return res.ok;
  } catch {
    return false;
  }
}

/** Delete every R2 object of one cache entry. Throws so the caller keeps the row on failure. */
export async function deleteNewsFolder(cfg: R2Config, sourceKey: string): Promise<void> {
  const objects = await listObjects(cfg, newsR2FolderPrefix(sourceKey));
  for (const o of objects) await deleteObject(cfg, o.key);
}
