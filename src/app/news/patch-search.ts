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
