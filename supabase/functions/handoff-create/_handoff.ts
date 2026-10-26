// Pure helpers for the hand-off code (no Deno APIs: runs under node --test too).
// handoff-redeem carries its own copy of `hashCode` (functions deploy as isolated
// bundles); _handoff.test.ts pins both to the same output.

export const CODE_TTL_SECONDS = 60;
export const MAX_PATH_LENGTH = 512;
/** Codes a single user may create per window. */
export const RATE_LIMIT_COUNT = 5;
export const RATE_LIMIT_WINDOW_MS = 10 * 60 * 1000;

/** 32 random bytes = 256 bit, base64url without padding (43 chars). */
export function generateCode(bytes: Uint8Array = crypto.getRandomValues(new Uint8Array(32))): string {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export async function hashCode(code: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(code));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Same-origin relative path or null. Rejects protocol-relative, backslashes,
 * control characters / whitespace, absolute URLs, over-long values and the
 * hand-off/login routes themselves (redirect loops).
 */
export function validateTargetPath(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  if (raw.length === 0 || raw.length > MAX_PATH_LENGTH) return null;
  if (!raw.startsWith('/') || raw.startsWith('//')) return null;
  if (raw.includes('\\')) return null;
  // eslint-disable-next-line no-control-regex
  if (/[\u0000- \u007f]/.test(raw)) return null;
  if (/^\/(handoff|login)(?:[/?#]|$)/.test(raw)) return null;
  return raw;
}
