/**
 * Anonymous crash telemetry client for the Data Uploader.
 *
 * Reports uncaught main-process errors, unhandled rejections and forwarded
 * renderer crashes to the shared Supabase `ingest-telemetry` edge function
 * (wire contract v1 — see supabase/functions/ingest-telemetry/index.ts).
 *
 * WHY THE HMAC KEY LIVES IN THE BINARY
 *   `ingest-telemetry` is an unauthenticated machine endpoint (verify_jwt=false)
 *   guarded by an HMAC-SHA256 signature, exactly like the SCC app already does.
 *   The signing key is a shared anti-abuse secret, NOT a credential to any user
 *   data (writes are service-role-only; reads are admin-RPC-only). It is baked
 *   in at build time via Vite `define`, the same mechanism as RELEASE_TOKEN.
 *
 * PRIVACY
 *   - Only crash metadata is sent (type/name/message/stack + app/os info).
 *   - installId / sessionId are opaque random ids; the server stores them ONLY
 *     as salted hashes, never raw.
 *   - No file paths beyond what a JS stack trace naturally contains, and the
 *     server truncates every free-text field again on ingest.
 *   - Fully opt-out: when disabled, buildCrashPayload is never called.
 *
 * This module is pure logic with injected I/O (crypto + fetch + clock) so it is
 * unit-testable without Electron or a network.
 */

export type Channel = 'stable' | 'beta' | 'dev';

export interface TelemetryMeta {
  /** App semver, e.g. "0.8.2". */
  appVersion: string;
  /** Release-token fingerprint or build id (audit only). */
  buildId: string | null;
  channel: Channel;
  /** node process.platform → normalised short os id ("win"/"mac"/"linux"). */
  os: string;
  /** OS release string (e.g. "10.0.26200"). */
  osRelease: string;
  /** CPU arch ("x64"/"arm64"). */
  arch: string;
  /** Stable per-install id (opaque random, persisted). */
  installId: string;
  /** Per-process-launch id (opaque random). */
  sessionId: string;
}

/** Which product this telemetry belongs to — server-side filter dimension. */
export const PRODUCT = 'data-uploader';

/** Wire `role` for this app (must be in the server's ROLES allow-list). */
export const ROLE = 'desktop';

export interface CrashInput {
  /** Coarse bucket: 'uncaughtException' | 'unhandledRejection' | 'renderer'. */
  errorType: string;
  /** Error.name (e.g. "TypeError") or null. */
  name: string | null;
  /** Error.message, truncated client-side. */
  message: string;
  /** Error.stack, truncated client-side. */
  stack: string | null;
  /** Optional small structured context (kept tiny; server truncates the row). */
  extra?: Record<string, unknown> | null;
}

/**
 * Normalise a HANDLED (non-fatal) error into a CrashInput. Accepts a real
 * Error, a plain string (e.g. the `error` code uploadBundle returns), or any
 * thrown value. Kept pure so the main-process `reportError` wrapper stays a thin
 * one-liner and this normalisation is unit-testable without Electron.
 */
export function toCrashInput(
  errorType: string,
  err: unknown,
  extra?: Record<string, unknown> | null,
): CrashInput {
  const e = err instanceof Error ? err : null;
  return {
    errorType,
    name: e?.name ?? null,
    message: e ? e.message : err == null ? '' : String(err),
    stack: e?.stack ?? null,
    extra: extra ?? null,
  };
}

export interface SignedRequest {
  url: string;
  body: string;
  headers: Record<string, string>;
}

// Client-side redaction budgets. The server re-clamps to the same ceilings, but
// trimming here keeps the payload small and avoids shipping huge stacks.
const MAX_MESSAGE = 500;
const MAX_STACK = 8000;
const MAX_NAME = 120;

function clamp(s: string | null | undefined, n: number): string | null {
  if (s == null) return null;
  return String(s).slice(0, n);
}

/** Normalise node's process.platform into the server's short os vocabulary. */
export function normaliseOs(platform: string): string {
  if (platform === 'win32') return 'win';
  if (platform === 'darwin') return 'mac';
  return platform === 'linux' ? 'linux' : platform;
}

/**
 * Build the exact JSON body the server expects for a `crash` batch.
 * Kept separate from signing so tests can assert the shape independently.
 */
export function buildCrashBody(meta: TelemetryMeta, crashes: CrashInput[]): string {
  return JSON.stringify({
    type: 'crash',
    product: PRODUCT,
    role: ROLE,
    appVersion: meta.appVersion,
    buildId: meta.buildId,
    channel: meta.channel,
    os: meta.os,
    osRelease: meta.osRelease,
    arch: meta.arch,
    installId: meta.installId,
    sessionId: meta.sessionId,
    events: crashes.map((c) => ({
      errorType: clamp(c.errorType, 60),
      name: clamp(c.name, MAX_NAME),
      message: clamp(c.message, MAX_MESSAGE) ?? '',
      stack: clamp(c.stack, MAX_STACK),
      extra: c.extra ?? null,
    })),
  });
}

/** Hex HMAC-SHA256 over `${timestamp}.${body}` — matches the edge function. */
export type HmacHex = (key: string, msg: string) => string;

/**
 * Produce the signed request (url + body + headers). Deterministic given
 * `nowMs`, so a test can pin the timestamp and assert the signature.
 */
export function signCrashRequest(
  apiBase: string,
  hmacKey: string,
  toolVersion: string,
  hmacHex: HmacHex,
  nowMs: number,
  meta: TelemetryMeta,
  crashes: CrashInput[],
): SignedRequest {
  const body = buildCrashBody(meta, crashes);
  const ts = String(nowMs);
  const signature = hmacHex(hmacKey, `${ts}.${body}`);
  return {
    url: `${apiBase.replace(/\/$/, '')}/functions/v1/ingest-telemetry`,
    body,
    headers: {
      'content-type': 'application/json',
      'x-scc-version': toolVersion,
      'x-scc-timestamp': ts,
      'x-scc-signature': signature,
    },
  };
}
