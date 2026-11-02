import { ilikeTokenGroups, searchMatcher } from '../codex-search';
import { SEARCH_ALIASES, aliasExpansions, aliasKeyCount, setAliasLanguage } from './search-aliases';
import { GRADE_VALUES, needsMiniSearch, parseQuery, sizeChip, switchChip, withOptionCounts } from './search-query-parse';

describe('search aliases (C6)', () => {
  afterEach(() => setAliasLanguage('de'));

  it('holds roughly 170 terms across both languages', () => {
    expect(aliasKeyCount('de')).toBeGreaterThanOrEqual(170);
    expect(SEARCH_ALIASES.length).toBeGreaterThan(120);
  });

  it('expands nicknames and abbreviations to the data names', () => {
    expect(aliasExpansions('connie', 'de')).toContain('constellation');
    expect(aliasExpansions('QT', 'en')).toContain('quantum drive');
    expect(aliasExpansions('Hammie', 'en')).toContain('hammerhead');
    expect(aliasExpansions('repeater', 'en')).toEqual([]); // equals its own expansion: nothing to add
    expect(aliasExpansions('gladdy', 'en')).toContain('gladius');
    expect(aliasExpansions('torp', 'en')).toEqual([]); // a substring already matches
  });

  it('reads the UI language plus English', () => {
    expect(aliasExpansions('quantenantrieb', 'de')).toContain('quantum drive');
    expect(aliasExpansions('connie', 'de')).toContain('constellation'); // English slang still counts in German
  });

  it('when the UI is English, only English counts', () => {
    expect(aliasExpansions('quantenantrieb', 'en')).toEqual([]);
    expect(aliasExpansions('mittel', 'en')).toEqual([]);
    expect(aliasExpansions('connie', 'en')).toContain('constellation');
  });

  it('expands like a synonym in the client matcher', () => {
    setAliasLanguage('de');
    const m = searchMatcher('connie')!;
    expect(m('Constellation Andromeda')).toBeTrue();
    expect(m('Cutlass Black')).toBeFalse();
  });

  it('does not expand German words when English is active', () => {
    setAliasLanguage('en');
    expect(searchMatcher('quantenantrieb')!('Quantum Drive')).toBeFalse();
    setAliasLanguage('de');
    expect(searchMatcher('quantenantrieb')!('Quantum Drive')).toBeTrue();
  });

  it('adds the alias to the server ILIKE patterns', () => {
    setAliasLanguage('de');
    const group = ilikeTokenGroups('connie')[0];
    expect(group.some((p) => p.includes('constellation'))).toBeTrue();
  });
});

describe('search query parse (C2, C8)', () => {
  it('s4 becomes a size chip and leaves the text', () => {
    const p = parseQuery('s4 shield');
    expect(p.rest).toBe('shield');
    expect(p.chips.length).toBe(1);
    expect(p.chips[0].filter).toEqual({ size: 4 });
    expect(p.chips[0].source).toBe('parsed');
  });

  it('understands "größe 3" and "size 3"', () => {
    expect(parseQuery('größe 3 kühler').chips[0].filter.size).toBe(3);
    expect(parseQuery('cooler size 3').chips[0].filter.size).toBe(3);
    expect(parseQuery('cooler size 3').rest).toBe('cooler');
  });

  it('understands "klasse a" and "grade b"', () => {
    expect(parseQuery('klasse a kühler').chips[0].filter.grade).toBe('A');
    expect(parseQuery('grade b').chips[0].filter.grade).toBe('B');
  });

  it('combines size and grade', () => {
    const p = parseQuery('s2 klasse c kühler');
    expect(p.chips.map((c) => c.filter)).toEqual([{ size: 2 }, { grade: 'C' }]);
    expect(p.rest).toBe('kühler');
  });

  it('never splits hyphenated names and ignores out-of-range values', () => {
    expect(parseQuery('p4-ar').chips).toEqual([]);
    expect(parseQuery('z-s1 rail').chips).toEqual([]);
    expect(parseQuery('s11').chips).toEqual([]);
    expect(parseQuery('klasse e').chips).toEqual([]);
    expect(parseQuery('gladius').rest).toBe('gladius');
  });

  it('a size chip is switchable S1 to S3', () => {
    const chip = parseQuery('s1').chips[0];
    expect(chip.switchable).toBeTrue();
    const next = switchChip(chip, '3');
    expect(next.filter).toEqual({ size: 3 });
    expect(next.labelParams).toEqual({ size: 3 });
  });

  it('switching to an unknown value changes nothing', () => {
    const chip = sizeChip(2);
    expect(switchChip(chip, '99')).toBe(chip);
  });

  it('option counts fill in, missing values count 0 (grey, still clickable)', () => {
    const chip = withOptionCounts(sizeChip(2), { '2': 5, '3': 1 });
    expect(chip.options!.find((o) => o.value === '2')!.count).toBe(5);
    expect(chip.options!.find((o) => o.value === '6')!.count).toBe(0);
  });

  it('the size menu has more than 7 values, so it gets the mini search', () => {
    expect(needsMiniSearch(sizeChip(2))).toBeTrue();
    expect(GRADE_VALUES.length).toBe(4);
  });
});
