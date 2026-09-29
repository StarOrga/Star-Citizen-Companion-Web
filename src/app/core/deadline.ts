/**
 * Read deadlines (audit plan D06, block B4).
 *
 * A read that never answers must not leave a page spinning forever. Every
 * PostgREST read the app sends through supabase-js ends after
 * {@link READ_TIMEOUT_MS}; the app's own `fetch` calls use
 * {@link deadlineSignal}. Writes get NO deadline: an aborted write may still
 * commit on the server, and the UI cannot tell.
 *
 * The abort reason is a `DOMException` named `AbortError` whose message
 * starts with `TimeoutError`. The name matters: postgrest-js retries a
 * rejected GET/HEAD up to three times with 1/2/4 s backoff unless the
 * rejection is an `AbortError` — any other name would stretch 20 s to ~70 s.
 * The message matters too: `describeError` maps `TimeoutError` in the text to
 * `errors.timeout`.
 */

/** Upper bound for one read — above the `authenticated` statement timeout (8 s) plus transfer. */
export const READ_TIMEOUT_MS = 20_000;

/**
 * Read-only RPCs the client calls — checked against supabase/migrations on 1b08612.
 * All `stable` except get_telemetry_stats (declared volatile, body is SELECT-only).
 * NOT here: hangar_follow_snapshot — it writes the follower's sync copy.
 * A new RPC joins only if it is `stable`/`immutable` or provably writes nothing.
 */
export const READ_RPCS: ReadonlySet<string> = new Set([
  'codex_facet_values',
  'codex_compatible_items',
  'codex_armor_rating',
  'get_shared_loadout',
  'peek_shared_loadout',
  'list_loadouts_shared_with_me',
  'list_loadout_shares',
  'list_my_friend_edges',
  'my_account_status',
  'my_desktop_connections',
  'starscape_vote_state',
  'starscape_top_wallpapers',
  'starscape_release_for_channel',
  'starscape_latest_release',
  'desktop_release_for_channel',
  'get_telemetry_stats',
  'list_users_for_admin',
  'list_reports_for_admin',
  'list_allowed_emails',
  'pending_access_requests',
  'list_p4k_bundles_for_collaborator',
  'find_user_by_username',
]);

/**
 * True for a GET/HEAD under `restBase` (PostgREST table reads) and for a
 * `POST <restBase>rpc/<name>` whose name is in {@link READ_RPCS}.
 * `restBase` ends with a slash, e.g. `https://x.supabase.co/rest/v1/`.
 */
export function isReadRequest(method: string, url: string, restBase: string): boolean {
  if (!url.startsWith(restBase)) return false;
  const m = method.toUpperCase();
  if (m === 'GET' || m === 'HEAD') return true;
  if (m !== 'POST') return false;
  const path = url.slice(restBase.length).split(/[?#]/, 1)[0];
  if (!path.startsWith('rpc/')) return false;
  return READ_RPCS.has(path.slice('rpc/'.length));
}

function timeoutReason(ms: number): DOMException {
  return new DOMException(`TimeoutError: read deadline ${ms} ms exceeded`, 'AbortError');
}

/**
 * Links `outer` (if any) and a deadline of `ms` into one signal. A deadline
 * abort carries an `AbortError` whose message names `TimeoutError`; an outer
 * abort keeps the caller's reason.
 *
 * `AbortSignal.timeout` instead of `setTimeout` on purpose: it schedules no
 * zone macrotask, so a pending deadline never keeps the NgZone unstable (the
 * service worker registers when stable; specs `whenStable()`).
 */
export function deadlineSignal(ms: number = READ_TIMEOUT_MS, outer?: AbortSignal | null): AbortSignal {
  const ctrl = new AbortController();
  const timer = AbortSignal.timeout(ms);
  timer.addEventListener('abort', () => ctrl.abort(timeoutReason(ms)), { once: true });
  if (outer) {
    if (outer.aborted) ctrl.abort(outer.reason);
    else outer.addEventListener('abort', () => ctrl.abort(outer.reason), { once: true });
  }
  return ctrl.signal;
}

function requestParts(input: RequestInfo | URL, init?: RequestInit): { url: string; method: string } {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  const method = (init?.method ?? (typeof Request !== 'undefined' && input instanceof Request ? input.method : 'GET'))
    .toUpperCase();
  return { url, method };
}

/**
 * A `fetch` for supabase-js (`global.fetch`) that gives every PostgREST read a
 * deadline and passes everything else (writes, auth, storage, functions)
 * through untouched. The timer is NOT cleared when headers arrive, so a
 * stalled body is covered too; an abort after the body was read is a no-op.
 */
export function createReadDeadlineFetch(
  restBase: string,
  ms: number = READ_TIMEOUT_MS,
  base: typeof fetch = (...a) => fetch(...a),
): typeof fetch {
  return (input: RequestInfo | URL, init?: RequestInit) => {
    const { url, method } = requestParts(input, init);
    if (!isReadRequest(method, url, restBase)) return base(input, init);
    return base(input, { ...init, signal: deadlineSignal(ms, init?.signal) });
  };
}
