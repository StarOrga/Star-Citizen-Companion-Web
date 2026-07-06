/**
 * Main-process crash telemetry reporter.
 *
 * Glue between the pure `../lib/telemetry` signer and the real world: assembles
 * runtime metadata (Electron app + Node os), gates on the opt-out setting,
 * signs with node:crypto HMAC, and POSTs to the ingest-telemetry edge function.
 *
 * Every path is best-effort: telemetry must NEVER throw into the crash handler
 * that called it, and a failed send is logged at debug level only.
 */

import { app } from 'electron';
import { createHmac, randomUUID } from 'node:crypto';
import { release, arch } from 'node:os';
import log from 'electron-log';
import {
  signCrashRequest,
  normaliseOs,
  type CrashInput,
  type TelemetryMeta,
} from '../lib/telemetry.js';
import {
  API_BASE,
  TELEMETRY_HMAC_KEY,
  TELEMETRY_CHANNEL,
  TOOL_VERSION,
  RELEASE_TOKEN,
} from '../lib/release-token.js';
import { isTelemetryEnabled, getSettings } from './settings.js';

// One id per process launch — groups the crashes of a single session together
// server-side without persisting anything.
const SESSION_ID = randomUUID();

function hmacHex(key: string, msg: string): string {
  return createHmac('sha256', key).update(msg).digest('hex');
}

function buildMeta(): TelemetryMeta {
  return {
    appVersion: TOOL_VERSION,
    // Release-token fingerprint doubles as a coarse build id (audit only).
    buildId: RELEASE_TOKEN ? RELEASE_TOKEN.slice(0, 8) : null,
    channel: TELEMETRY_CHANNEL,
    os: normaliseOs(process.platform),
    osRelease: release(),
    arch: arch(),
    installId: getSettings().installId,
    sessionId: SESSION_ID,
  };
}

/**
 * Send a single crash event. Resolves to true if the server accepted it (204),
 * false on any error/opt-out. Never rejects.
 */
export async function reportCrash(crash: CrashInput): Promise<boolean> {
  try {
    if (!isTelemetryEnabled()) return false;

    const req = signCrashRequest(
      API_BASE,
      TELEMETRY_HMAC_KEY,
      TOOL_VERSION,
      hmacHex,
      Date.now(),
      buildMeta(),
      [crash],
    );

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    try {
      const res = await fetch(req.url, {
        method: 'POST',
        headers: req.headers,
        body: req.body,
        signal: controller.signal,
      });
      if (!res.ok && res.status !== 204) {
        log.debug(`[telemetry] ingest rejected: HTTP ${res.status}`);
        return false;
      }
      return true;
    } finally {
      clearTimeout(timer);
    }
  } catch (err) {
    // Telemetry failures are non-fatal and intentionally quiet — a crash report
    // that can't be sent must not itself surface a new error to the operator.
    log.debug(`[telemetry] send failed: ${err instanceof Error ? err.message : String(err)}`);
    return false;
  }
}

/** Guard against reporting during app shutdown when the network is torn down. */
export function isAppReadyForTelemetry(): boolean {
  return app.isReady();
}
