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
 */
export function safeRedirectTarget(
  raw: string | null | undefined,
  fallback = '/news',
): string {
  if (raw && raw.startsWith('/') && !raw.startsWith('//')) return raw;
  return fallback;
}
