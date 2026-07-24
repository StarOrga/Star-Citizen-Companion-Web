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

// ---------------------------------------------------------------------------
// Extraction aborts
// ---------------------------------------------------------------------------
//
// An extraction that ends without a result is DATA LOSS for the operator: the
// P4K scan has to start over from zero. An *upload* that ends early is not —
// the resumable upload job picks it back up (see lib/upload-job.ts). So only
// extraction aborts are telemetried, deliberately, and the upload cancel path
// must stay silent.
//
// Wire-wise this rides the existing signed `crash` batch with a dedicated
// errorType, so it needs no ingest-function change; the admin dashboard splits
// it out of the crash aggregates via `error_type` (see the
// telemetry_extract_aborts migration).

/** Why an extraction stopped without producing a result. */
export type ExtractAbortReason =
  /** Operator pressed cancel in the UI. */
  | 'cancelled'
  /** App quit / last window closed while the extraction was still running. */
  | 'quit'
  /** The sidecar failed, died, or never emitted a usable result. */
  | 'error';

/** Server-side bucket (`telemetry_events.error_type`) for extraction aborts. */
export const EXTRACT_ABORT_ERROR_TYPE = 'extract-aborted';

/** Server-side `error_name` — what the dashboard shows as the event label. */
export const EXTRACT_ABORT_NAME = 'ExtractAborted';

export interface ExtractAbortContext {
  /** Internal run id — correlates the abort with the log file. */
  jobId: string;
  /** Last phase the sidecar reported before the abort (discover/extract/…). */
  phase?: string | null;
  /** Last percentage the sidecar reported (0..100). */
  pct?: number | null;
  /** How long the extraction had been running when it aborted. */
  elapsedMs?: number | null;
  /** Underlying failure text — only set for reason 'error'. */
  error?: string | null;
}

/**
 * Build the crash-wire event for an aborted extraction. Pure so the reason /
 * payload contract is unit-testable without Electron or a network.
 */
export function buildExtractAbort(
  reason: ExtractAbortReason,
  ctx: ExtractAbortContext,
): CrashInput {
  const detail = reason === 'error' && ctx.error ? `: ${ctx.error}` : '';
  return {
    errorType: EXTRACT_ABORT_ERROR_TYPE,
    name: EXTRACT_ABORT_NAME,
    message: clamp(`extraction aborted (${reason})${detail}`, MAX_MESSAGE) ?? '',
    stack: null,
    extra: {
      reason,
      jobId: ctx.jobId,
      phase: ctx.phase ?? null,
      // Round: a fractional percentage adds noise without adding signal.
      pct: typeof ctx.pct === 'number' && Number.isFinite(ctx.pct) ? Math.round(ctx.pct) : null,
      elapsedMs:
        typeof ctx.elapsedMs === 'number' && Number.isFinite(ctx.elapsedMs)
          ? Math.max(0, Math.round(ctx.elapsedMs))
          : null,
    },
  };
}

/**
 * Decide whether a finished extraction still owes an abort report.
 *
 * `requested` is the reason recorded the moment an abort was *asked for*
 * (operator cancel / app quit) — those report immediately, because on quit the
 * process may be gone before the child's exit resolves the promise. Returning
 * null there is what keeps a cancel from being reported twice.
 */
export function classifyExtractAbort(
  final: { ok: boolean; error?: string | null },
  requested: ExtractAbortReason | null,
): ExtractAbortReason | null {
  if (requested) return null; // already reported at request time
  if (final.ok) return null; // completed with a result — nothing to report
  return 'error';
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
