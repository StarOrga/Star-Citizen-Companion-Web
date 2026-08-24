/**
 * Validates an untrusted `?redirect=…` query-param value as a same-origin
 * absolute path before it is ever handed to the router.
 *
 * Two independent call sites read a `redirect` query param that an attacker
 * can fully control via a crafted link (`LoginComponent.onSubmit()` /
 * `signInWithGoogle()`, and `publicOnlyGuard` for the "exit an impersonation
 * preview back to where you started" flow). Both MUST apply the exact same
 * check — this is that single source of truth.
 *
 * Only same-origin absolute paths are honored: the value must start with a
 * single `/` (protocol-relative `//evil.example` is rejected — the browser
 * would treat that as an absolute URL to a different origin, the classic
 * open-redirect vector). Anything else falls back to `fallback`.
 *
 * Backslashes are rejected outright, anywhere in the value. `/\evil.example`
 * defeats a naive `//` check on its own: the WHATWG URL parser treats `\` as
 * `/` for special schemes, so a browser resolving it lands on `//evil.example`
 * — a different origin. Neither current call site actually hands the value to
 * `location.href` (one goes through Angular's router, which reads it as a route
 * segment; the other is concatenated after an already-fixed origin), so this is
 * defence in depth rather than a live hole — but this util is the single source
 * of truth two call sites trust, and a future third one may not be as lucky.
 */
export function safeRedirectTarget(
  raw: string | null | undefined,
  fallback = '/news',
): string {
  if (!raw) return fallback;
  if (raw.includes('\\')) return fallback;
  if (raw.startsWith('/') && !raw.startsWith('//')) return raw;
  return fallback;
}
