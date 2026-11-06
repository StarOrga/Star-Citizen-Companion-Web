import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { AuthService } from '../../auth/auth.service';
import { ConsentService } from '../../core/consent.service';
import { HangarService } from '../../hangar/hangar.service';
import { WishlistStore } from '../../hq/data/wishlist.store';
import { HqSuppliesService } from '../../hq/hq-supplies.service';
import { NewsService } from '../../news/news.service';
import { RECENT_ROWS_KEY } from '../fusion-bar/search-recent-rows';
import { MerklisteService } from './merkliste.service';

function setup(preferences: boolean, own: { wishes?: unknown[]; open?: unknown[]; favs?: string[] } = {}) {
  TestBed.configureTestingModule({
    providers: [
      provideRouter([{ path: '**', children: [] }]),
      { provide: AuthService, useValue: { user: signal(null) } },
      { provide: WishlistStore, useValue: { rows: signal(own.wishes ?? []), ensureLoaded: () => Promise.resolve() } },
      { provide: HangarService, useValue: { ships: signal([]) } },
      { provide: HqSuppliesService, useValue: { open: signal(own.open ?? []) } },
      { provide: NewsService, useValue: { feed: signal(null), favoriteIds: signal(new Set<string>(own.favs ?? [])), itemById: () => null, refresh: () => Promise.resolve() } },
      { provide: ConsentService, useValue: { preferencesAllowed: signal(preferences) } },
    ],
  });
  return TestBed.inject(MerklisteService);
}

describe('MerklisteService "Zuletzt geoeffnet" (D7)', () => {
  beforeEach(() => localStorage.removeItem(RECENT_ROWS_KEY));
  afterEach(() => localStorage.removeItem(RECENT_ROWS_KEY));

  it('an opened Codex page shows in the panel without the search having opened it', async () => {
    const svc = setup(false);
    await TestBed.inject(Router).navigateByUrl('/codex/ship/AEGS_Gladius');
    expect(svc.type()).toBe('ship');
    expect(svc.recent()).toEqual([]);
    svc.noteOpened({ kind: 'ship', className: 'AEGS_Gladius', title: 'Gladius', manufacturerCode: 'AEGS' });
    expect(svc.recent().map((r) => r.title)).toEqual(['Gladius']);
    expect(svc.recent()[0].target?.link).toEqual(['/codex', 'ship', 'AEGS_Gladius']);
  });

  it('keeps the newest first, one row per page, and cuts by the page type', async () => {
    const svc = setup(false);
    await TestBed.inject(Router).navigateByUrl('/codex/ship/AEGS_Gladius');
    svc.noteOpened({ kind: 'ship', className: 'A', title: 'A', manufacturerCode: null });
    svc.noteOpened({ kind: 'weapon', className: 'W', title: 'W', manufacturerCode: null });
    svc.noteOpened({ kind: 'ship', className: 'B', title: 'B', manufacturerCode: null });
    svc.noteOpened({ kind: 'ship', className: 'A', title: 'A', manufacturerCode: null });
    expect(svc.recent().map((r) => r.title)).toEqual(['A', 'B']);
  });

  it('writes to the device only when preferences are allowed', () => {
    const off = setup(false);
    off.noteOpened({ kind: 'ship', className: 'A', title: 'A', manufacturerCode: null });
    expect(localStorage.getItem(RECENT_ROWS_KEY)).toBeNull();
    TestBed.resetTestingModule();
    const on = setup(true);
    on.noteOpened({ kind: 'ship', className: 'A', title: 'A', manufacturerCode: null });
    expect(JSON.parse(localStorage.getItem(RECENT_ROWS_KEY) ?? '[]').length).toBe(1);
  });

  it('the number on the icon is the sum of what the tooltip names, and the icon has nothing to show at 0', () => {
    expect(setup(false).count()).toBe(0);
    TestBed.resetTestingModule();
    const svc = setup(false, { wishes: [{ kind: 'item', className: 'a', name: 'A', manufacturer: null }, { kind: 'blueprint', className: 'b', name: 'B', manufacturer: null }], open: [{ id: '1' }], favs: ['n1', 'n2'] });
    expect([svc.wishCount(), svc.supplyOpen(), svc.bookmarkCount()]).toEqual([2, 1, 2]);
    expect(svc.count()).toBe(5);
  });

  it('ignores announced ships and kinds without a type', () => {
    const svc = setup(true);
    svc.noteOpened({ kind: 'upcoming', className: 'X', title: 'X', manufacturerCode: null });
    svc.noteOpened({ kind: 'ammunition', className: 'Y', title: 'Y', manufacturerCode: null });
    expect(localStorage.getItem(RECENT_ROWS_KEY)).toBeNull();
  });
});
