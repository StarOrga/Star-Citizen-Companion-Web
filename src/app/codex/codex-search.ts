// Codex search — one matching dialect for every Codex search box.
// -----------------------------------------------------------------------------
// Before this module the Codex had five search surfaces with five rules: the
// index matched one contiguous ILIKE string, the FPS list a contiguous
// substring, the swap picker AND-ed tokens, keybinds a substring and only the
// upcoming grid folded diacritics. "p4 ar", "p4ar", "kuhl" or a double space
// found the item in one box and nothing in the next (Codex UX audit 2026-10-02).
//
// The rules, shared by the client-side matchers below and the server query
// (`ilikeTokenPatterns`):
//   - case and diacritics never matter ("kuhl" finds "Kühl");
//   - the term is split into tokens on whitespace AND on the separators a
//     player cannot be expected to remember ("P4-AR", "AEGS_Gladius", "a/b");
//     every token must match somewhere (AND), so more words narrow;
//   - a token that mixes letters and digits tolerates a separator at the
//     boundary, so "p4ar" finds "P4-AR";
//   - `*` stays a wildcard, as the index placeholder (`AEGS_*`) promises.

/** Lower-case, strip diacritics, collapse whitespace. */
export function normalizeSearch(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/ß/g, 'ss')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Characters treated as token separators — the term is split on them. */
// `+` is deliberately not one: it is the keybind chord joiner ("alt+f").
const SEPARATORS = /[\s\-_/.,;:()'"]+/;

/** The normalized tokens of a search term; `*` survives as a wildcard. */
export function searchTokens(term: string): string[] {
  return normalizeSearch(term)
    .split(SEPARATORS)
    .filter((t) => t.replace(/\*/g, '') !== '');
}

/** A token's letter/digit runs: "p4ar" → ["p", "4", "ar"], "gladius" → ["gladius"]. */
function boundaryParts(token: string): string[] {
  return token.match(/[a-z]+|[0-9]+|[^a-z0-9]+/g) ?? [token];
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * The regex for one token: its letter/digit runs joined by an optional
 * separator run, `*` as "anything". Matches against a NORMALIZED haystack.
 */
function tokenRegExp(token: string): RegExp {
  const pieces = token.split('*').map((chunk) =>
    boundaryParts(chunk)
      .filter(Boolean)
      .map(escapeRegExp)
      .join('[\\s\\-_/.]*'),
  );
  return new RegExp(pieces.join('.*'));
}

/**
 * A reusable predicate for one search term, or `null` when the term filters
 * nothing (empty or only wildcards/separators). The predicate takes every
 * searchable field of a record; each token must match at least one of them.
 */
export function searchMatcher(term: string): ((...fields: (string | null | undefined)[]) => boolean) | null {
  const tokens = searchTokens(term);
  if (tokens.length === 0) return null;
  const patterns = tokens.map(tokenRegExp);
  return (...fields) => {
    const haystack = normalizeSearch(fields.filter(Boolean).join(' \u0001 '));
    return patterns.every((p) => p.test(haystack));
  };
}

/**
 * How well a record's NAME answers the term — higher is better:
 *   4 exact, 3 prefix, 2 a word of the name starts with the term,
 *   1 the name contains it, 0 only another field matched.
 * Used to put "Gladius" above "Gladius Valiant" above "Aegis Gladius Pirate".
 */
export function searchScore(term: string, ...names: (string | null | undefined)[]): number {
  const q = normalizeSearch(term).replace(/\*/g, '');
  if (!q) return 0;
  const compactQ = q.replace(/[\s\-_/.]+/g, '');
  let best = 0;
  for (const raw of names) {
    if (!raw) continue;
    const n = normalizeSearch(raw);
    const compactN = n.replace(/[\s\-_/.]+/g, '');
    if (n === q || compactN === compactQ) return 4;
    if (n.startsWith(q) || compactN.startsWith(compactQ)) best = Math.max(best, 3);
    else if (n.split(/[\s\-_/.]+/).some((w) => w.startsWith(q))) best = Math.max(best, 2);
    else if (n.includes(q) || compactN.includes(compactQ)) best = Math.max(best, 1);
  }
  return best;
}

/**
 * Stable relevance sort: better name score first, the incoming order (the
 * server's alphabetical order) as the tiebreak. Returns a copy unchanged for
 * an empty term.
 */
export function rankBySearch<T>(term: string, rows: readonly T[], names: (row: T) => (string | null | undefined)[]): T[] {
  if (!normalizeSearch(term).replace(/\*/g, '')) return [...rows];
  return rows
    .map((row, i) => ({ row, i, s: searchScore(term, ...names(row)) }))
    .sort((a, b) => b.s - a.s || a.i - b.i)
    .map((x) => x.row);
}

/**
 * Server-side counterpart: one ILIKE pattern per token for PostgREST
 * (`*` is PostgREST's wildcard). A letter/digit boundary inside a token
 * becomes `*` so "p4ar" matches "P4-AR"; `_` (an ILIKE single-character
 * wildcard) never reaches the pattern because it is a separator. Characters
 * that break the `or=(…)` grammar are dropped. Case is handled by ILIKE.
 * The column has no unaccent, so the term keeps its diacritics here — but a
 * non-ASCII letter becomes `*`, so "kühl" still finds "Kühl" and "Kuhl"; a
 * plain "kuhl" cannot find "Kühl" server-side (no unaccent index yet).
 */
export function ilikeTokenPatterns(term: string): string[] {
  return term
    .toLowerCase()
    .split(SEPARATORS)
    .filter((t) => t.replace(/\*/g, '') !== '')
    .map((token) =>
      token
        .split('*')
        .map((chunk) => boundaryParts(chunk).filter((p) => /[a-z0-9]/.test(p)).join('*'))
        .join('*'),
    )
    .filter((p) => p.replace(/\*/g, '') !== '')
    .map((p) => `*${p}*`.replace(/\*+/g, '*'));
}
