/**
 * Allowlist for a USER-SUPPLIED official RSI pledge-ship link (feedback f7d3bd9a).
 *
 * Our catalog has no reliable per-ship RSI slug (`class_name` != RSI URL slug),
 * so users may pin the correct pledge page themselves. That makes the value
 * attacker-controlled, and it is later rendered as an `href`. Rules:
 *
 *   - The URL is pure DATA. It is never executed, never `innerHTML`-ed, and
 *     never placed into an LLM prompt. It is not an instruction.
 *   - Only ONE shape is storable, anchored `^...$`:
 *       https://robertsspaceindustries.com/en/pledge/ships/<slug>/<Name>
 *   - The host is compared with `===` against the exact hostname. Never
 *     `endsWith`/`includes` - `robertsspaceindustries.com.evil.tld` and
 *     `evil.robertsspaceindustries.com` must both be rejected.
 *
 * THIS FILE IS DEFENCE IN DEPTH, NOT THE AUTHORITY. The authority is the
 * `ship-link` Edge Function (supabase/functions/ship-link/_rsi-url.ts holds the
 * mirror of this logic), backed by a CHECK constraint on the table. A client
 * can always be bypassed; those two cannot.
 */

/** The one hostname we accept, compared with `===`. */
export const RSI_HOST = 'robertsspaceindustries.com';

/**
 * The canonical storable shape - this exact pattern is also the Edge-Function
 * allowlist and the SQL CHECK constraint. Anchored, https-only, no query, no
 * fragment, no userinfo, no port, no locale other than the canonical `en`.
 */
export const RSI_PLEDGE_SHIP_URL_RE =
  /^https:\/\/robertsspaceindustries\.com\/en\/pledge\/ships\/[a-z0-9-]+\/[A-Za-z0-9-]+$/;

/** Upper bound on raw input so a pathological string never reaches the parser. */
const MAX_RAW_LENGTH = 300;

/** Whitespace or C0/C1 control characters - never present in a real link. */
const FORBIDDEN_CHARS_RE = /[\s\u0000-\u001f\u007f]/;

/**
 * Parse + canonicalize a raw user input into the single storable shape, or
 * `null` if it is not an official RSI pledge-ship link.
 *
 * Canonicalization is deliberately narrow: it only drops a trailing slash and
 * rewrites the locale segment (`/de/...`, `/fr/...`, or none at all) to `/en/`,
 * so a user pasting the link from their own localized RSI session is not
 * punished. It can never turn a foreign origin into an accepted one - scheme,
 * host, userinfo, port, query and fragment are checked on the PARSED url before
 * the path is even looked at, and the rebuilt result is re-tested against
 * `RSI_PLEDGE_SHIP_URL_RE` as a final belt.
 */
export function normalizeRsiPledgeShipUrl(raw: string | null | undefined): string | null {
  const trimmed = (raw ?? '').trim();
  if (!trimmed || trimmed.length > MAX_RAW_LENGTH) return null;

  // Screen the RAW string first. `new URL` reports an empty `.search` for a
  // bare trailing `?` and silently strips embedded tabs/newlines, so these two
  // classes have to die before parsing; the parsed object is screened again.
  if (trimmed.includes('?') || trimmed.includes('#')) return null;
  if (FORBIDDEN_CHARS_RE.test(trimmed)) return null;

  let u: URL;
  try {
    u = new URL(trimmed);
  } catch {
    return null; // not even a URL
  }

  // Scheme: https only. Kills javascript:, data:, blob:, file:, plain http.
  if (u.protocol !== 'https:') return null;
  // Host: EXACT match. `new URL` lowercases and punycodes, so look-alike
  // unicode domains and `...com.evil.tld` / `evil....com` all fail here.
  if (u.hostname !== RSI_HOST) return null;
  // `https://robertsspaceindustries.com@evil.tld/...` parses with hostname
  // `evil.tld`, but reject userinfo explicitly so the intent is on the record.
  if (u.username || u.password) return null;
  if (u.port) return null;
  // No query string, no fragment - both are attacker-steerable trailing data.
  if (u.search || u.hash) return null;

  // Path must be exactly [locale?]/pledge/ships/<slug>/<Name>. Segments come
  // from the parsed pathname, so dot-segment and percent-encoded traversal are
  // already resolved away by the URL parser and simply fail the shape test.
  const segments = u.pathname.split('/').filter((s) => s.length > 0);
  const path = /^[a-z]{2}$/.test(segments[0] ?? '') ? segments.slice(1) : segments;
  if (path.length !== 4) return null;
  if (path[0] !== 'pledge' || path[1] !== 'ships') return null;
  if (!/^[a-z0-9-]+$/.test(path[2])) return null;
  if (!/^[A-Za-z0-9-]+$/.test(path[3])) return null;

  const canonical = `https://${RSI_HOST}/en/pledge/ships/${path[2]}/${path[3]}`;
  // Final belt: whatever we rebuilt must satisfy the storable pattern.
  return RSI_PLEDGE_SHIP_URL_RE.test(canonical) ? canonical : null;
}

/** True when `raw` can be stored as an official RSI pledge-ship link. */
export function isValidRsiPledgeShipUrl(raw: string | null | undefined): boolean {
  return normalizeRsiPledgeShipUrl(raw) !== null;
}
