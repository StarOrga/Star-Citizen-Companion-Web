/**
 * 3D asset-package upload (ships + FPS weapons), the second half of the skin
 * flow. The exporter leaves `<ship>/package.json` plus content-addressed
 * `_parts/<sha>.glb` / `_interiors/<sha>.glb` next to the ship folders; this
 * module carries them to R2 through `ingest-skins` (package_sign /
 * package_commit) so the web only fetches and displays.
 *
 * Cost shape (docs/asset-package.md "Upload"):
 *  - an entity whose manifest sha is already committed costs one tiny call, or
 *    none at all when its local `.package-uploaded` marker names that sha;
 *  - the server answers `exists` per object, so a part shared by 30 ships is
 *    PUT once — and `known` remembers it for the rest of the run;
 *  - PUTs run with bounded concurrency and retry with backoff;
 *  - the manifest goes up as `_manifests/<sha256 of its bytes>.json`, plain JSON
 *    (the assets Worker streams R2 bytes as stored, and a presigned PUT cannot
 *    sign a Content-Encoding header without the Worker re-deciding it).
 */

import { createHash } from 'node:crypto';
import { existsSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { API_BASE } from '../lib/release-token.js';
import { isInterrupt, type PauseControl } from '../lib/pause-control.js';
import { fetchWithTimeout, putTimeoutMs } from '../lib/fetch-timeout.js';
import { isSkinGateCode, type SkinGateCode } from '../lib/skin-upload-summary.js';
import {
  chunk,
  mapLimit,
  planPackage,
  withRetry,
  type PackageKind,
  type UploadObject,
} from '../lib/asset-package.js';

/** Same shape as `callIngest` in skin-ingest.ts, injected to avoid an import cycle. */
export type IngestCall = (body: unknown) => Promise<{ ok: boolean; json: Record<string, unknown>; error?: string }>;

export interface PackageEntity {
  kind: PackageKind;
  /** Folder holding `package.json` (a ship folder, or `_fps/<className>`). */
  dir: string;
  /** Export root — where `_parts/` and `_interiors/` live. */
  outRoot: string;
  /** ships.json `ship_id` for ships (links the row to ship_skins). */
  shipId?: string;
}

export interface PackageUploadResult {
  ok: boolean;
  entity: string;
  /** Skipped: this manifest is already committed. */
  cached?: boolean;
  uploaded?: number;
  reused?: number;
  error?: string;
  gate?: SkinGateCode;
}

export interface PackageUploadDeps {
  call: IngestCall;
  onLog: (message: string, level?: 'info' | 'warn' | 'error') => void;
  control?: PauseControl;
  /** `type:sha` keys known to be in storage — shared across entities of one run. */
  known: Set<string>;
  concurrency?: number;
}

const SIGN_CHUNK = 200;
const MARKER = '.package-uploaded';

const sha256Buf = (b: Buffer): string => createHash('sha256').update(b).digest('hex');

function localFile(outRoot: string, o: UploadObject): string | null {
  if (o.type === 'part') return resolve(outRoot, '_parts', `${o.sha256}.glb`);
  if (o.type === 'interior') return resolve(outRoot, '_interiors', `${o.sha256}.glb`);
  return null; // manifest: in memory
}

async function putBytes(url: string, bytes: Buffer, contentType: string): Promise<void> {
  const full = url.startsWith('http') ? url : `${API_BASE}${url}`;
  const res = await fetchWithTimeout(
    full,
    { method: 'PUT', headers: { 'content-type': contentType }, body: bytes },
    putTimeoutMs(bytes.byteLength),
  );
  if (!res.ok) throw new Error(`PUT failed: HTTP ${res.status}`);
}

/** Uploads one entity's package. Never throws except for pause/cancel. */
export async function uploadPackage(entity: PackageEntity, deps: PackageUploadDeps): Promise<PackageUploadResult> {
  const manifestPath = resolve(entity.dir, 'package.json');
  const label = entity.shipId ?? entity.dir;
  try {
    if (!existsSync(manifestPath)) return { ok: true, entity: label, cached: true, uploaded: 0, reused: 0 };
    const manifestBytes = readFileSync(manifestPath);
    const manifestSha = sha256Buf(manifestBytes);
    const marker = resolve(entity.dir, MARKER);
    if (existsSync(marker) && readFileSync(marker, 'utf-8').trim() === manifestSha) {
      return { ok: true, entity: label, cached: true, uploaded: 0, reused: 0 };
    }
    const plan = planPackage(JSON.parse(manifestBytes.toString('utf-8')), manifestSha, manifestBytes.byteLength);
    const base = { kind: plan.kind, entity_class: plan.entityClass, manifest_sha256: manifestSha };

    const todo = plan.objects.filter((o) => !deps.known.has(`${o.type}:${o.sha256}`) || o.type === 'manifest');
    let uploaded = 0;
    let reused = plan.objects.length - todo.length;
    let unchanged = false;

    // The server also tells us when the committed row already names this manifest.
    for (const group of chunk(todo, SIGN_CHUNK)) {
      deps.control?.checkpoint();
      const signed = await withRetry(
        async () => {
          const r = await deps.call({ action: 'package_sign', ...base, objects: group });
          if (!r.ok && (isSkinGateCode(r.error) || /^(uploader_outdated|r2_required|invalid_body|unsafe_id)$/.test(r.error ?? ''))) {
            return r; // not worth retrying
          }
          if (!r.ok) throw new Error(r.error ?? 'sign failed');
          return r;
        },
        { retryable: (e) => !isInterrupt(e) },
      );
      if (!signed.ok) {
        if (isSkinGateCode(signed.error)) {
          deps.onLog(`${label}: R2 cost gate closed (${signed.error}) — package upload stopped`, 'error');
          return { ok: false, entity: label, error: signed.error, gate: signed.error };
        }
        deps.onLog(`${label}: package sign refused — ${signed.error}`, 'error');
        return { ok: false, entity: label, error: signed.error };
      }
      if (signed.json['unchanged'] === true) {
        unchanged = true;
        break;
      }
      const uploads = (signed.json['uploads'] as
        | { type: string; sha256: string; signedUrl: string; exists?: boolean }[]
        | undefined) ?? [];
      const byKey = new Map(uploads.map((u) => [`${u.type}:${u.sha256}`, u]));
      await mapLimit(group, deps.concurrency ?? 4, async (o) => {
        deps.control?.checkpoint();
        const key = `${o.type}:${o.sha256}`;
        const u = byKey.get(key);
        if (!u) throw new Error(`server returned no upload for ${key}`);
        if (u.exists) {
          reused++;
          deps.known.add(key);
          return;
        }
        const file = localFile(entity.outRoot, o);
        let bytes: Buffer;
        if (file) {
          if (!existsSync(file) || statSync(file).size !== o.bytes) {
            throw new Error(`${o.type} ${o.sha256} missing or wrong size on disk`);
          }
          bytes = readFileSync(file);
        } else {
          bytes = manifestBytes;
        }
        const type = o.type === 'manifest' ? 'application/json' : 'model/gltf-binary';
        await withRetry(() => putBytes(u.signedUrl, bytes, type), { retryable: (e) => !isInterrupt(e) });
        uploaded++;
        deps.known.add(key);
      });
    }

    if (!unchanged) {
      const committed = await withRetry(
        async () => {
          const r = await deps.call({ action: 'package_commit', ...base, ...(entity.shipId ? { ship_id: entity.shipId } : {}) });
          // 409s name a real defect (missing object, size) — retrying cannot fix them.
          if (!r.ok && /^(package_|manifest_|unsafe_id|uploader_outdated)/.test(r.error ?? '')) return r;
          if (!r.ok) throw new Error(r.error ?? 'commit failed');
          return r;
        },
        { retryable: (e) => !isInterrupt(e) },
      );
      if (!committed.ok) {
        deps.onLog(`${label}: package commit failed — ${committed.error}`, 'warn');
        return { ok: false, entity: label, uploaded, error: committed.error };
      }
    }
    try {
      writeFileSync(marker, manifestSha);
    } catch {
      /* best-effort: worst case the server answers `unchanged` next run */
    }
    deps.onLog(
      `${label}: package ${unchanged ? 'unchanged' : `uploaded ${uploaded} object(s), reused ${reused}`}`,
      'info',
    );
    return { ok: true, entity: label, uploaded, reused, cached: unchanged };
  } catch (err) {
    if (isInterrupt(err)) throw err;
    deps.onLog(`${label}: package upload failed — ${(err as Error).message}`, 'warn');
    return { ok: false, entity: label, error: (err as Error).message };
  }
}

/** Uploader-side location of one FPS weapon package inside the export root. */
export function fpsEntityDir(outRoot: string, className: string): string {
  return resolve(outRoot, '_fps', className);
}

/** The export root a ship folder sits in. */
export function exportRootOf(shipDir: string): string {
  return dirname(resolve(shipDir));
}
