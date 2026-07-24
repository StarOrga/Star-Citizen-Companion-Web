// Server-side allowlist for a user-supplied RSI pledge-ship link (feedback
// f7d3bd9a). THIS FILE IS THE AUTHORITY. The identical logic also exists in
// src/app/core/rsi-pledge-link.util.ts, but only so the browser can show a
// friendly error before the round-trip - a client check is advisory by
// definition and this function must never trust it.
//
// Keep the two in sync. The same pattern is a third time enforced in SQL by
// public.is_rsi_pledge_ship_url(text) (20260724130000_user_ship_links.sql), so
// even a direct PostgREST write by the row owner cannot store anything else.

/** The one hostname we accept, compared with `===` - never endsWith/includes. */
export const RSI_HOST = 'robertsspaceindustries.com';

/** The single storable shape. Anchored, https-only, no query/fragment/port. */
export const RSI_PLEDGE_SHIP_URL_RE =
  /^https:\/\/robertsspaceindustries\.com\/en\/pledge\/ships\/[a-z0-9-]+\/[A-Za-z0-9-]+$/;

const MAX_RAW_LENGTH = 300;

/** Whitespace or C0/C1 control characters - never present in a real link. */
const FORBIDDEN_CHARS_RE = /[\s\u0000-\u001f\u007f]/;

/**
 * Canonicalize a raw submission into the one storable shape, or `null` when it
 * is not an official RSI pledge-ship link.
 *
 * The URL is treated as pure DATA throughout: it is validated structurally,
 * rebuilt from its own verified parts, and never interpreted, never executed
 * and never forwarded into a prompt.
 */
export function normalizeRsiPledgeShipUrl(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (!trimmed || trimmed.length > MAX_RAW_LENGTH) return null;

  // Screen the RAW string first: `new URL` reports an empty `.search` for a
  // bare trailing `?` and silently strips embedded tabs/newlines.
  if (trimmed.includes('?') || trimmed.includes('#')) return null;
  if (FORBIDDEN_CHARS_RE.test(trimmed)) return null;

  let u: URL;
  try {
    u = new URL(trimmed);
  } catch {
    return null;
  }

  if (u.protocol !== 'https:') return null; // no javascript:, data:, blob:, http:
  if (u.hostname !== RSI_HOST) return null; // EXACT host - kills look-alikes
  if (u.username || u.password) return null; // `@` userinfo
  if (u.port) return null;
  if (u.search || u.hash) return null;

  const segments = u.pathname.split('/').filter((s) => s.length > 0);
  const path = /^[a-z]{2}$/.test(segments[0] ?? '') ? segments.slice(1) : segments;
  if (path.length !== 4) return null;
  if (path[0] !== 'pledge' || path[1] !== 'ships') return null;
  if (!/^[a-z0-9-]+$/.test(path[2])) return null;
  if (!/^[A-Za-z0-9-]+$/.test(path[3])) return null;

  const canonical = `https://${RSI_HOST}/en/pledge/ships/${path[2]}/${path[3]}`;
  return RSI_PLEDGE_SHIP_URL_RE.test(canonical) ? canonical : null;
}

/**
 * Ship slugs are our own codex `class_name` values (or a free-form name for a
 * ship that is not in the catalog yet). Constrained to a safe charset so the
 * value is never interesting as a payload either.
 */
const SHIP_SLUG_RE = /^[A-Za-z0-9_.-]{1,120}$/;

export function normalizeShipSlug(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  return SHIP_SLUG_RE.test(trimmed) ? trimmed : null;
}
