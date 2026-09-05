/**
 * Free-text search over patch content (feedback 961ab0a5: "patch bullet points
 * erfasst und suchbar").
 *
 * Client-side and synchronous by design. Everything searchable is already in
 * memory — the note titles arrive with the feed and a note's bullet points
 * arrive as one small outline document — so a server round trip per keystroke
 * would buy nothing but latency.
 *
 * Shared by the history rows and by the outline inside an expanded note, so a
 * query means the same thing everywhere on the page: every whitespace-separated
 * token must match somewhere (AND), case- and diacritic-insensitive. AND rather
 * than OR because typing a second word is how a reader NARROWS — "orison
 * instancing" should land on one line, not on everything mentioning Orison.
 *
 * The same grammar the Codex search uses (`matchesUpcomingQuery`), deliberately:
 * one search idiom for the whole app.
 */

/** Lowercase, decomposed, diacritics stripped, whitespace collapsed. */
export function normalizeSearchText(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** A query string → its normalized tokens. An empty query yields no tokens. */
export function tokenizeQuery(query: string): string[] {
  const normalized = normalizeSearchText(query);
  return normalized ? normalized.split(' ').filter(Boolean) : [];
}

/**
 * Does this haystack satisfy every token?
 *
 * No tokens = no restriction, which is what makes "the search box is empty" and
 * "everything matches" the same statement and keeps every caller free of a
 * special case.
 */
export function matchesTokens(haystack: string, tokens: readonly string[]): boolean {
  if (tokens.length === 0) return true;
  const hay = normalizeSearchText(haystack);
  return tokens.every((t) => hay.includes(t));
}

/** One run of a string, flagged as matched or not — the unit the UI marks up. */
export interface HighlightSegment {
  text: string;
  hit: boolean;
}

/**
 * Split a string into matched and unmatched runs so the template can wrap the
 * hits in `<mark>`.
 *
 * Matching happens on the NORMALIZED copy but the segments are cut out of the
 * ORIGINAL, so an accented or oddly-spaced source line renders unchanged and a
 * query without accents still highlights it. That only holds while normalizing
 * preserves length — lowercasing and diacritic stripping do (NFD then dropping
 * the combining marks restores the original length), whitespace collapsing does
 * NOT, so it is skipped here and only the per-character map is used.
 */
export function highlightSegments(text: string, tokens: readonly string[]): HighlightSegment[] {
  if (tokens.length === 0 || !text) return [{ text, hit: false }];
  const hay = text.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  // Bail out if the length invariant does not hold (exotic scripts can change
  // length under NFD). Highlighting is a nicety; a wrong offset is not.
  if (hay.length !== text.length) return [{ text, hit: false }];

  const hits: boolean[] = new Array(text.length).fill(false);
  let any = false;
  for (const token of tokens) {
    if (!token) continue;
    let from = 0;
    for (;;) {
      const at = hay.indexOf(token, from);
      if (at < 0) break;
      for (let i = at; i < at + token.length; i++) hits[i] = true;
      any = true;
      from = at + token.length;
    }
  }
  if (!any) return [{ text, hit: false }];

  const out: HighlightSegment[] = [];
  let start = 0;
  for (let i = 1; i <= text.length; i++) {
    if (i === text.length || hits[i] !== hits[start]) {
      out.push({ text: text.slice(start, i), hit: hits[start] });
      start = i;
    }
  }
  return out;
}

// ─────────────────────────────────────────────────────────────────────────────
// Spelling variants — "amis und briten schreiben unterschiedlich"
// ─────────────────────────────────────────────────────────────────────────────

/**
 * RSI writes American English, the reader may not (and half the community
 * writes British). A search for `armour` must find `Armor`, `manoeuvre` must
 * find `maneuver`, `stabilise` must find `stabilize`.
 *
 * Implemented as VARIANTS OF THE TOKEN, never as a folded haystack: folding
 * `colour → color` in the text would change its length, and
 * `highlightSegments` maps hits back onto the ORIGINAL string by offset. By
 * expanding the query instead, matching stays honest and the marks stay on the
 * right characters — whichever spelling the source used.
 *
 * The rules are the regular ones (they cover the long tail), plus a handful of
 * irregular pairs that no rule catches. Every rule is applied in BOTH
 * directions, so it does not matter which spelling the reader typed.
 */
const SPELLING_RULES: readonly [RegExp, string][] = [
  // colour ↔ color, armour ↔ armor, behaviour ↔ behavior
  [/our(s|ed|ing|less|ful)?$/, 'or$1'],
  [/or(s|ed|ing|less|ful)?$/, 'our$1'],
  // stabilise ↔ stabilize, optimisation ↔ optimization
  [/is(e|es|ed|ing|ation|ations|able|er|ers)$/, 'iz$1'],
  [/iz(e|es|ed|ing|ation|ations|able|er|ers)$/, 'is$1'],
  // yse ↔ yze (analyse / analyze)
  [/ys(e|es|ed|ing)$/, 'yz$1'],
  [/yz(e|es|ed|ing)$/, 'ys$1'],
  // centre ↔ center, calibre ↔ caliber
  [/([bctv])re(s)?$/, '$1er$2'],
  [/([bctv])er(s)?$/, '$1re$2'],
  // defence ↔ defense, licence ↔ license
  [/ence(s)?$/, 'ense$1'],
  [/ense(s)?$/, 'ence$1'],
  // catalogue ↔ catalog, dialogue ↔ dialog
  [/ogue(s)?$/, 'og$1'],
  [/og(s)?$/, 'ogue$1'],
  // travelling ↔ traveling, cancelled ↔ canceled, fuelled ↔ fueled
  [/([aeiou])ll(ed|ing|er|ers)$/, '$1l$2'],
  [/([aeiou])l(ed|ing|er|ers)$/, '$1ll$2'],
  // programme ↔ program
  [/mme(s)?$/, 'm$1'],
];

/** Pairs no rule reaches — both directions are generated from one entry. */
const SPELLING_PAIRS: readonly [string, string][] = [
  ['manoeuvre', 'maneuver'],
  ['manoeuvres', 'maneuvers'],
  ['manoeuvring', 'maneuvering'],
  ['grey', 'gray'],
  ['aluminium', 'aluminum'],
  ['sceptical', 'skeptical'],
  ['storey', 'story'],
  ['plough', 'plow'],
  ['draught', 'draft'],
  ['tyre', 'tire'],
  ['kerb', 'curb'],
  ['aeroplane', 'airplane'],
  ['armoury', 'armory'],
  ['jewellery', 'jewelry'],
  ['practise', 'practice'],
  ['disc', 'disk'],
];

/** Below this a rule would fire on fragments ("or" → "our") and match everything. */
const MIN_VARIANT_LENGTH = 4;

/**
 * A normalized token plus every spelling of it we know how to reach. The token
 * itself is always first, and the list is deduplicated — a caller can treat it
 * as "match any of these".
 */
export function spellingVariants(token: string): string[] {
  const out = [token];
  if (token.length < MIN_VARIANT_LENGTH) return out;
  const add = (v: string) => {
    if (v && v !== token && !out.includes(v)) out.push(v);
  };
  for (const [a, b] of SPELLING_PAIRS) {
    if (token === a) add(b);
    else if (token === b) add(a);
  }
  for (const [re, to] of SPELLING_RULES) {
    if (re.test(token)) add(token.replace(re, to));
  }
  return out;
}

/**
 * The tokens of a query, each expanded to its spellings. One entry per token,
 * so the AND-over-tokens / OR-over-spellings semantics stay explicit at the
 * call sites.
 */
export function tokenizeFuzzy(query: string): string[][] {
  return tokenizeQuery(query).map(spellingVariants);
}

/** Every spelling of every token, flattened — what the highlighter marks. */
export function fuzzyTokens(tokens: readonly string[]): string[] {
  const out: string[] = [];
  for (const t of tokens) for (const v of spellingVariants(t)) if (!out.includes(v)) out.push(v);
  return out;
}

/**
 * Like `matchesTokens`, but a token is satisfied by ANY of its spellings.
 * Still AND across tokens — typing a second word narrows, as before.
 */
export function matchesFuzzy(haystack: string, tokens: readonly string[]): boolean {
  if (tokens.length === 0) return true;
  const hay = normalizeSearchText(haystack);
  return tokens.every((t) => spellingVariants(t).some((v) => hay.includes(v)));
}
