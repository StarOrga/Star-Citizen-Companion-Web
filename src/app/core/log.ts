/**
 * The only place in `src/app` that writes to the browser console.
 *
 * Every line reads `[scope] <what>` plus an optional context object, so a
 * console full of warnings can be filtered by area. A later sink (PostHog, a
 * server endpoint) hooks in here — none is wired yet.
 *
 * `scripts/check-raw-errors.mjs` (prebuild) rejects `console.*` anywhere else
 * in `src/app`.
 */
export function logWarn(scope: string, msg: string, ctx?: unknown): void {
  if (ctx === undefined) console.warn(`[${scope}] ${msg}`);
  else console.warn(`[${scope}] ${msg}`, ctx);
}

/** Same as {@link logWarn} at error level — for failures, not degradations. */
export function logError(scope: string, msg: string, ctx?: unknown): void {
  if (ctx === undefined) console.error(`[${scope}] ${msg}`);
  else console.error(`[${scope}] ${msg}`, ctx);
}
