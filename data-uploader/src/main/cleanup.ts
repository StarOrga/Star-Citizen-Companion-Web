/**
 * TEMP/EXTRACT folder cleanup for the desktop tool.
 *
 * Extraction writes one dir per `<channel>-<version>` under each SC install's
 * `.sc-companion-extracts/` folder (see renderer main.ts — `outDir`). Those
 * dirs are large (PNGs, JSON, manifests) and must be reclaimed once their
 * contents have been uploaded — otherwise they fill the disk over many runs.
 *
 * Two reclaim paths:
 *  1. Post-upload — delete the run's dir right after a confirmed upload.
 *  2. Startup scan — sweep leftover dirs from previous FAILED/incomplete runs.
 *
 * SAFETY: every delete goes through `assertSafeExtractTarget()`, which refuses
 * any path that is not a *sub*directory of a `.sc-companion-extracts` segment.
 * We never delete the `.sc-companion-extracts` root itself, nor anything above
 * it. All deletion is best-effort and never throws up to the caller — a cleanup
 * failure must never crash the app.
 */

import { promises as fs } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import log from 'electron-log';
import { discoverAll } from '../lib/discovery.js';

export const EXTRACTS_DIR_NAME = '.sc-companion-extracts';
export const UPLOAD_MARKER = '_uploaded.json';

/** Dirs without an upload marker younger than this are treated as possibly
 *  in-progress (another window may be mid-run) and are NOT deleted. */
const STALE_MS = 24 * 60 * 60 * 1000;

export interface UploadMarkerInfo {
  bundleId?: string;
  channel?: string;
  version?: string;
}

export interface CleanupResult {
  ok: boolean;
  error?: string;
}

/**
 * Hard safety guard. Returns true only when `target` resolves to a path that
 * lives strictly *inside* a `.sc-companion-extracts` directory — i.e. the
 * segment is present in the path AND there is at least one further segment
 * after it. The `.sc-companion-extracts` root itself (target ends with the
 * segment) is rejected, as is any path that does not contain the segment.
 *
 * Pure / synchronous so it can be unit-checked in isolation.
 */
export function isSafeExtractTarget(target: string): boolean {
  if (!target || typeof target !== 'string') return false;
  const resolved = resolve(target);
  const segments = resolved.split(sep).filter((s) => s.length > 0);
  const idx = segments.indexOf(EXTRACTS_DIR_NAME);
  if (idx === -1) return false;
  // Require at least one segment AFTER the guard segment → target must be a
  // child of `.sc-companion-extracts`, never the root or anything above it.
  return idx < segments.length - 1;
}

/** Throwing variant used at the delete site. */
function assertSafeExtractTarget(target: string): void {
  if (!isSafeExtractTarget(target)) {
    throw new Error(`refusing unsafe cleanup target: ${target}`);
  }
}

/** Best-effort recursive delete, guarded. Never throws. */
async function safeRemoveDir(target: string): Promise<CleanupResult> {
  try {
    assertSafeExtractTarget(target);
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    log.warn('[cleanup] guard rejected target', { target, error });
    return { ok: false, error };
  }
  try {
    await fs.rm(target, { recursive: true, force: true });
    return { ok: true };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    log.warn('[cleanup] rm failed', { target, error });
    return { ok: false, error };
  }
}

/** Write the `_uploaded.json` marker into an extract dir. Best-effort. */
export async function markUploaded(
  outDir: string,
  info: UploadMarkerInfo,
): Promise<CleanupResult> {
  try {
    assertSafeExtractTarget(outDir);
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    log.warn('[cleanup] guard rejected marker target', { outDir, error });
    return { ok: false, error };
  }
  const marker = join(outDir, UPLOAD_MARKER);
  const payload = JSON.stringify(
    {
      bundleId: info.bundleId ?? null,
      channel: info.channel ?? null,
      version: info.version ?? null,
      timestamp: new Date().toISOString(),
    },
    null,
    2,
  );
  try {
    await fs.writeFile(marker, payload, 'utf-8');
    return { ok: true };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    log.warn('[cleanup] failed to write upload marker', { marker, error });
    return { ok: false, error };
  }
}

/**
 * Post-upload cleanup: drop the marker (audit trail in case rm is interrupted)
 * then delete the dir. Best-effort — logs and returns, never throws.
 */
export async function cleanupAfterUpload(
  outDir: string,
  info: UploadMarkerInfo,
): Promise<CleanupResult> {
  if (!outDir) return { ok: false, error: 'no output_dir' };
  await markUploaded(outDir, info);
  const res = await safeRemoveDir(outDir);
  if (res.ok) {
    log.info('[cleanup] removed extract dir after upload', {
      outDir,
      bundleId: info.bundleId ?? null,
    });
  }
  return res;
}

/**
 * Startup sweep. For every `<root>/.sc-companion-extracts/*` dir:
 *   (a) has `_uploaded.json`        → already uploaded, reclaim it.
 *   (b) no marker AND mtime > 24h   → stale failed run, reclaim it.
 *   (c) no marker AND mtime <= 24h  → possibly in-progress, KEEP.
 * Best-effort; logs a one-line summary. Never throws.
 */
export async function scanAndCleanupOrphans(roots: string[]): Promise<CleanupResult> {
  const removed: string[] = [];
  const kept: string[] = [];
  try {
    for (const root of roots) {
      const extractsRoot = join(root, EXTRACTS_DIR_NAME);
      let entries: { name: string; isDirectory(): boolean }[];
      try {
        entries = await fs.readdir(extractsRoot, { withFileTypes: true });
      } catch {
        continue; // no extracts folder under this root
      }
      for (const ent of entries) {
        if (!ent.isDirectory()) continue;
        const dir = join(extractsRoot, ent.name);
        let hasMarker = false;
        try {
          await fs.access(join(dir, UPLOAD_MARKER));
          hasMarker = true;
        } catch {
          hasMarker = false;
        }
        if (!hasMarker) {
          // Keep recently-touched marker-less dirs — could be a live run.
          let ageMs = 0;
          try {
            const st = await fs.stat(dir);
            ageMs = Date.now() - st.mtimeMs;
          } catch {
            continue;
          }
          if (ageMs <= STALE_MS) {
            kept.push(dir);
            continue;
          }
        }
        const res = await safeRemoveDir(dir);
        if (res.ok) removed.push(dir);
      }
    }
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    log.warn('[cleanup] orphan scan aborted', { error });
    return { ok: false, error };
  }
  log.info(
    `[cleanup] orphan scan: removed ${removed.length}, kept ${kept.length} (in-progress/recent)`,
    { removed, kept },
  );
  return { ok: true };
}

/**
 * Discover install roots and sweep their extract folders. Heavy discovery is
 * tolerated here because this runs fire-and-forget at startup; on failure we
 * fall back to nothing (discoverAll already swallows its own errors).
 */
export async function scanAndCleanupDiscovered(): Promise<CleanupResult> {
  let roots: string[] = [];
  try {
    const channels = await discoverAll();
    roots = [...new Set(channels.map((c) => c.installPath))];
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    log.warn('[cleanup] discovery for orphan scan failed', { error });
    return { ok: false, error };
  }
  if (roots.length === 0) {
    log.info('[cleanup] orphan scan: no install roots discovered');
    return { ok: true };
  }
  return scanAndCleanupOrphans(roots);
}
