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

export interface DiffSummary {
  prev_bundle_id?: string;
  new_bundle_id?: string;
  total_added?: number;
  total_removed?: number;
  total_changed?: number;
  by_entity?: Record<string, { added: number; removed: number; changed: number }>;
}

export interface UploadResult {
  ok: boolean;
  bundleId?: string;
  prevBundleId?: string | null;
  diffSummary?: DiffSummary | null;
  error?: string;
  details?: unknown;
}

export async function uploadBundle(
  apiBase: string,
  payload: UploadPayload,
): Promise<UploadResult> {
  const endpoint = `${apiBase}/functions/v1/ingest-bundle`;
  const manifest = payload.manifestPath
    ? safeReadJson(payload.manifestPath, payload.manifest)
    : payload.manifest;
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
    return { ok: false, error: (err as Error).message };
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
