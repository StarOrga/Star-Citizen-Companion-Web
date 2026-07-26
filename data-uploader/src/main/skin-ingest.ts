/**
 * Skin upload — pushes a hull3d export (glb models + webp icons + skins.json)
 * to Supabase via the `ingest-skins` edge function. No service-role secret in
 * this binary: the function hands back short-lived signed upload URLs, we PUT
 * each asset straight into the public `ship-skins` bucket, then `commit` the
 * catalog rows. Auth mirrors the bundle upload (user JWT + release token).
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { API_BASE, RELEASE_TOKEN, TOOL_VERSION } from '../lib/release-token.js';
import { isInterrupt, type PauseControl } from '../lib/pause-control.js';

interface SkinCatalogEntry {
  id: string;
  name: string;
  description?: string;
  source?: string;
  name_verified?: boolean;
  model?: string | null; // relative path inside the export dir, e.g. models/X.glb
  icon?: string | null; // relative path, e.g. icons/X.webp
  model_mb?: number;
}

interface SkinCatalog {
  ship: string;
  skins: SkinCatalogEntry[];
}

export interface SkinUploadResult {
  ok: boolean;
  ship_id: string;
  uploaded?: number;
  committed?: number;
  error?: string;
  /** True when skipped because the ship was already uploaded in a prior run. */
  cached?: boolean;
}

type LogFn = (message: string, level?: 'info' | 'warn' | 'error') => void;

/**
 * Either a fixed bearer token or a getter for a FRESH one. Skin uploads move
 * multi-GB models per ship and can run for hours, so — exactly like the catalog
 * upload — a token captured once goes stale mid-run. A getter (wired in main to
 * `ensureAccessToken`) keeps every `ingest-skins` call authorised.
 */
export type SkinToken = string | (() => string | Promise<string>);

/**
 * Resume + pause wiring. All optional — omitting `hooks` keeps the original
 * one-shot behaviour.
 */
export interface SkinUploadHooks {
  /** Cooperative pause/cancel, checked between ships. */
  control?: PauseControl;
  /** Ship ids a prior run already committed — skipped without touching disk. */
  doneShips?: string[];
  /** Fired when a ship is fully committed, so a kill can't lose the progress. */
  onShipDone?: (shipId: string) => void;
}

const fnUrl = (name: string): string => `${API_BASE}/functions/v1/${name}`;

interface SignedUpload {
  path: string;
  token: string;
  signedUrl: string;
}

