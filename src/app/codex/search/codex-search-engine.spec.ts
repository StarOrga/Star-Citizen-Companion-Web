import { TestBed, fakeAsync, tick } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { provideTranslateService } from '@ngx-translate/core';
import { CodexService, PolySearchResult } from '../codex.service';
import { CodexBuildDiffService } from '../codex-build-diff.service';
import { PolySearchHit, scopeForKind } from '../codex-poly-search';
import { CodexSearchEngine, SEARCH_DEBOUNCE_MS } from './codex-search-engine';
import {
  RECENT_SEARCHES_KEY,
  RECENT_SEARCHES_MAX,
  groupCounts,
  groupHits,
  hitTitle,
  indexTarget,
  isLivery,
  pushRecentSearch,
  readRecentSearches,
  targetUrl,
} from './codex-search-model';

function hit(kind: PolySearchHit['kind'], slug: string, over: Partial<PolySearchHit> = {}): PolySearchHit {
  return {
    kind,
    classNameSlug: slug,
    nameLocalized: slug,
    manufacturerCode: null,
    manufacturerName: null,
    size: null,
    grade: null,
    scope: scopeForKind(kind),
    ...over,
  };
}

const key = (k: string, mods: KeyboardEventInit = {}) =>
  new KeyboardEvent('keydown', { key: k, cancelable: true, ...mods });

describe('codex-search-model', () => {
  it('groups by kind in KIND_PRIORITY order, caps each group and keeps the totals', () => {
    const hits = [
      hit('weapon', 'w1'),
      hit('upcoming', 'u1'),
      hit('ship', 's1'),
      hit('ship', 's2'),
      hit('ship', 's3'),
      hit('component', 'c1'),
    ];
    const groups = groupHits('gladius', hits, { ship: 12, weapon: 1, upcoming: 1 }, 2);

    expect(groups.map((g) => g.kind)).toEqual(['ship', 'weapon', 'component', 'upcoming']);
    expect(groups[0].hits.map((h) => h.classNameSlug)).toEqual(['s1', 's2']);
    expect(groups[0].total).toBe(12);
    // A kind with no server total counts what it has; never below what is shown.
    expect(groups[2].total).toBe(1);
  });

  it('links "all N" into the index with kind + term, announced ships into their grid — only when there is more', () => {
    const groups = groupHits('gladius', [hit('ship', 's1'), hit('component', 'c1'), hit('upcoming', 'u1')], { ship: 9, component: 1, upcoming: 4 }, 5);

    expect(groups[0].more).toEqual({ link: ['/codex/index'], queryParams: { kind: 'ship', q: 'gladius' } });
    expect(groups[1].more).toBeNull();
    expect(groups[2].more).toEqual({ link: ['/codex/upcoming'], queryParams: { q: 'gladius' } });
    expect(targetUrl(indexTarget('component', 'p4 ar'))).toBe('/codex/index?kind=component&q=p4+ar');
  });

  it('counts cards, not records: the pill follows the dedupe, "all N" keeps the raw total', () => {
    // 49 weapon records matched, all 49 read, the dedupe left one card.
    const [weapons] = groupHits('p4', [hit('weapon', 'w1')], { weapon: 49 }, 6, {
      distinct: { weapon: 1 },
      read: { weapon: 49 },
    });
    expect(weapons.count).toBe(1);
    expect(weapons.countIsFloor).toBeFalse();
    expect(weapons.folded).toBe(48);
    expect(weapons.total).toBe(49);
    expect(weapons.more).toEqual({ link: ['/codex/index'], queryParams: { kind: 'weapon', q: 'p4' } });
  });

  it('a count over a partial read is a floor, and so is the folded number', () => {
    // 24 of 49 rows read, 3 cards among them: at least 3 cards, at least 21 folded.
    expect(groupCounts(49, 3, 3, 24)).toEqual({ count: 3, countIsFloor: true, folded: 21, foldedIsFloor: true });
    // Nothing folded, everything read: the count is the total, no hint.
    expect(groupCounts(5, 5, 5, 5)).toEqual({ count: 5, countIsFloor: false, folded: 0, foldedIsFloor: false });
    // No dedupe information (announced ships): the total, as before.
    expect(groupCounts(4, 4, undefined, undefined)).toEqual({ count: 4, countIsFloor: false, folded: 0, foldedIsFloor: false });
    // Never below what the group shows.
    expect(groupCounts(10, 6, 2, 10).count).toBe(6);
  });

  it('titles a hit in the app language and never with the raw class name', () => {
    const named = hit('item', 'X', { nameLocalized: 'Helmet', name: { de: 'Helm', en: 'Helmet', key: 'k' } });
    expect(hitTitle(named, 'de')).toBe('Helm');
    expect(hitTitle(named, 'en')).toBe('Helmet');
    expect(hitTitle(hit('component', 'AEGS_Gladius_Thruster_Main', { nameLocalized: null }), 'de')).not.toContain('_');
  });

  it('marks Paints as a livery', () => {
    expect(isLivery(hit('item', 'p', { attachType: 'Paints' }))).toBeTrue();
    expect(isLivery(hit('item', 'h', { attachType: 'Char_Armor_Helmet' }))).toBeFalse();
  });

  it('keeps recent searches newest first, deduped, capped — and survives a broken storage', () => {
    const store = new Map<string, string>();
    const storage = {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
    } as unknown as Storage;
    let list: string[] = [];
    for (let i = 0; i < RECENT_SEARCHES_MAX + 3; i++) list = pushRecentSearch(storage, list, `term ${i}`);
    list = pushRecentSearch(storage, list, 'TERM 9');

    expect(list.length).toBe(RECENT_SEARCHES_MAX);
    expect(list[0]).toBe('TERM 9');
    expect(list.filter((t) => t.toLowerCase() === 'term 9').length).toBe(1);
    expect(readRecentSearches(storage)).toEqual(list);

    const broken = {
      getItem: () => { throw new Error('denied'); },
      setItem: () => { throw new Error('quota'); },
    } as unknown as Storage;
    expect(readRecentSearches(broken)).toEqual([]);
    expect(pushRecentSearch(broken, [], 'x')).toEqual(['x']);
    store.set(RECENT_SEARCHES_KEY, '{not json');
    expect(readRecentSearches(storage)).toEqual([]);
  });
});

