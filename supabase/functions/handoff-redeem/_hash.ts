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

/** Plausible code shape: 43 base64url chars. Anything else is rejected before any DB work. */
export function looksLikeCode(c: unknown): c is string {
  return typeof c === 'string' && /^[A-Za-z0-9_-]{43}$/.test(c);
}
