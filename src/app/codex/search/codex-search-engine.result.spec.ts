import { TestBed, fakeAsync, tick } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { provideTranslateService } from '@ngx-translate/core';
import { AuthService } from '../../auth/auth.service';
import { SupabaseClientProvider } from '../../core/supabase.client';
import { NewsService } from '../../news/news.service';
import { searchContextOf } from '../../shell/fusion-bar/search-context';
import { CodexBuildDiffService } from '../codex-build-diff.service';
import { PolySearchHit, scopeForKind } from '../codex-poly-search';
import { CodexService, PolySearchResult } from '../codex.service';
import { CodexSearchEngine, SEARCH_DEBOUNCE_MS } from './codex-search-engine';
import { getAliasLanguage, setAliasLanguage } from './search-aliases';
import { SearchSignalsService } from './search-signals.service';

function hit(kind: PolySearchHit['kind'], slug: string, over: Partial<PolySearchHit> = {}): PolySearchHit {
  return {
    kind, classNameSlug: slug, nameLocalized: slug, manufacturerCode: null, manufacturerName: null,
    size: null, grade: null, scope: scopeForKind(kind), ...over,
  };
}

describe('CodexSearchEngine result (concept 2026-11-02)', () => {
  let searchAll: jasmine.Spy;
  let rpc: jasmine.Spy;
  let signals: { logMiss: jasmine.Spy; recordOpen: jasmine.Spy; cancelMiss: jasmine.Spy; ensurePopularity: jasmine.Spy; signals: jasmine.Spy };
  let engine: CodexSearchEngine;

  beforeEach(() => {
    localStorage.removeItem('sc.codex.recentSearches');
    searchAll = jasmine.createSpy('searchAll').and.resolveTo({ hits: [], totals: {} } as PolySearchResult);
    rpc = jasmine.createSpy('rpc').and.resolveTo({ data: [], error: null });
    signals = {
      logMiss: jasmine.createSpy('logMiss'),
      recordOpen: jasmine.createSpy('recordOpen'),
      cancelMiss: jasmine.createSpy('cancelMiss'),
      ensurePopularity: jasmine.createSpy('ensurePopularity'),
      signals: jasmine.createSpy('signals').and.returnValue({ recentRank: () => -1, owns: () => false, popularity: () => 0 }),
    };
    TestBed.configureTestingModule({
      providers: [
        CodexSearchEngine,
        provideRouter([]),
        provideTranslateService({ fallbackLang: 'en' }),
        { provide: CodexService, useValue: { searchAll, suggestNames: jasmine.createSpy().and.resolveTo([]) } },
        { provide: CodexBuildDiffService, useValue: { addedShipsMemo: () => Promise.resolve([]) } },
        { provide: AuthService, useValue: { isAuthenticated: () => false } },
        { provide: NewsService, useValue: { patchLines: () => [], feed: () => null, loading: () => false, refresh: () => Promise.resolve() } },
        { provide: SupabaseClientProvider, useValue: { client: { rpc } } },
        { provide: SearchSignalsService, useValue: signals },
      ],
    });
    engine = TestBed.inject(CodexSearchEngine);
  });

  afterEach(() => {
    localStorage.removeItem('sc.codex.recentSearches');
    setAliasLanguage('de');
  });

  it('a size typed in the text becomes a chip, is searched server-side and the text loses the word (C8)', fakeAsync(() => {
    searchAll.and.callFake((_t: string, _n: number, attrs?: { size?: number }) =>
      Promise.resolve({
        hits: attrs?.size ? [hit('item', 'C3', { size: 3, nameLocalized: 'Cooler' })] : [hit('item', 'C3', { size: 3, nameLocalized: 'Cooler' }), hit('item', 'C1', { size: 1, nameLocalized: 'Cooler Mk1' })],
        totals: { item: 2 },
        facets: { size: { '1': 1, '3': 1 }, grade: {} },
      } as PolySearchResult),
    );
    engine.searchFor('s3 cooler');
    tick();
    expect(searchAll.calls.argsFor(0)).toEqual(['cooler', 5, { size: 3 }]);
    expect(searchAll.calls.argsFor(1)).toEqual(['cooler', 5]); // unfiltered, for the outside group + counts
    const r = engine.result();
    expect(r.term).toBe('cooler');
    expect(r.chips.map((c) => c.id)).toEqual(['parsed:size']);
    expect(r.chips[0].options!.find((o) => o.value === '3')!.count).toBe(1);
    expect(r.chips[0].options!.find((o) => o.value === '6')!.count).toBe(0);
    tick(2000);
  }));

  it('switching the chip value re-searches with the new size (S3 to S5)', fakeAsync(() => {
    engine.searchFor('s3 cooler');
    tick();
    searchAll.calls.reset();
    engine.setChipValue('parsed:size', '5');
    tick();
    expect(searchAll.calls.argsFor(0)).toEqual(['cooler', 5, { size: 5 }]);
    expect(engine.activeChips()[0].filter.size).toBe(5);
    tick(2000);
  }));

  it('removing a chip searches without that filter; Backspace removes the last chip (C5)', fakeAsync(() => {
    engine.searchFor('s3 cooler');
    tick();
    searchAll.calls.reset();
    expect(engine.removeLastChip()).toBe('parsed:size');
    tick();
    expect(engine.activeChips()).toEqual([]);
    expect(searchAll.calls.argsFor(0)).toEqual(['cooler', 5]);
    tick(2000);
  }));

  it('context chips are always there until removed, and come back when the page changes', () => {
    engine.setContext(searchContextOf('/codex/index?kind=weapon'));
    expect(engine.activeChips().map((c) => c.id)).toEqual(['route:kind']);
    engine.removeChip('route:kind');
    expect(engine.activeChips()).toEqual([]);
    engine.setContext(searchContextOf('/codex/index?kind=ship'));
    expect(engine.activeChips().map((c) => c.id)).toEqual(['route:kind']);
  });

  it('sets the alias language before searching: English only when the UI is English', fakeAsync(() => {
    engine.searchFor('qt');
    tick();
    expect(getAliasLanguage()).toBe('en');
    tick(2000);
  }));

  it('counts a search without any hit once, with the searched text (C10)', fakeAsync(() => {
    engine.setInput('zzzz');
    tick(SEARCH_DEBOUNCE_MS);
    tick();
    expect(signals.logMiss).toHaveBeenCalledOnceWith('zzzz');
    tick(2000);
  }));

  it('does not count a search that found something', fakeAsync(() => {
    searchAll.and.resolveTo({ hits: [hit('ship', 'AEGS_Gladius')], totals: { ship: 1 } } as PolySearchResult);
    engine.searchFor('gladius');
    tick();
    expect(signals.logMiss).not.toHaveBeenCalled();
    tick(2000);
  }));

  it('records an opened hit for the local and the server signal (C9)', fakeAsync(() => {
    searchAll.and.resolveTo({ hits: [hit('ship', 'AEGS_Gladius')], totals: { ship: 1 } } as PolySearchResult);
    engine.searchFor('gladius');
    tick();
    const row = engine.result().groups[0].rows[0];
    engine.noteOpened(row);
    expect(signals.recordOpen).toHaveBeenCalledWith('ship', 'AEGS_Gladius');
    tick(2000);
  }));

  it('adds the gallery group from search_gallery and degrades silently on an error', fakeAsync(() => {
    rpc.and.resolveTo({ data: [{ image_id: 'img1', title: 'Gladius dawn', series: null, published_at: null, preview_url: null }], error: null });
    engine.searchFor('gladius');
    tick();
    expect(rpc).toHaveBeenCalledWith('search_gallery', { p_query: 'gladius', p_limit: 8 });
    expect(engine.result().groups.find((g) => g.id === 'gallery')?.rows[0].target.link).toEqual(['/verse', 'gallery', 'img1']);

    rpc.and.resolveTo({ data: null, error: { code: 'PGRST202', message: 'missing' } });
    engine.searchFor('gladius again');
    tick();
    expect(engine.result().groups.some((g) => g.id === 'gallery')).toBeFalse();
    tick(2000);
  }));

  it('carries did-you-mean for a search without hits (C7)', fakeAsync(() => {
    TestBed.inject(CodexService); // the mock answers suggestNames with []
    engine.searchFor('gladuis');
    tick();
    expect(engine.result().didYouMean).toEqual([]);
    expect(engine.result().empty).toBeTrue();
    tick(2000);
  }));
});
