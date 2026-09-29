import { logWarn } from './log';

/**
 * The error translator (audit plan D05, block B2).
 *
 * Every failure the UI shows is reduced to one of a handful of kinds, each with
 * a DE/EN sentence under `errors.*`. The raw text (PostgREST message, fetch
 * TypeError, auth-js message) goes to the console via `logWarn` and never into
 * the DOM — "Failed to fetch" or "canceling statement due to statement timeout"
 * mean nothing to a player.
 *
 * `scripts/check-raw-errors.mjs` (prebuild) fails the build when someone puts
 * `error.message` into a UI signal again.
 */
export type ErrorKind =
  | 'offline'
  | 'network'
  | 'timeout'
  | 'sessionExpired'
  | 'forbidden'
  | 'notFound'
  | 'rateLimit'
  | 'server'
  | 'generic';

export interface DescribedError {
  readonly kind: ErrorKind;
  /** i18n key, always `errors.<kind>`. */
  readonly key: string;
  /** Raw text for the log only — never rendered. */
  readonly detail: string;
}

/** Every kind `describeError` can return — the i18n parity spec walks this. */
export const ERROR_KINDS: readonly ErrorKind[] = [
  'offline',
  'network',
  'timeout',
  'sessionExpired',
  'forbidden',
  'notFound',
  'rateLimit',
  'server',
  'generic',
];

type Loose = Record<string, unknown>;

function asObj(v: unknown): Loose | null {
  return v !== null && typeof v === 'object' ? (v as Loose) : null;
}

function str(v: unknown): string {
  return typeof v === 'string' ? v : '';
}

/** HTTP status from the error itself, a FunctionsHttpError's Response, or HttpErrorResponse. */
function statusOf(o: Loose): number | null {
  const direct = o['status'];
  if (typeof direct === 'number') return direct;
  const ctx = asObj(o['context']);
  if (ctx && typeof ctx['status'] === 'number') return ctx['status'] as number;
  return null;
}

/** The error plus its `cause` / `context` — names and codes may sit on either. */
function layers(o: Loose): Loose[] {
  const out = [o];
  const cause = asObj(o['cause']);
  if (cause) out.push(cause);
  const ctx = asObj(o['context']);
  if (ctx && !(typeof Response !== 'undefined' && ctx instanceof Response)) out.push(ctx);
  return out;
}

const TIMEOUT_TEXT = /TimeoutError|timed out|statement timeout/i;
const NETWORK_TEXT = /Failed to fetch|NetworkError when attempting to fetch resource|Load failed|fetch failed/i;
const TIMEOUT_AUTH_CODES = new Set(['request_timeout', 'hook_timeout']);
const RATE_AUTH_CODES = new Set(['over_request_rate_limit', 'over_email_send_rate_limit']);
const SESSION_CODES = new Set(['PGRST301', 'PGRST303', 'session_expired', 'refresh_token_not_found', 'bad_jwt']);
const NETWORK_NAMES = new Set(['FunctionsFetchError', 'AuthRetryableFetchError']);
const SERVER_NAMES = new Set(['FunctionsHttpError', 'FunctionsRelayError']);

function classify(err: unknown): ErrorKind {
  const o = asObj(err);
  if (!o) return 'generic';
  const all = layers(o);
  const names = all.map((l) => str(l['name']));
  const codes = all.map((l) => str(l['code']));
  const texts = all.flatMap((l) => [str(l['message']), str(l['details'])]).filter(Boolean);
  const status = statusOf(o);
  const message = str(o['message']);
  const code = str(o['code']);
  const hasCodeField = 'code' in o;

  // 1. timeout
  if (
    names.includes('TimeoutError') ||
    texts.some((t) => TIMEOUT_TEXT.test(t)) ||
    codes.includes('57014') ||
    status === 408 ||
    status === 504 ||
    codes.some((c) => TIMEOUT_AUTH_CODES.has(c))
  ) {
    return 'timeout';
  }

  // 2. network
  const typeErrorNetwork = names.includes('TypeError') && texts.some((t) => NETWORK_TEXT.test(t));
  const postgrestTransport = hasCodeField && code === '' && /^(TypeError|FetchError):/.test(message);
  const httpZero = names.includes('HttpErrorResponse') && status === 0;
  if (
    typeErrorNetwork ||
    postgrestTransport ||
    httpZero ||
    names.some((n) => NETWORK_NAMES.has(n)) ||
    (err instanceof TypeError && NETWORK_TEXT.test(message))
  ) {
    return 'network';
  }

  // 4. rate limit
  if (status === 429 || codes.some((c) => RATE_AUTH_CODES.has(c))) return 'rateLimit';

  // 5. session expired
  if (status === 401 || codes.some((c) => SESSION_CODES.has(c)) || names.includes('AuthSessionMissingError')) {
    return 'sessionExpired';
  }

  // 6. forbidden
  const envelopeError = str(asObj(o['body'])?.['error']) || str(o['error']);
  if (
    status === 403 ||
    codes.includes('42501') ||
    /^(forbidden|permission denied)/i.test(message) ||
    envelopeError === 'forbidden'
  ) {
    return 'forbidden';
  }

  // 7. not found
  if (status === 404 || codes.includes('PGRST116')) return 'notFound';

  // 8. server — a status ≥ 500, a PostgREST error with a code (no HTTP status
  // on the object; an auth-js 4xx error also carries a `code`, and a rejected
  // input is not a server fault), or a failed edge function.
  const postgrestCode = hasCodeField && code !== '' && status === null;
  if ((status !== null && status >= 500) || postgrestCode || names.some((n) => SERVER_NAMES.has(n))) {
    return 'server';
  }

  return 'generic';
}

function detailOf(err: unknown): string {
  if (typeof err === 'string') return err;
  const o = asObj(err);
  if (!o) return String(err);
  const parts = [str(o['name']), str(o['message'])].filter(Boolean);
  const code = str(o['code']);
  if (code) parts.push(`code=${code}`);
  const details = str(o['details']);
  if (details) parts.push(details);
  const status = statusOf(o);
  if (status !== null) parts.push(`status=${status}`);
  return parts.join(' · ');
}

/**
 * Map any thrown / returned error to a kind and its `errors.*` key. The
 * `online` flag is read at the moment of the failure: a transport error while
 * the browser is offline is "you are offline", not "the server is down".
 */
export function describeError(
  err: unknown,
  online: boolean = typeof navigator === 'undefined' || navigator.onLine,
): DescribedError {
  let kind = classify(err);
  if (!online && (kind === 'network' || kind === 'timeout')) kind = 'offline';
  return { kind, key: `errors.${kind}`, detail: detailOf(err) };
}

/**
 * Logs `[scope] <op> failed` with context and returns ONLY the i18n key for
 * the UI. The standard form for every `catch` that sets a UI signal.
 */
export function toErrorKey(scope: string, op: string, err: unknown, ctx?: Record<string, unknown>): string {
  logWarn(scope, `${op} failed`, { ...ctx, error: err });
  return describeError(err).key;
}
