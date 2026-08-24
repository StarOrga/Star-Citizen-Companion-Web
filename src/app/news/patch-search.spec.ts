import {
  highlightSegments,
  matchesTokens,
  normalizeSearchText,
  tokenizeQuery,
} from './patch-search';

describe('normalizeSearchText', () => {
  it('lowercases, strips diacritics and collapses whitespace', () => {
    expect(normalizeSearchText('  Ärger   MIT  Crème  ')).toBe('arger mit creme');
  });

  it('is a no-op for text that is already normal', () => {
    expect(normalizeSearchText('quantum drive')).toBe('quantum drive');
  });
});

describe('tokenizeQuery', () => {
  it('splits on whitespace', () => {
    expect(tokenizeQuery('orison instancing')).toEqual(['orison', 'instancing']);
  });

  it('yields nothing for an empty or whitespace-only query — "no filter"', () => {
    expect(tokenizeQuery('')).toEqual([]);
    expect(tokenizeQuery('   ')).toEqual([]);
  });
});

describe('matchesTokens', () => {
  it('requires EVERY token — a second word narrows, it does not widen', () => {
    const hay = 'Orison instancing improvements';
    expect(matchesTokens(hay, ['orison', 'instancing'])).toBe(true);
    expect(matchesTokens(hay, ['orison', 'lorville'])).toBe(false);
  });

  it('matches without regard to case or diacritics', () => {
    expect(matchesTokens('Höhle des Löwen', ['hohle'])).toBe(true);
    expect(matchesTokens('QUANTUM DRIVE', ['quantum'])).toBe(true);
  });

  it('treats "no tokens" as "no restriction" so callers need no special case', () => {
    expect(matchesTokens('anything at all', [])).toBe(true);
    expect(matchesTokens('', [])).toBe(true);
  });
});

describe('highlightSegments', () => {
  /** The invariant that matters: marking up a line must never rewrite it. */
  function joined(text: string, tokens: string[]): string {
    return highlightSegments(text, tokens).map((s) => s.text).join('');
  }

  it('returns the text untouched when nothing is being searched', () => {
    const segs = highlightSegments('Vehicle Combat Hit Markers', []);
    expect(segs).toEqual([{ text: 'Vehicle Combat Hit Markers', hit: false }]);
  });

  it('splits the line into matched and unmatched runs', () => {
    const segs = highlightSegments('Quantum Drive tuning', ['drive']);
    expect(segs.map((s) => s.text)).toEqual(['Quantum ', 'Drive', ' tuning']);
    expect(segs.map((s) => s.hit)).toEqual([false, true, false]);
  });

  it('marks every occurrence of a token', () => {
    const segs = highlightSegments('drive to drive', ['drive']);
    expect(segs.filter((s) => s.hit).length).toBe(2);
  });

  it('merges overlapping tokens into one run instead of nesting them', () => {
    const segs = highlightSegments('quantum', ['quant', 'antum']);
    expect(segs).toEqual([{ text: 'quantum', hit: true }]);
  });

  it('reports no hit as a single unmatched segment', () => {
    expect(highlightSegments('Hull C', ['orison'])).toEqual([{ text: 'Hull C', hit: false }]);
  });

  it('cuts the segments out of the ORIGINAL string, accents and all', () => {
    const text = 'Crème de la crème';
    const segs = highlightSegments(text, ['creme']);
    expect(joined(text, ['creme'])).toBe(text);
    expect(segs.filter((s) => s.hit).map((s) => s.text)).toEqual(['Crème', 'crème']);
  });

  it('never loses or invents a character, whatever the query', () => {
    const text = 'Long Term Persistence: Preserved — 4.9 LIVE';
    for (const q of [['long'], ['4.9'], ['e'], ['long', 'live'], ['nope']]) {
      expect(joined(text, q)).toBe(text);
    }
  });
});
