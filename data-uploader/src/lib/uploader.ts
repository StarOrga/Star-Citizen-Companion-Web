/**
 * Upload — sends the extracted bundle to the Web-App.
 *
 * Headers:
 *  - `Authorization: Bearer <oauth-access-token>`  (from OAuth flow)
 *  - `X-SC-Release-Token: <release-token>`         (built-in, concept § B2)
 *  - `X-SC-Tool-Version: <semver>`                 (for the server's compat checks)
 *
 * Both Auth-Token AND Release-Token must validate server-side.
 *
 * Returns the server-computed diff_summary (vs. the previous bundle of the
 * same channel+patch family) so the renderer can show the operator what
 * actually changed before the upload is announced to other users.
 */

import { readFileSync } from 'node:fs';
import { RELEASE_TOKEN, TOOL_VERSION } from './release-token.js';

export interface UploadPayload {
  accessToken: string;
  channel: 'LIVE' | 'PTU' | 'EPTU' | 'TECH-PREVIEW';
  patchVersion: string;
  buildNumber: string;
  schemaVersion: number;
  qualityScore: number;
  entityCounts: Record<string, number>;
  /**
   * Either an inline manifest object OR an absolute path to a manifest.json
   * file written by the Python sidecar. The path form lets us avoid pushing
   * a huge JSON through IPC.
   */
  manifest: unknown;
  manifestPath?: string;
  data?: unknown;
}

/**
 * Matches the shape returned by `public.diff_bundle(uuid, uuid)` (migration
 * 00005) — keep aligned with `src/app/p4k/p4k.service.ts:BundleDiffSummary`.
 */
export interface DiffSummary {
  prev_id?: string;
  new_id?: string;
  count_diffs?: Record<string, { prev: number; new: number; delta: number }>;
  summary?: { entities_added: number; entities_removed: number };
}

export interface UploadResult {
  ok: boolean;
  bundleId?: string;
  prevBundleId?: string | null;
  diffSummary?: DiffSummary | null;
  error?: string;
  details?: unknown;
}

/**
 * Hard ceiling for a single upload POST. A hung socket (server wedged, flaky
 * VPN, captive portal) would otherwise leave the fetch pending forever — the UI
 * spinner never resolves and no error is ever surfaced. On expiry we abort and
 * report a distinct `'timeout'` code so the caller can both tell the operator
 * *and* fire a stall telemetry report.
 */
export const UPLOAD_TIMEOUT_MS = 120_000;

export async function uploadBundle(
  apiBase: string,
  payload: UploadPayload,
  timeoutMs: number = UPLOAD_TIMEOUT_MS,
): Promise<UploadResult> {
  const endpoint = `${apiBase}/functions/v1/ingest-bundle`;
  const manifest = payload.manifestPath
    ? safeReadJson(payload.manifestPath, payload.manifest)
    : payload.manifest;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${payload.accessToken}`,
        'x-sc-release-token': RELEASE_TOKEN,
        'x-sc-tool-version': TOOL_VERSION,
      },
      body: JSON.stringify({
        channel: payload.channel.toLowerCase(),
        patch_version: payload.patchVersion,
        build_number: payload.buildNumber,
        schema_version: payload.schemaVersion,
        quality_score: payload.qualityScore,
        entity_counts: payload.entityCounts,
        manifest,
        data: payload.data,
        tool_version: TOOL_VERSION,
      }),
      signal: controller.signal,
    });
    const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok) {
      return {
        ok: false,
        error: (json['error'] as string) ?? `HTTP ${res.status}`,
        details: json,
      };
    }
    return {
      ok: true,
      bundleId: json['bundle_id'] as string | undefined,
      prevBundleId: (json['prev_bundle_id'] as string | null | undefined) ?? null,
      diffSummary: (json['diff_summary'] as DiffSummary | null | undefined) ?? null,
    };
  } catch (err) {
    // AbortError === our own timeout tripped; normalise to a stable code the
    // renderer maps to a friendly "timed out" message and telemetry can bucket.
    if (err instanceof Error && err.name === 'AbortError') {
      return { ok: false, error: 'timeout' };
    }
    return { ok: false, error: (err as Error).message };
  } finally {
    clearTimeout(timer);
  }
}

function safeReadJson(path: string, fallback: unknown): unknown {
  try {
    const raw = readFileSync(path, 'utf-8');
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}
