/**
 * Blueprint upload: draws a ship's two blueprint SVGs from its exported hull
 * GLB and carries them to R2 through `ingest-skins` (blueprint_sign /
 * blueprint_commit). docs/blueprint.md.
 *
 * Runs for every ship of a skin upload, also for ships whose hull is already
 * live (`.uploaded`): the first run after this feature draws the whole export
 * cache without rebuilding a single hull.
 *
 * Cost shape:
 *  - the drawing is cached in `<ship>/blueprint/` keyed by hull sha256 and
 *    generator version, so a re-run only hashes the hull;
 *  - `<ship>/.blueprint-uploaded` names the two committed shas — a ship whose
 *    drawings are live costs no call at all unless its hull was re-uploaded
 *    (`force`, the hull commit may have replaced its rows);
 *  - the server answers `exists` for an object already stored (content
 *    addressing), so identical hulls share one pair of files.
 *
 * A failure never fails the ship: the hull is live, the next run retries.
 */

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { API_BASE } from '../lib/release-token.js';
import { isInterrupt } from '../lib/pause-control.js';
import { fetchWithTimeout, putTimeoutMs } from '../lib/fetch-timeout.js';
import { isSkinGateCode, type SkinGateCode } from '../lib/skin-upload-summary.js';
import { BLUEPRINT_GENERATOR, buildBlueprints, type BlueprintFiles } from '../lib/blueprint/build.js';
import { loadHullMesh } from '../lib/blueprint/glb.js';
import type { IngestCall } from './asset-package-ingest.js';

export const BLUEPRINT_DIR = 'blueprint';
export const BLUEPRINT_MARKER = '.blueprint-uploaded';
const META = 'meta.json';

export interface BlueprintUploadResult {
  ok: boolean;
  /** Nothing sent: no hull, nothing drawable, or already live. */
  skipped?: 'no_hull' | 'not_drawable' | 'live';
  uploaded?: number;
  error?: string;
  gate?: SkinGateCode;
  /** The function cannot store blueprints at all (no R2) — stop asking for this run. */
  unsupported?: boolean;
}

export interface BlueprintUploadDeps {
  call: IngestCall;
  onLog: (message: string, level?: 'info' | 'warn' | 'error') => void;
  /** Injected for tests; defaults to the real GLB reader + generator. */
  draw?: (hull: Buffer) => Promise<BlueprintFiles | null>;
  put?: (url: string, bytes: Buffer, contentType: string) => Promise<void>;
}

interface Meta {
  generator: string;
  hullSha256: string;
  fullSha256: string;
  iconSha256: string;
}

const sha256 = (b: Buffer | string): string => createHash('sha256').update(b).digest('hex');

async function defaultDraw(hull: Buffer): Promise<BlueprintFiles | null> {
  return buildBlueprints(await loadHullMesh(new Uint8Array(hull.buffer, hull.byteOffset, hull.byteLength)));
}

async function defaultPut(url: string, bytes: Buffer, contentType: string): Promise<void> {
  const full = url.startsWith('http') ? url : `${API_BASE}${url}`;
  const res = await fetchWithTimeout(
    full,
    { method: 'PUT', headers: { 'content-type': contentType }, body: bytes },
    putTimeoutMs(bytes.byteLength),
  );
  if (!res.ok) throw new Error(`PUT failed: HTTP ${res.status}`);
}

/** The hull GLB of an exported ship folder (`skins.json` names it), or null. */
export function hullFileOf(dir: string): string | null {
  try {
    const cat = JSON.parse(readFileSync(resolve(dir, 'skins.json'), 'utf-8')) as { skins?: { model?: string | null }[] };
    const model = cat.skins?.find((s) => !!s.model)?.model;
    if (!model) return null;
    const file = resolve(dir, model);
    return existsSync(file) ? file : null;
  } catch {
    return null;
  }
}

