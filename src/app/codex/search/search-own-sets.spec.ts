import type { HangarShip } from '../../hangar/hangar.types';
import { searchContextOf } from '../../shell/fusion-bar/search-context';
import { composeSearchResult } from './search-compose';
import { searchOwn } from './search-own';
import { ownSetGroups, ownSetOf } from './search-own-sets';
import { parseQuery } from './search-query-parse';

/** A10: "gemerkt" / "fehlt mir" / "lager" list their own set, alone and with a term. */
describe('own-set search words (A10)', () => {
  const entries = [
    { kind: 'item', className: 'MISL_S01_IR_VNCL_Arrow', name: 'Arrow-I-Rakete' },
    { kind: 'item', className: 'MISL_S05_Stalker_V', name: 'Stalker-V-Rakete' },
    { kind: 'ship', className: 'AEGS_Avenger_Stalker', name: null },
    { kind: 'upcoming', className: 'idris', name: 'Idris' },
  ];
  const ctx = searchContextOf('/codex');

  it('the set alone lists every entry, grouped by kind', () => {
    const groups = ownSetGroups(entries, '');
    expect(groups.map((g) => [g.kind, g.hits.length])).toEqual([['item', 2], ['ship', 1], ['upcoming', 1]]);
  });

  it('a term narrows the set, by name or class name; the catalog is never asked', () => {
    expect(ownSetGroups(entries, 'rakete').flatMap((g) => g.hits.map((h) => h.classNameSlug))).toEqual(['MISL_S01_IR_VNCL_Arrow', 'MISL_S05_Stalker_V']);
    expect(ownSetGroups(entries, 'stalker').flatMap((g) => g.hits.map((h) => h.classNameSlug))).toEqual(['MISL_S05_Stalker_V', 'AEGS_Avenger_Stalker']);
    expect(ownSetGroups(entries, 'xyz')).toEqual([]);
  });

  it('a row without a stored name shows the resolved name, else the readable class name', () => {
    const named = ownSetGroups(entries, '', (_k, c) => (c === 'AEGS_Avenger_Stalker' ? 'Aegis Avenger Stalker' : null));
    expect(named.find((g) => g.kind === 'ship')!.hits[0].nameLocalized).toBe('Aegis Avenger Stalker');
    expect(ownSetGroups(entries, '').find((g) => g.kind === 'ship')!.hits[0].nameLocalized).not.toContain('_');
  });

  it('a class listed twice is one row', () => {
    expect(ownSetGroups([entries[0], { ...entries[0], className: 'misl_s01_ir_vncl_arrow' }], '')[0].hits.length).toBe(1);
  });

  it('reads the set from the chips', () => {
    expect(ownSetOf(parseQuery('gemerkt').chips)).toBe('wished');
    expect(ownSetOf(parseQuery('fehlt mir rakete').chips)).toBe('needed');
    expect(ownSetOf(parseQuery('lager').chips)).toBeNull();
    expect(ownSetOf([])).toBeNull();
  });

  it('composes the set as rows with no "all N in the index" link and no own / patch rows', () => {
    const chips = parseQuery('gemerkt').chips;
    const own = searchOwn('', { ships: [{ id: 'h1', shipClassName: 'A1', customName: null, status: 'owned' } as HangarShip], configs: [], sets: [], items: [] }, { all: true });
    const r = composeSearchResult({
      term: '', groups: ownSetGroups(entries, ''), context: ctx, chips, own, signedIn: true, ownSet: true,
      wished: () => true,
    });
    expect(r.groups.map((g) => g.id).sort()).toEqual(['item', 'ship', 'upcoming']);
    expect(r.groups.every((g) => g.moreTarget === null)).toBeTrue();
    expect(r.empty).toBeFalse();
  });

  it('"lager" alone lists the whole Inventar, nothing from the catalog', () => {
    const chips = parseQuery('lager').chips;
    const items = [
      { name: 'Quantanium', class_name: 'Quantanium', location: 'New Babbage', qty: 1 },
      { name: 'Medpen', class_name: 'Medpen_01', location: 'Bei mir', qty: 3 },
    ];
    const own = searchOwn('', { ships: [], configs: [], sets: [], items }, { all: true, kinds: ['item'] });
    expect(own.total).toBe(2);
    const r = composeSearchResult({
      term: '', context: ctx, chips, own, signedIn: true,
      groups: [{ kind: 'ship', hits: [{ kind: 'ship', classNameSlug: 'A', nameLocalized: 'A', manufacturerCode: null, manufacturerName: null, size: null, grade: null, scope: 'equipment' }], total: 1, count: 1, countIsFloor: false, folded: 0, foldedIsFloor: false, more: null }],
    });
    // Whatever catalog group the caller read, the chip leaves only the reader's own data.
    expect(r.groups.map((g) => g.id)).toEqual(['own']);
    expect(r.outside).toBeNull();
  });

  it('"lager rakete" with an empty Inventar returns nothing at all', () => {
    const p = parseQuery('lager rakete');
    expect(p.rest).toBe('rakete');
    const own = searchOwn('rakete', { ships: [], configs: [], sets: [], items: [] }, { kinds: ['item'], all: true });
    const r = composeSearchResult({ term: 'rakete', groups: [], context: ctx, chips: p.chips, own, signedIn: true });
    expect(r.groups).toEqual([]);
    expect(r.empty).toBeTrue();
  });

  it('searchOwn without `all` still returns nothing for an empty term', () => {
    expect(searchOwn('', { ships: [], configs: [], sets: [], items: [{ name: 'A', class_name: 'a', location: 'x', qty: 1 }] }).total).toBe(0);
  });
});
