/**
 * Upload — sends the extracted bundle to the Web-App.
 *
 * Headers:
 *  - `Authorization: Bearer <oauth-access-token>`  (from OAuth flow)
 *  - `X-SC-Release-Token: <release-token>`         (built-in, concept § B2)
 *  - `X-SC-Tool-Version: <semver>`                 (for the server's compat checks)
 *
 * Both Auth-Token AND Release-Token must validate server-side.
 */

import { RELEASE_TOKEN, TOOL_VERSION } from './release-token.js';

export interface UploadPayload {
  accessToken: string;
  channel: 'LIVE' | 'PTU' | 'EPTU' | 'TECH-PREVIEW';
  patchVersion: string;
  schemaVersion: number;
  qualityScore: number;
  entityCounts: Record<string, number>;
  manifest: unknown;
  data: unknown;
}

export interface UploadResult {
  ok: boolean;
  bundleId?: string;
  error?: string;
  details?: unknown;
}

export async function uploadBundle(
  apiBase: string,
  payload: UploadPayload,
): Promise<UploadResult> {
  const endpoint = `${apiBase}/functions/v1/ingest-bundle`;
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
        channel: payload.channel,
        patch_version: payload.patchVersion,
        schema_version: payload.schemaVersion,
        quality_score: payload.qualityScore,
        entity_counts: payload.entityCounts,
        manifest: payload.manifest,
        data: payload.data,
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
    return { ok: true, bundleId: json['bundle_id'] as string | undefined };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}
