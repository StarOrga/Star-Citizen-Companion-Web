import {
  ilikeTokenGroups,
  ilikeTokenPatterns,
  normalizeSearch,
  rankBySearch,
  recordScore,
  searchMatcher,
  searchScore,
  searchTokens,
} from './codex-search';

describe('codex-search (shared Codex search dialect)', () => {
  describe('normalizeSearch', () => {
    it('lower-cases, strips diacritics, folds ß and collapses whitespace', () => {
      expect(normalizeSearch('  Kühl   Straße ')).toBe('kuhl strasse');
      expect(normalizeSearch('ÉCLIPSE')).toBe('eclipse');
    });
  });

  describe('searchTokens', () => {
    it('splits on whitespace and on separators a player cannot remember', () => {
      expect(searchTokens('P4-AR  rifle')).toEqual(['p4', 'ar', 'rifle']);
      expect(searchTokens('AEGS_Gladius')).toEqual(['aegs', 'gladius']);
      expect(searchTokens('a/b.c')).toEqual(['a', 'b', 'c']);
    });

    it('keeps the keybind chord joiner and the wildcard', () => {
      expect(searchTokens('alt+f')).toEqual(['alt+f']);
      expect(searchTokens('klwe_*')).toEqual(['klwe']);
      expect(searchTokens('aegs*glad')).toEqual(['aegs*glad']);
    });

    it('yields nothing for a term that filters nothing', () => {
      expect(searchTokens('')).toEqual([]);
      expect(searchTokens('   ')).toEqual([]);
      expect(searchTokens(' - _ ')).toEqual([]);
      expect(searchTokens('***')).toEqual([]);
    });
  });

  describe('searchMatcher', () => {
    it('is null for an empty or wildcard-only term', () => {
      expect(searchMatcher('')).toBeNull();
      expect(searchMatcher('  ')).toBeNull();
      expect(searchMatcher('*')).toBeNull();
    });

    it('finds "P4-AR" however the separator is typed', () => {
      for (const term of ['P4-AR', 'p4ar', 'p4 ar', 'ar p4', 'P4_AR', '  p4-ar  ']) {
        expect(searchMatcher(term)!('P4-AR Rifle')).withContext(term).toBeTrue();
      }
    });

    it('requires every token (more words narrow)', () => {
      const m = searchMatcher('cutlass black')!;
      expect(m('Drake Cutlass Black')).toBeTrue();
      expect(m('Drake Cutlass Red')).toBeFalse();
      expect(searchMatcher('black cutlass')!('Drake Cutlass Black')).toBeTrue();
    });

    it('matches tokens across fields (name + manufacturer)', () => {
      const m = searchMatcher('behring p4')!;
      expect(m('P4-AR Rifle', 'BEHR', 'Behring Applied Technology')).toBeTrue();
      expect(m('P4-AR Rifle', 'KLWE', 'Klaus & Werner')).toBeFalse();
    });

    it('ignores case and diacritics on both sides', () => {
      expect(searchMatcher('kuhl')!('Kühl Helmet')).toBeTrue();
      expect(searchMatcher('KÜHL')!('kuhl helmet')).toBeTrue();
      expect(searchMatcher('rustung')!('Rüstung')).toBeTrue();
    });

    it('keeps `*` as a wildcard', () => {
      expect(searchMatcher('klwe_*')!('klwe_pistol_energy_01')).toBeTrue();
      expect(searchMatcher('aegs*glad')!('AEGS_Gladius')).toBeTrue();
      expect(searchMatcher('aegs*glad')!('ANVL_Gladiator')).toBeFalse();
    });

    it('matches a keybind chord contiguously', () => {
      expect(searchMatcher('alt+f')!('Toggle lights', 'v_lights', 'kb1_lalt+f')).toBeTrue();
      expect(searchMatcher('alt+g')!('Toggle lights', 'v_lights', 'kb1_lalt+f')).toBeFalse();
    });

    it('does not match a token across two different fields', () => {
      // "gladi" + "us" must not glue the end of one field to the next.
      expect(searchMatcher('gladius')!('Gladi', 'us')).toBeFalse();
    });

    it('treats regex metacharacters literally', () => {
      expect(searchMatcher('a(b')!('a(b')).toBeTrue();
      expect(searchMatcher('[x]')!('abc')).toBeFalse();
      expect(() => searchMatcher('$^?{}|\\')).not.toThrow();
    });
  });

  describe('searchScore', () => {
    it('ranks exact > prefix > word prefix > substring > no name hit', () => {
      expect(searchScore('gladius', 'Gladius')).toBe(4);
      expect(searchScore('p4ar', 'P4-AR')).toBe(4);
      expect(searchScore('gladius', 'Gladius Valiant')).toBe(3);
      expect(searchScore('gladius', 'Aegis Gladius Pirate')).toBe(2);
      expect(searchScore('ladius', 'Aegis Gladius')).toBe(1);
      expect(searchScore('behring', 'P4-AR Rifle')).toBe(0);
    });

    it('scores a multi-word term matching a run of words above a class-name-only hit', () => {
      // Live finding: "cutlass black" listed the Best-in-Show edition first.
      expect(searchScore('cutlass black', 'Drake Cutlass Black')).toBe(2);
      expect(recordScore('cutlass black', ['Drake Cutlass Best In Show 2949 Edition'], ['DRAK_Cutlass_Black_BIS2949'])).toBe(1);
      expect(
        rankBySearch(
          'cutlass black',
          [
            { n: 'Drake Cutlass Best In Show 2949 Edition', id: 'DRAK_Cutlass_Black_BIS2949' },
            { n: 'Drake Cutlass Black', id: 'DRAK_Cutlass_Black' },
          ],
          (r) => [r.n],
          (r) => [r.id],
        ).map((r) => r.n),
      ).toEqual(['Drake Cutlass Black', 'Drake Cutlass Best In Show 2949 Edition']);
    });

    it('lets a class name count only for an exact or prefix hit', () => {
      expect(recordScore('aegs_gladius', ['Aegis Gladius'], ['AEGS_Gladius'])).toBe(4);
      expect(recordScore('aegs_', [null], ['AEGS_Gladius'])).toBe(3);
      expect(recordScore('gladius', ['Something'], ['AEGS_Gladius'])).toBe(1);
    });

    it('takes the best of several names and ignores empty ones', () => {
      expect(searchScore('aegs_gladius', null, 'Aegis Gladius', 'AEGS_Gladius')).toBe(4);
      expect(searchScore('', 'anything')).toBe(0);
    });
  });

  describe('rankBySearch', () => {
    const rows = ['Aegis Gladius Pirate', 'Aegis Gladius Valiant', 'Gladius Valiant', 'Gladius', 'Anvil Gladiator'];

    it('puts the exact match first and keeps the incoming order as the tiebreak', () => {
      expect(rankBySearch('gladius', rows, (r) => [r])).toEqual([
        'Gladius',
        'Gladius Valiant',
        'Aegis Gladius Pirate',
        'Aegis Gladius Valiant',
        'Anvil Gladiator',
      ]);
    });

    it('returns a copy in the incoming order for an empty term', () => {
      const out = rankBySearch('  ', rows, (r) => [r]);
      expect(out).toEqual(rows);
      expect(out).not.toBe(rows);
    });
  });

  describe('ilikeTokenPatterns (server side)', () => {
    it('emits one PostgREST pattern per token', () => {
      expect(ilikeTokenPatterns('Cutlass Black')).toEqual(['*cutlass*', '*black*']);
      expect(ilikeTokenPatterns('P4-AR')).toEqual(['*p4*', '*ar*']);
    });

    it('tolerates one separator at a letter/digit boundary, and nothing looser', () => {
      // Never "p…anything…4": that returned a Caterpillar BIS 2949 for "P4-AR".
      expect(ilikeTokenGroups('p4ar')).toEqual([['*p4ar*', '*p4_ar*', '*p_4ar*', '*p_4_ar*']]);
      expect(ilikeTokenGroups('c2')).toEqual([['*c2*', '*c_2*']]);
    });

    it('sends only [a-z0-9_*] and drops or() grammar chars', () => {
      expect(ilikeTokenPatterns('AEGS_*')).toEqual(['*aegs*']);
      expect(ilikeTokenPatterns('100%')).toEqual(['*100*']);
      expect(ilikeTokenPatterns('a,b(c)')).toEqual(['*a*', '*b*', '*c*']);
      for (const g of ilikeTokenGroups('x"y\\z%(a),b[c]')) for (const p of g) expect(p).toMatch(/^[a-z0-9_*]+$/);
    });

    it('keeps diacritics searchable without unaccent', () => {
      // A non-ASCII letter is one `_`, so "kühl" finds "Kühl" and "Kuhl".
      expect(ilikeTokenPatterns('Kühl')).toEqual(['*k_hl*']);
    });

    it('yields nothing for an empty or separator-only term', () => {
      expect(ilikeTokenPatterns('')).toEqual([]);
      expect(ilikeTokenPatterns(' (((, ')).toEqual([]);
      expect(ilikeTokenPatterns('*')).toEqual([]);
    });
  });
  describe('German search words (audit L05)', () => {
    it('lets a German word find the English-named record', () => {
      expect(searchMatcher('gewehr')!('P4-AR Rifle')).toBeTrue();
      expect(searchMatcher('Rüstung')!('Morozov-SH Core Armor')).toBeTrue();
      expect(searchMatcher('helm')!('Aril Helmet')).toBeTrue();
      expect(searchMatcher('Pistole')!('S-38 Pistol')).toBeTrue();
    });

    it('still matches the German word itself and ANDs with other tokens', () => {
      expect(searchMatcher('gewehr')!('P6-LR-Snipergewehr (Raureif)')).toBeTrue();
      expect(searchMatcher('gewehr p4')!('P4-AR Rifle')).toBeTrue();
      expect(searchMatcher('gewehr p4')!('P6-LR Sniper Rifle')).toBeFalse();
    });

    it('sends the synonyms to the server as alternatives of one AND group', () => {
      expect(ilikeTokenGroups('Gewehr P4')).toEqual([['*gewehr*', '*rifle*'], ['*p4*', '*p_4*']]);
      expect(ilikeTokenGroups('Rüstung')).toEqual([['*r_stung*', '*armor*']]);
    });

    it('expands only whole words, not a word being typed', () => {
      expect(ilikeTokenGroups('gewe')).toEqual([['*gewe*']]);
    });
  });
  describe('bounded work (redteam R4/R8)', () => {
    it('keeps a wildcard-heavy term linear', () => {
      const m = searchMatcher('a' + '*'.repeat(30) + 'z')!;
      const rows = Array.from({ length: 2000 }, (_, i) => `abcdefghijklmnopqrstuvwxy row ${i}`);
      const t0 = performance.now();
      for (const r of rows) m(r);
      expect(performance.now() - t0).toBeLessThan(200);
    });

    it('caps the tokens and the term length', () => {
      expect(searchTokens(Array.from({ length: 20 }, (_, i) => `w${i}`).join(' ')).length).toBe(8);
      expect(ilikeTokenGroups(Array.from({ length: 20 }, (_, i) => `word${i}`).join(' ')).length).toBe(8);
      expect(searchTokens('x'.repeat(500))[0].length).toBe(120);
    });
  });
});
