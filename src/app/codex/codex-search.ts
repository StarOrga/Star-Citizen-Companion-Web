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
    .replace(/\p{M}/gu, '')
    .replace(/ß/g, 'ss')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Characters treated as token separators — the term is split on them. */
// `+` is deliberately not one: it is the keybind chord joiner ("alt+f").
const SEPARATORS = /[\s\-_/.,;:()'"]+/;

/** Longest term and most tokens a search honours — a pasted paragraph must not build an unbounded query. */
const MAX_TERM_LENGTH = 120;
const MAX_TOKENS = 8;

/** The normalized tokens of a search term; `*` survives as a wildcard. */
export function searchTokens(term: string): string[] {
  return normalizeSearch(term.slice(0, MAX_TERM_LENGTH))
    .split(SEPARATORS)
    .filter((t) => t.replace(/\*/g, '') !== '')
    .slice(0, MAX_TOKENS);
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
  // Empty chunks are dropped: "a***z" must stay one `.*`, never `(.*){k}`,
  // which backtracks exponentially on every non-matching row.
  const pieces = token.split('*').filter(Boolean).map((chunk) =>
    boundaryParts(chunk)
      .filter(Boolean)
      .map(escapeRegExp)
      .join('[\\s\\-_/.]*'),
  );
  return new RegExp(pieces.join('.*'));
}

/**
 * German words for things the datamine names in English only. The server's
 * `name_localized` is the English name (the German one lives in the payload,
 * which an index cannot reach in time), so "Gewehr", "Helm" or "Rüstung"
 * found nothing on the index (Codex UX audit L05). A token equal to a key
 * also matches its English counterparts — the German word itself still
 * counts, so German-named records keep matching. Keys are normalized
 * (lower case, no diacritics).
 */
export const SEARCH_SYNONYMS: Readonly<Record<string, readonly string[]>> = {
  gewehr: ['rifle'],
  sturmgewehr: ['rifle'],
  snipergewehr: ['sniper'],
  scharfschutzengewehr: ['sniper'],
  pistole: ['pistol'],
  schrotflinte: ['shotgun'],
  flinte: ['shotgun'],
  maschinenpistole: ['smg'],
  maschinengewehr: ['lmg'],
  raketenwerfer: ['launcher'],
  granatwerfer: ['launcher'],
  granate: ['grenade'],
  messer: ['knife'],
  helm: ['helmet'],
  rustung: ['armor'],
  panzerung: ['armor'],
  oberkorper: ['torso', 'core'],
  arme: ['arms'],
  beine: ['legs'],
  rucksack: ['backpack'],
  unterkleidung: ['undersuit'],
  anzug: ['suit'],
  munition: ['ammo', 'magazine'],
  magazin: ['magazine'],
  werkzeug: ['tool'],
  bergbau: ['mining'],
  schild: ['shield'],
  schilde: ['shield'],
  kuhler: ['cooler'],
  kraftwerk: ['power plant'],
  triebwerk: ['thruster'],
  rakete: ['missile'],
  raketen: ['missile'],
  geschutz: ['turret'],
  kanone: ['cannon'],
  lackierung: ['livery'],
  schiff: ['ship'],
};

/** The alternatives one token stands for: itself plus its synonyms. */
function tokenAlternatives(token: string): string[] {
  return [token, ...(SEARCH_SYNONYMS[token] ?? [])];
}

/**
 * A reusable predicate for one search term, or `null` when the term filters
 * nothing (empty or only wildcards/separators). The predicate takes every
 * searchable field of a record; each token (or one of its synonyms) must
 * match at least one of them.
 */
export function searchMatcher(term: string): ((...fields: (string | null | undefined)[]) => boolean) | null {
  const tokens = searchTokens(term);
  if (tokens.length === 0) return null;
  const groups = tokens.map((t) => tokenAlternatives(t).map(tokenRegExp));
  return (...fields) => {
    const haystack = normalizeSearch(fields.filter(Boolean).join(' \u0001 '));
    return groups.every((alts) => alts.some((p) => p.test(haystack)));
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
    // A word (or a run of words — "cutlass black") of the name starts with the term.
    else if ((' ' + n.replace(/[\-_/.]+/g, ' ')).includes(' ' + q.replace(/[\-_/.]+/g, ' '))) best = Math.max(best, 2);
    else if (n.includes(q) || compactN.includes(compactQ)) best = Math.max(best, 1);
  }
  return best;
}

/**
 * Score for a record: its display names count fully; its technical ids
 * (class names) only for an exact or prefix hit ("aegs_gladius", "aegs_") —
 * a word in the middle of a class name counts as a plain substring, otherwise "DRAK_Cutlass_Black_BIS2949" would tie with the
 * ship actually called "Cutlass Black".
 */
export function recordScore(
  term: string,
  names: readonly (string | null | undefined)[],
  ids: readonly (string | null | undefined)[] = [],
): number {
  const byName = searchScore(term, ...names);
  const byId = searchScore(term, ...ids);
  return Math.max(byName, byId >= 3 ? byId : Math.min(byId, 1));
}

/**
 * Stable relevance sort: better score first, the incoming order (the
 * server's alphabetical order) as the tiebreak. Returns a copy unchanged for
 * an empty term.
 */
export function rankBySearch<T>(
  term: string,
  rows: readonly T[],
  names: (row: T) => (string | null | undefined)[],
  ids: (row: T) => (string | null | undefined)[] = () => [],
): T[] {
  if (!normalizeSearch(term).replace(/\*/g, '')) return [...rows];
  return rows
    .map((row, i) => ({ row, i, s: recordScore(term, names(row), ids(row)) }))
    .sort((a, b) => b.s - a.s || a.i - b.i)
    .map((x) => x.row);
}

/**
 * Server-side counterpart: per token, the PostgREST ILIKE patterns that may
 * match it — the token itself plus its English synonyms (`*` is PostgREST's
 * wildcard). The caller ANDs the groups and ORs the patterns within one.
 *
 * The patterns stay tight, so a page of server rows is (almost) a page of
 * real matches and paging, counts and `limit: 1` callers keep working: a
 * letter/digit boundary inside a token becomes an optional single character
 * (`_`), i.e. "p4ar" asks for `*p4ar*` OR `*p_4ar*` OR `*p4_ar*` OR
 * `*p_4_ar*` — "P4-AR" yes, "Caterpillar BIS 2949" no. A non-ASCII letter is
 * one `_` too, so "kühl" finds "Kühl" and "Kuhl". The few rows an `_` still
 * lets through are dropped by the caller's {@link searchMatcher} re-check.
 * Only `[a-z0-9_*]` ever reaches the `or=(…)` string.
 */
export function ilikeTokenGroups(term: string): string[][] {
  return term
    .slice(0, MAX_TERM_LENGTH)
    .toLowerCase()
    .split(SEPARATORS)
    .filter((t) => t.replace(/\*/g, '') !== '')
    .slice(0, MAX_TOKENS)
    .map((raw) => {
      const syn = SEARCH_SYNONYMS[normalizeSearch(raw)] ?? [];
      return [...toIlikePatterns(raw), ...syn.flatMap(toIlikePatterns)];
    })
    .filter((g) => g.length > 0);
}

/** At most this many boundary variants per token (2^3). */
const MAX_BOUNDARY_VARIANTS = 8;

/** One token (or synonym) as PostgREST ILIKE patterns; empty when nothing searchable is left. */
function toIlikePatterns(token: string): string[] {
  const chunks = token.split('*').filter(Boolean).map(chunkVariants).filter((v) => v.length > 0);
  if (chunks.length === 0) return [];
  let out = [''];
  for (const variants of chunks) {
    out = out.flatMap((head) => variants.map((v) => (head ? `${head}*${v}` : v))).slice(0, MAX_BOUNDARY_VARIANTS);
  }
  return out.map((body) => `*${body}*`);
}

/** The ILIKE spellings of one wildcard-free chunk: letter/digit boundaries with and without one `_`. */
function chunkVariants(chunk: string): string[] {
  // Letters and digits stay; any other letter (ü, é, ß) is one `_`; the rest goes.
  const runs = (chunk.match(/[a-z]+|[0-9]+|\p{L}/gu) ?? []).map((r) => (/^[a-z0-9]+$/.test(r) ? r : '_'));
  if (runs.length === 0 || runs.every((r) => r === '_')) return [];
  let out = [runs[0]];
  for (let i = 1; i < runs.length; i++) {
    const boundary = runs[i] !== '_' && runs[i - 1] !== '_';
    const next = runs[i];
    out = boundary && out.length * 2 <= MAX_BOUNDARY_VARIANTS
      ? out.flatMap((h) => [h + next, `${h}_${next}`])
      : out.map((h) => h + next);
  }
  return out;
}

/** Flat list of every token's own (first) pattern — kept for callers that need a cache key. */
export function ilikeTokenPatterns(term: string): string[] {
  return ilikeTokenGroups(term).map((g) => g[0]);
}
