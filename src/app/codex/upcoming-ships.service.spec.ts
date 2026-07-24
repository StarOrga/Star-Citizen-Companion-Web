import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { UpcomingShipsFeed, UpcomingShipsService } from './upcoming-ships.service';
import { ConsentService } from '../core/consent.service';

const FAVORITES_KEY = 'sc-companion.upcoming.favorites';
const BASELINE_KEY = 'sc-companion.upcoming.baseline';

function feed(ships: Array<{ id: string; name: string; productionStatus?: string }>): UpcomingShipsFeed {
  return {
    ships: ships.map((s) => ({
      id: s.id,
      name: s.name,
      manufacturer: null,
      manufacturerCode: null,
      productionStatus: s.productionStatus ?? 'in-concept',
      type: null,
      focus: null,
      rsiUrl: null,
      thumbnail: null,
      flightReadyButMissing: false,
    })),
    counts: null,
    fetchedAt: '2026-07-24T00:00:00.000Z',
  };
}

describe('UpcomingShipsService', () => {
  let svc: UpcomingShipsService;
  let http: HttpTestingController;

  function setup(preferencesAllowed = true) {
    TestBed.configureTestingModule({
      providers: [
        UpcomingShipsService,
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: ConsentService, useValue: { preferencesAllowed: () => preferencesAllowed } },
      ],
    });
    svc = TestBed.inject(UpcomingShipsService);
    http = TestBed.inject(HttpTestingController);
  }

  async function flush(body: UpcomingShipsFeed) {
    const pending = svc.refresh(true);
    http.expectOne((r) => r.url.endsWith('/functions/v1/rsi-upcoming-ships')).flush(body);
    await pending;
  }

  beforeEach(() => {
    localStorage.removeItem(FAVORITES_KEY);
    localStorage.removeItem(BASELINE_KEY);
  });

  afterEach(() => {
    http.verify();
    TestBed.resetTestingModule();
    localStorage.removeItem(FAVORITES_KEY);
    localStorage.removeItem(BASELINE_KEY);
  });

  it('seeds the baseline on the first load so nothing is announced as new', async () => {
    setup();
    await flush(feed([{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }]));
    expect(svc.notificationCount()).toBe(0);
    expect(JSON.parse(localStorage.getItem(BASELINE_KEY)!)).toEqual({ a: 'in-concept', b: 'in-concept' });
  });

  it('reports ships added after the stored baseline', async () => {
    localStorage.setItem(BASELINE_KEY, JSON.stringify({ a: 'in-concept' }));
    setup();
    await flush(feed([{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }]));
    expect(svc.diff().added.map((s) => s.id)).toEqual(['b']);
    expect(svc.newIds().has('b')).toBeTrue();
    expect(svc.notificationCount()).toBe(1);
  });

  it('acknowledge() clears the notification and rewrites the baseline', async () => {
    localStorage.setItem(BASELINE_KEY, JSON.stringify({ a: 'in-concept' }));
    setup();
    await flush(feed([{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }]));
    svc.acknowledge();
    expect(svc.notificationCount()).toBe(0);
    expect(JSON.parse(localStorage.getItem(BASELINE_KEY)!)).toEqual({ a: 'in-concept', b: 'in-concept' });
  });

  it('persists favorites and restores them from storage', async () => {
    setup();
    await flush(feed([{ id: 'a', name: 'A' }]));
    svc.toggleFavorite('a');
    expect(svc.isFavorite('a')).toBeTrue();
    expect(JSON.parse(localStorage.getItem(FAVORITES_KEY)!)).toEqual(['a']);
    svc.toggleFavorite('a');
    expect(svc.isFavorite('a')).toBeFalse();
    expect(JSON.parse(localStorage.getItem(FAVORITES_KEY)!)).toEqual([]);
  });

  it('does not write preference storage while consent is missing', async () => {
    setup(false);
    await flush(feed([{ id: 'a', name: 'A' }]));
    svc.toggleFavorite('a');
    expect(svc.isFavorite('a')).toBeTrue();
    expect(localStorage.getItem(FAVORITES_KEY)).toBeNull();
    expect(localStorage.getItem(BASELINE_KEY)).toBeNull();
  });

  it('filters the rendered blocks by the search query', async () => {
    setup();
    await flush(feed([{ id: 'a', name: 'Idris-P' }, { id: 'b', name: 'Zeus Mk II' }]));
    svc.query.set('zeus');
    expect(svc.concept().map((s) => s.id)).toEqual(['b']);
    expect(svc.filteredOut()).toBe(1);
    svc.clearQuery();
    expect(svc.concept().length).toBe(2);
  });

  it('favorites-only narrows the list and releases itself when the last favorite goes', async () => {
    setup();
    await flush(feed([{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }]));
    svc.toggleFavorite('a');
    svc.toggleFavoritesOnly();
    expect(svc.concept().map((s) => s.id)).toEqual(['a']);
    expect(svc.favoriteCount()).toBe(1);
    svc.toggleFavorite('a');
    expect(svc.favoritesOnly()).toBeFalse();
    expect(svc.concept().length).toBe(2);
  });
});