/** Cached drawing for this hull, or a fresh one (written to `<dir>/blueprint/`). */
async function drawingFor(
  dir: string,
  hull: Buffer,
  draw: (hull: Buffer) => Promise<BlueprintFiles | null>,
): Promise<{ full: Buffer; icon: Buffer; meta: Meta } | null> {
  const folder = resolve(dir, BLUEPRINT_DIR);
  const hullSha256 = sha256(hull);
  try {
    const meta = JSON.parse(readFileSync(resolve(folder, META), 'utf-8')) as Meta;
    if (meta.generator === BLUEPRINT_GENERATOR && meta.hullSha256 === hullSha256) {
      const full = readFileSync(resolve(folder, 'full.svg'));
      const icon = readFileSync(resolve(folder, 'icon.svg'));
      if (sha256(full) === meta.fullSha256 && sha256(icon) === meta.iconSha256) return { full, icon, meta };
    }
  } catch {
    /* no usable cache — draw */
  }
  const files = await draw(hull);
  if (!files) return null;
  const full = Buffer.from(files.full, 'utf-8');
  const icon = Buffer.from(files.icon, 'utf-8');
  const meta: Meta = { generator: BLUEPRINT_GENERATOR, hullSha256, fullSha256: sha256(full), iconSha256: sha256(icon) };
  mkdirSync(folder, { recursive: true });
  writeFileSync(resolve(folder, 'full.svg'), full);
  writeFileSync(resolve(folder, 'icon.svg'), icon);
  writeFileSync(resolve(folder, META), JSON.stringify(meta, null, 2));
  return { full, icon, meta };
}

/**
 * Draw (or reuse) and upload one ship's blueprints. `force` = the hull was
 * committed in this run, so the rows are re-linked even if the marker says live.
 * Never throws except for pause/cancel.
 */
export async function uploadBlueprint(
  ship: { shipId: string; dir: string; force: boolean },
  deps: BlueprintUploadDeps,
): Promise<BlueprintUploadResult> {
  const { shipId, dir } = ship;
  try {
    const hullFile = hullFileOf(dir);
    if (!hullFile) return { ok: true, skipped: 'no_hull' };
    const drawing = await drawingFor(dir, readFileSync(hullFile), deps.draw ?? defaultDraw);
    if (!drawing) {
      deps.onLog(`${shipId}: hull has no drawable geometry — no blueprint`, 'warn');
      return { ok: true, skipped: 'not_drawable' };
    }
    const { full, icon, meta } = drawing;
    const marker = resolve(dir, BLUEPRINT_MARKER);
    const live = `${meta.fullSha256} ${meta.iconSha256}`;
    if (!ship.force && existsSync(marker) && readFileSync(marker, 'utf-8').trim() === live) {
      return { ok: true, skipped: 'live' };
    }

    const objects = [
      { type: 'full', sha256: meta.fullSha256, bytes: full.byteLength },
      { type: 'icon', sha256: meta.iconSha256, bytes: icon.byteLength },
    ];
    const signed = await deps.call({ action: 'blueprint_sign', ship_id: shipId, objects });
    if (!signed.ok) {
      if (isSkinGateCode(signed.error)) {
        deps.onLog(`${shipId}: R2 cost gate closed (${signed.error}) — blueprint upload stopped`, 'error');
        return { ok: false, error: signed.error, gate: signed.error };
      }
      // An older function (unknown action) or one without R2 will refuse every ship the same way.
      const unsupported = signed.error === 'r2_required' || signed.error === 'invalid_body';
      deps.onLog(`${shipId}: blueprint sign refused — ${signed.error}`, unsupported ? 'warn' : 'error');
      return { ok: false, error: signed.error, unsupported };
    }
    const uploads = (signed.json['uploads'] as { type: string; signedUrl: string; exists?: boolean }[] | undefined) ?? [];
    const put = deps.put ?? defaultPut;
    let uploaded = 0;
    for (const [type, bytes] of [['full', full], ['icon', icon]] as const) {
      const u = uploads.find((x) => x.type === type);
      if (!u) throw new Error(`no signed url for the ${type} blueprint`);
      if (u.exists) continue;
      await put(u.signedUrl, bytes, 'image/svg+xml');
      uploaded++;
    }
    const committed = await deps.call({
      action: 'blueprint_commit',
      ship_id: shipId,
      full_sha256: meta.fullSha256,
      icon_sha256: meta.iconSha256,
    });
    if (!committed.ok) {
      deps.onLog(`${shipId}: blueprint commit refused — ${committed.error}`, 'error');
      return { ok: false, error: committed.error, uploaded };
    }
    try {
      writeFileSync(marker, live);
    } catch {
      /* best effort: worst case the next run re-commits */
    }
    return { ok: true, uploaded };
  } catch (err) {
    if (isInterrupt(err)) throw err;
    deps.onLog(`${shipId}: blueprint failed — ${(err as Error).message}`, 'error');
    return { ok: false, error: (err as Error).message };
  }
}