async function callIngest(
  getToken: () => string | Promise<string>,
  body: unknown,
): Promise<{ ok: boolean; json: Record<string, unknown>; error?: string }> {
  const accessToken = await getToken();
  const res = await fetch(fnUrl('ingest-skins'), {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${accessToken}`,
      'x-sc-release-token': RELEASE_TOKEN,
      'x-sc-tool-version': TOOL_VERSION,
    },
    body: JSON.stringify(body),
  });
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  return {
    ok: res.ok,
    json,
    error: res.ok ? undefined : ((json['error'] as string) ?? `HTTP ${res.status}`),
  };
}

async function putSigned(u: SignedUpload | undefined, file: string, contentType: string): Promise<void> {
  if (!u) throw new Error('no signed url for object');
  const url = u.signedUrl.startsWith('http') ? u.signedUrl : `${API_BASE}${u.signedUrl}`;
  const res = await fetch(url, {
    method: 'PUT',
    headers: { 'content-type': contentType, 'x-upsert': 'true' },
    body: readFileSync(file),
  });
  if (!res.ok) throw new Error(`PUT ${file} failed: HTTP ${res.status}`);
}

/** Upload every exported ship (one <out>/<ship_id> dir each) to Supabase. */
export async function uploadSkins(
  accessToken: SkinToken,
  ships: { shipId: string; dir: string }[],
  onLog: LogFn,
  hooks: SkinUploadHooks = {},
): Promise<SkinUploadResult[]> {
  const out: SkinUploadResult[] = [];
  const done = new Set(hooks.doneShips ?? []);
  // Resolved per call so a multi-hour run refreshes the JWT instead of reusing
  // the one captured at stage start.
  const getToken = typeof accessToken === 'function' ? accessToken : (): string => accessToken;
  for (const { shipId, dir } of ships) {
    try {
      // Safe boundary between ships — a pause here costs nothing to replay.
      hooks.control?.checkpoint();
      // Job-state cache: a ship this job already committed. Complements the
      // on-disk marker below, which also survives a *new* job over the same dir.
      if (done.has(shipId)) {
        onLog(`${shipId}: already uploaded in this job — skipping`, 'info');
        out.push({ ok: true, ship_id: shipId, uploaded: 0, committed: 0, cached: true });
        continue;
      }
      // Upload-cache: a ship uploaded in a prior run carries a .uploaded marker
      // next to its assets — skip the (potentially multi-GB) re-PUT + re-commit.
      const marker = resolve(dir, '.uploaded');
      if (existsSync(marker)) {
        onLog(`${shipId}: already uploaded — skipping`, 'info');
        out.push({ ok: true, ship_id: shipId, uploaded: 0, committed: 0, cached: true });
        continue;
      }
      const catPath = resolve(dir, 'skins.json');
      if (!existsSync(catPath)) {
        out.push({ ok: false, ship_id: shipId, error: 'skins.json missing' });
        continue;
      }
      const cat = JSON.parse(readFileSync(catPath, 'utf-8')) as SkinCatalog;
      const built = cat.skins.filter((s) => s.model); // only skins with a glb

      // 1. ask the function for signed upload URLs
      const objects: { skin_id: string; ext: 'glb' | 'webp' }[] = [];
      for (const s of built) {
        objects.push({ skin_id: s.id, ext: 'glb' });
        if (s.icon) objects.push({ skin_id: s.id, ext: 'webp' });
      }
      const signed = await callIngest(getToken, { action: 'sign', ship_id: cat.ship, objects });
      if (!signed.ok) {
        out.push({ ok: false, ship_id: shipId, error: signed.error });
        continue;
      }
      const uploads = (signed.json['uploads'] as SignedUpload[] | undefined) ?? [];
      const byPath = new Map(uploads.map((u) => [u.path, u]));

      // 2. PUT each object straight to storage
      let n = 0;
      for (const s of built) {
        // Pause between assets keeps a multi-GB ship responsive. Resume replays
        // the whole ship (the marker is only written after `commit`), which is
        // safe: every PUT is an upsert.
        hooks.control?.checkpoint();
        await putSigned(byPath.get(`${cat.ship}/${s.id}.glb`), resolve(dir, s.model!), 'model/gltf-binary');
        n++;
        if (s.icon) {
          await putSigned(byPath.get(`${cat.ship}/${s.id}.webp`), resolve(dir, s.icon), 'image/webp');
          n++;
        }
      }

      // 3. commit catalog rows (paths are re-derived server-side)
      const skins = built.map((s) => ({
        skin_id: s.id,
        name: s.name,
        description: s.description ?? '',
        source: s.source ?? 'store',
        name_verified: !!s.name_verified,
        has_model: true,
        has_icon: !!s.icon,
        model_bytes: s.model_mb ? Math.round(s.model_mb * 1e6) : null,
      }));
      const committed = await callIngest(getToken, { action: 'commit', ship_id: cat.ship, skins });
      if (!committed.ok) {
        out.push({ ok: false, ship_id: shipId, uploaded: n, error: committed.error });
        continue;
      }
      const count = (committed.json['count'] as number | undefined) ?? skins.length;
      // Mark shipped so a re-run's upload-cache skips this ship.
      try {
        writeFileSync(marker, `${cat.ship} ${count} rows`);
      } catch {
        /* marker is best-effort — worst case the ship re-uploads next run */
      }
      hooks.onShipDone?.(shipId);
      onLog(`${shipId}: uploaded ${n} objects, committed ${count} rows`, 'info');
      out.push({ ok: true, ship_id: shipId, uploaded: n, committed: count });
    } catch (err) {
      // Pause/cancel is control flow — unwind to the caller instead of being
      // recorded as a per-ship upload failure.
      if (isInterrupt(err)) throw err;
      out.push({ ok: false, ship_id: shipId, error: (err as Error).message });
    }
  }
  return out;
}