describe('CodexSearchEngine', () => {
  let searchAll: jasmine.Spy;
  let addedShipsMemo: jasmine.Spy;
  let engine: CodexSearchEngine;

  beforeEach(() => {
    localStorage.removeItem(RECENT_SEARCHES_KEY);
    searchAll = jasmine.createSpy('searchAll');
    addedShipsMemo = jasmine.createSpy('addedShipsMemo').and.resolveTo([]);
    TestBed.configureTestingModule({
      providers: [
        CodexSearchEngine,
        provideRouter([]),
        provideTranslateService({ fallbackLang: 'en' }),
        { provide: CodexService, useValue: { searchAll, suggestNames: jasmine.createSpy().and.resolveTo([]) } },
        { provide: CodexBuildDiffService, useValue: { addedShipsMemo } },
      ],
    });
    engine = TestBed.inject(CodexSearchEngine);
  });

  afterEach(() => localStorage.removeItem(RECENT_SEARCHES_KEY));

  it('debounces typing into one search for the last term, asking perGroup per kind', fakeAsync(() => {
    searchAll.and.resolveTo({ hits: [hit('ship', 'AEGS_Gladius')], totals: { ship: 1 } } as PolySearchResult);
    engine.perGroup.set(5);
    engine.setInput('gl');
    tick(100);
    engine.setInput('gladius');
    tick(SEARCH_DEBOUNCE_MS);

    expect(searchAll).toHaveBeenCalledOnceWith('gladius', 5);
    expect(engine.groups().length).toBe(1);
  }));

  it('drops the answer of a superseded search (race of in-flight searches)', fakeAsync(() => {
    let resolveOld!: (r: PolySearchResult) => void;
    searchAll.and.callFake((term: string) =>
      term === 'old'
        ? new Promise<PolySearchResult>((r) => (resolveOld = r))
        : Promise.resolve({ hits: [hit('weapon', 'new')], totals: {} }),
    );
    engine.searchFor('old');
    engine.searchFor('new');
    tick();
    resolveOld({ hits: [hit('ship', 'old')], totals: {} });
    tick();

    expect(engine.hits().map((h) => h.classNameSlug)).toEqual(['new']);
    expect(engine.loading()).toBeFalse();
  }));

  it('a clear while a search is in flight leaves no hits behind', fakeAsync(() => {
    let resolve!: (r: PolySearchResult) => void;
    searchAll.and.returnValue(new Promise<PolySearchResult>((r) => (resolve = r)));
    engine.searchFor('gladius');
    engine.clear();
    resolve({ hits: [hit('ship', 'AEGS_Gladius')], totals: {} });
    tick();

    expect(engine.hits()).toEqual([]);
    expect(engine.groups()).toEqual([]);
  }));

  it('a partial search keeps the hits and carries a translated note; a clean search drops it', fakeAsync(() => {
    spyOn(console, 'warn');
    searchAll.and.resolveTo({
      hits: [hit('ship', 'AEGS_Gladius')],
      totals: { ship: 1 },
      failed: ['item'],
      failure: new Error('canceling statement due to statement timeout'),
    });
    engine.searchFor('gladius');
    tick();
    expect(engine.error()).toBeNull();
    expect(engine.hits().length).toBe(1);
    expect(engine.partialError()).toBe('errors.timeout');

    searchAll.and.resolveTo({ hits: [hit('ship', 'AEGS_Gladius')], totals: { ship: 1 } });
    engine.retry();
    tick();
    expect(engine.partialError()).toBeNull();
  }));

  it('a failed search is an error key with retry, never "no results"', fakeAsync(() => {
    spyOn(console, 'warn');
    searchAll.and.rejectWith(new TypeError('Failed to fetch'));
    engine.searchFor('gladius');
    tick();
    expect(engine.error()).toMatch(/^errors\./);

    searchAll.and.resolveTo({ hits: [hit('ship', 'AEGS_Gladius')], totals: {} });
    engine.retry();
    tick();
    expect(engine.error()).toBeNull();
    expect(engine.hits().length).toBe(1);
  }));

  it('arrows walk the options across groups and wrap; Enter / Ctrl+Enter / Escape go to the host', fakeAsync(() => {
    searchAll.and.resolveTo({
      hits: [hit('ship', 's1'), hit('ship', 's2'), hit('weapon', 'w1')],
      totals: { ship: 9, weapon: 1 },
    });
    engine.perGroup.set(2);
    engine.searchFor('x');
    tick();
    // s1, s2, "all 9 ships", w1
    expect(engine.options().map((o) => o.type)).toEqual(['hit', 'hit', 'more', 'hit']);

    const down = key('ArrowDown');
    expect(engine.keyAction(down)).toBeNull();
    expect(down.defaultPrevented).toBeTrue();
    expect(engine.activeIndex()).toBe(0);
    engine.keyAction(key('ArrowDown'));
    engine.keyAction(key('ArrowDown'));
    engine.keyAction(key('ArrowDown'));
    expect(engine.activeOption()?.id).toBe('weapon-0');
    engine.keyAction(key('ArrowDown'));
    expect(engine.activeIndex()).toBe(0);
    engine.keyAction(key('ArrowUp'));
    expect(engine.activeIndex()).toBe(3);
    engine.keyAction(key('Home'));
    expect(engine.activeIndex()).toBe(0);

    expect(engine.keyAction(key('Enter'))).toBe('open');
    expect(engine.keyAction(key('Enter', { ctrlKey: true }))).toBe('open-new-tab');
    expect(engine.keyAction(key('Enter', { metaKey: true }))).toBe('open-new-tab');
    expect(engine.keyAction(key('Escape'))).toBe('escape');
  }));

  it('Enter before the debounce fired runs the search instead of opening anything', fakeAsync(() => {
    searchAll.and.resolveTo({ hits: [], totals: {} });
    engine.setInput('gladius');
    expect(engine.keyAction(key('Enter'))).toBeNull();
    tick();
    expect(searchAll).toHaveBeenCalledOnceWith('gladius', 5);
  }));

  it('opening a hit navigates and remembers the term; a recent search runs in place', fakeAsync(() => {
    const nav = spyOn(TestBed.inject(Router), 'navigate').and.resolveTo(true);
    searchAll.and.resolveTo({ hits: [hit('ship', 'AEGS_Gladius')], totals: {} });
    engine.searchFor('gladius');
    tick();

    expect(engine.open(engine.enterOption()!)).toBe('navigated');
    expect(nav).toHaveBeenCalledWith(['/codex', 'ship', 'AEGS_Gladius'], { queryParams: undefined });
    expect(engine.recent()).toEqual(['gladius']);
    expect(readRecentSearches(localStorage)).toEqual(['gladius']);

    engine.clear();
    const recent = engine.options().find((o) => o.type === 'recent')!;
    expect(engine.open(recent)).toBe('searched');
    expect(engine.input()).toBe('gladius');
  }));

  it('Ctrl+Enter opens the target in a new tab and leaves the search alone', fakeAsync(() => {
    const open = spyOn(window, 'open');
    searchAll.and.resolveTo({ hits: [hit('upcoming', 'rsi-x', { nameLocalized: 'Arrastra' })], totals: {} });
    engine.searchFor('arrastra');
    tick();

    expect(engine.open(engine.enterOption()!, true)).toBe('new-tab');
    expect(open).toHaveBeenCalledWith(jasmine.stringMatching(/\/codex\/upcoming\?q=Arrastra$/), '_blank', 'noopener');
    expect(engine.input()).toBe('arrastra');
  }));

  it('an empty field offers recent searches, the patch\'s new ships and the Codex areas', fakeAsync(() => {
    engine.recent.set(['gladius']);
    addedShipsMemo.and.resolveTo([
      { classNameSlug: 'RSI_Zeus', nameLocalized: 'Zeus', manufacturerCode: 'RSI', size: 3, grade: null, attachType: null, payload: {} },
    ]);
    engine.ensureSuggestions();
    engine.ensureSuggestions(); // read once
    tick();

    expect(addedShipsMemo).toHaveBeenCalledTimes(1);
    const types = engine.options().map((o) => o.type);
    expect(types[0]).toBe('recent');
    expect(types).toContain('fresh');
    expect(types.filter((t) => t === 'category').length).toBeGreaterThan(3);
  }));
});
