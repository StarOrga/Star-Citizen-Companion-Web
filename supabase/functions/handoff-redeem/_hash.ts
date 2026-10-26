// Copy of hashCode in handoff-create/_handoff.ts (isolated deploy bundles).
export async function hashCode(code: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(code));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Coarse, non-fingerprinting label from a User-Agent: "Android - Chrome". */
export function deviceLabel(ua: string | null): string {
  const s = ua ?? '';
  const os = /android/i.test(s)
    ? 'Android'
    : /iphone|ipad|ipod/i.test(s)
      ? 'iOS'
      : /windows/i.test(s)
        ? 'Windows'
        : /mac os/i.test(s)
          ? 'macOS'
          : /linux/i.test(s)
            ? 'Linux'
            : 'Device';
  const br = /edg\//i.test(s)
    ? 'Edge'
    : /firefox|fxios/i.test(s)
      ? 'Firefox'
      : /chrome|crios/i.test(s)
        ? 'Chrome'
        : /safari/i.test(s)
          ? 'Safari'
          : 'Browser';
  return `${os} - ${br}`;
}

/** `session_id` claim of a GoTrue access token (unverified: we just minted it). */
export function sessionIdOf(accessToken: string): string | null {
  try {
    const payload = accessToken.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    const claims = JSON.parse(atob(payload));
    return typeof claims.session_id === 'string' ? claims.session_id : null;
  } catch {
    return null;
  }
}

/**
 * "jane.doe@gmail.com" -> "j***@g***.com". All the phone page may learn before
 * the user taps. Same algorithm as maskEmail in src/app/core/handoff/handoff.service.ts.
 */
export function maskEmail(email: string): string {
  const at = email.lastIndexOf('@');
  if (at < 1) return '***';
  const local = email.slice(0, at);
  const domain = email.slice(at + 1);
  const dot = domain.lastIndexOf('.');
  const host = dot > 0 ? domain.slice(0, dot) : domain;
  const tld = dot > 0 ? domain.slice(dot) : '';
  return `${local[0]}***@${host[0] ?? ''}***${tld}`;
}

/** GoTrue answers an exhausted email/OTP quota with HTTP 429 / over_*_rate_limit. */
export function isRateLimited(err: { status?: number; code?: string } | null | undefined): boolean {
  return !!err && (err.status === 429 || (typeof err.code === 'string' && err.code.includes('rate_limit')));
}

/** Per-IP throttle: every call counts (peek and redeem alike), failures count extra. */
export interface Throttle {
  hits: number;
  failures: number;
  reset: number;
}
export const MAX_HITS = 30;
export const MAX_FAILURES = 10;
export const THROTTLE_WINDOW_MS = 10 * 60 * 1000;

export function touch(map: Map<string, Throttle>, key: string, now: number): Throttle {
  // Prune expired entries so a long-lived isolate does not grow without bound.
  for (const [k, v] of map) if (v.reset <= now) map.delete(k);
  let t = map.get(key);
  if (!t || t.reset <= now) {
    t = { hits: 0, failures: 0, reset: now + THROTTLE_WINDOW_MS };
    map.set(key, t);
  }
  t.hits += 1;
  return t;
}

export const isThrottled = (t: Throttle): boolean => t.hits > MAX_HITS || t.failures >= MAX_FAILURES;

/** Plausible code shape: 43 base64url chars. Anything else is rejected before any DB work. */
export function looksLikeCode(c: unknown): c is string {
  return typeof c === 'string' && /^[A-Za-z0-9_-]{43}$/.test(c);
}
