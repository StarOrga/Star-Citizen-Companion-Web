import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { AuthService } from '../../auth/auth.service';
import { ConsentService } from '../../core/consent.service';
import { HangarService } from '../../hangar/hangar.service';
import { WishNamesService } from '../../codex/search/wish-names.service';
import { WishlistStore } from '../../hq/data/wishlist.store';
import { HqSuppliesService } from '../../hq/hq-supplies.service';
import { NewsService } from '../../news/news.service';
import { RECENT_ROWS_KEY } from '../fusion-bar/search-recent-rows';
import { noteOpenedPage } from './merkliste-opened';
import { MerklisteService } from './merkliste.service';

function setup(preferences: boolean, own: { wishes?: unknown[]; open?: unknown[]; favs?: string[]; names?: Record<string, string> } = {}, asked: string[][] = []) {
  TestBed.configureTestingModule({
    providers: [
      provideRouter([{ path: '**', children: [] }]),
      { provide: AuthService, useValue: { user: signal(null) } },
      { provide: WishlistStore, useValue: { rows: signal(own.wishes ?? []), ensureLoaded: () => Promise.resolve() } },
      { provide: HangarService, useValue: { ships: signal([]) } },
      { provide: HqSuppliesService, useValue: { open: signal(own.open ?? []) } },
      { provide: NewsService, useValue: { feed: signal(null), favoriteIds: signal(new Set<string>(own.favs ?? [])), itemById: () => null, refresh: () => Promise.resolve() } },
      { provide: ConsentService, useValue: { preferencesAllowed: signal(preferences) } },
      { provide: WishNamesService, useValue: { request: (c: string[]) => asked.push(c), nameOf: (_k: string, c: string) => own.names?.[c] ?? null } },
    ],
  });
  return TestBed.inject(MerklisteService);
}

describe('MerklisteService "Zuletzt geoeffnet" (D7)', () => {
  beforeEach(() => {
    localStorage.removeItem(RECENT_ROWS_KEY);
    localStorage.setItem('sc.consent', JSON.stringify({ preferences: true, statistics: false }));
  });
  afterEach(() => {
    localStorage.removeItem(RECENT_ROWS_KEY);
    localStorage.removeItem('sc.consent');
  });

  it('writes nothing without the preferences consent', () => {
    localStorage.setItem('sc.consent', JSON.stringify({ preferences: false, statistics: false }));
    noteOpenedPage({ kind: 'ship', className: 'AEGS_Gladius', title: 'Gladius', manufacturerCode: 'AEGS' });
    expect(localStorage.getItem(RECENT_ROWS_KEY)).toBeNull();
  });

  it('an opened Codex page shows in the panel without the search having opened it', async () => {
    const svc = setup(false);
    await TestBed.inject(Router).navigateByUrl('/codex/ship/AEGS_Gladius');
    expect(svc.type()).toBe('ship');
    expect(svc.recent()).toEqual([]);
    noteOpenedPage({ kind: 'ship', className: 'AEGS_Gladius', title: 'Gladius', manufacturerCode: 'AEGS' });
    svc.refresh(); // the panel picks the storage up when it opens
    expect(svc.recent().map((r) => r.title)).toEqual(['Gladius']);
    expect(svc.recent()[0].target?.link).toEqual(['/codex', 'ship', 'AEGS_Gladius']);
  });

  it('keeps the newest first, one row per page, and cuts by the page type', async () => {
    const svc = setup(false);
    await TestBed.inject(Router).navigateByUrl('/codex/ship/AEGS_Gladius');
    noteOpenedPage({ kind: 'ship', className: 'A', title: 'A', manufacturerCode: null });
    noteOpenedPage({ kind: 'weapon', className: 'W', title: 'W', manufacturerCode: null });
    noteOpenedPage({ kind: 'ship', className: 'B', title: 'B', manufacturerCode: null });
    noteOpenedPage({ kind: 'ship', className: 'A', title: 'A', manufacturerCode: null });
    svc.refresh();
    expect(svc.recent().map((r) => r.title)).toEqual(['A', 'B']);
  });

  it('writes the key the search writes, so a reload still shows the page', () => {
    noteOpenedPage({ kind: 'ship', className: 'A', title: 'A', manufacturerCode: null });
    expect(JSON.parse(localStorage.getItem(RECENT_ROWS_KEY) ?? '[]').length).toBe(1);
    TestBed.resetTestingModule();
    expect(setup(false).recent().map((r) => r.title)).toEqual(['A']);
  });

  it('the number on the icon is the sum of what the tooltip names, and the icon has nothing to show at 0', () => {
    expect(setup(false).count()).toBe(0);
    TestBed.resetTestingModule();
    const svc = setup(false, { wishes: [{ kind: 'item', className: 'a', name: 'A', manufacturer: null }, { kind: 'blueprint', className: 'b', name: 'B', manufacturer: null }], open: [{ id: '1' }], favs: ['n1', 'n2'] });
    expect([svc.wishCount(), svc.supplyOpen(), svc.bookmarkCount()]).toEqual([2, 1, 2]);
    expect(svc.count()).toBe(5);
  });

  it('ignores announced ships and kinds without a type', () => {
    setup(true);
    noteOpenedPage({ kind: 'upcoming', className: 'X', title: 'X', manufacturerCode: null });
    noteOpenedPage({ kind: 'ammunition', className: 'Y', title: 'Y', manufacturerCode: null });
    expect(localStorage.getItem(RECENT_ROWS_KEY)).toBeNull();
  });
});

describe('MerklisteService wished names (D7)', () => {
  it('a wish without a stored name shows the catalog name, and its class is asked for once resolvable', async () => {
    const asked: string[][] = [];
    const svc = setup(false, { wishes: [{ kind: 'item', className: 'MISL_S01_IR_VNCL_Arrow', name: null, manufacturer: null }, { kind: 'item', className: 'Named', name: 'Gespeichert', manufacturer: null }], names: { MISL_S01_IR_VNCL_Arrow: 'Arrow-I-Rakete' } }, asked);
    await TestBed.inject(Router).navigateByUrl('/codex/index?kind=item');
    expect(svc.wished().map((r) => r.title)).toEqual(['Arrow-I-Rakete', 'Gespeichert']);
    expect(asked.flat()).toEqual(['MISL_S01_IR_VNCL_Arrow']);
  });
});
