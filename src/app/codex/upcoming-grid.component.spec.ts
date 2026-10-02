import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { ConsentService } from '../core/consent.service';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { computed, signal } from '@angular/core';
import { provideTranslateService } from '@ngx-translate/core';
import { UpcomingShip, UpcomingShipsFeed, UpcomingShipsService } from './upcoming-ships.service';
import { UpcomingGridComponent } from './upcoming-grid.component';

function ship(id: string, name: string, flightReadyButMissing = false): UpcomingShip {
  return {
    id,
    name,
    manufacturer: 'Aegis',
    manufacturerCode: 'AEGS',
    productionStatus: 'in-concept',
    type: 'combat',
    focus: null,
    rsiUrl: null,
    thumbnail: null,
    flightReadyButMissing,
  };
}

describe('UpcomingGridComponent', () => {
  const feed = signal<UpcomingShipsFeed | null>(null);
  const loading = signal(false);
  const error = signal<string | null>(null);
  let refresh: jasmine.Spy;
  let acknowledge: jasmine.Spy;
  let toggleFavorite: jasmine.Spy;

  function mount(initial: UpcomingShipsFeed | null) {
    feed.set(initial);
    loading.set(false);
    error.set(null);
    refresh = jasmine.createSpy('refresh').and.resolveTo();
    acknowledge = jasmine.createSpy('acknowledge');
    toggleFavorite = jasmine.createSpy('toggleFavorite');
    const ships = computed(() => feed()?.ships ?? []);
    const stub = {
      feed,
      loading,
      error,
      concept: computed(() => ships().filter((s) => !s.flightReadyButMissing)),
      flightReadyMissing: computed(() => ships().filter((s) => s.flightReadyButMissing)),
      query: signal(''),
      favoritesOnly: signal(false),
      favoriteCount: signal(0),
      newIds: signal(new Set<string>(['s1'])),
      refresh,
      acknowledge,
      clearQuery: () => undefined,
      toggleFavoritesOnly: () => undefined,
      isFavorite: () => false,
      toggleFavorite,
    };
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        provideTranslateService({}),
        { provide: UpcomingShipsService, useValue: stub },
      ],
    });
    const fixture = TestBed.createComponent(UpcomingGridComponent);
    fixture.detectChanges();
    return { fixture, el: fixture.nativeElement as HTMLElement };
  }

  const FEED: UpcomingShipsFeed = {
    ships: [ship('s1', 'Avenger X'), ship('s2', 'Cutlass Y', true)],
    counts: null,
    fetchedAt: '2026-09-01T00:00:00Z',
  };

  it('renders each ship card as an anchor into the codex page, with a separate favourite button', () => {
    const { el } = mount(FEED);
    const cards = Array.from(el.querySelectorAll('a.card')) as HTMLAnchorElement[];
    expect(cards.map((a) => a.getAttribute('href'))).toEqual(['/codex/upcoming/s1', '/codex/upcoming/s2']);
    expect(el.querySelectorAll('a.card button').length).toBe(0);
    expect(el.querySelectorAll('button.fav').length).toBe(2);
    expect(el.textContent).toContain('codex.upcoming.conceptTitle');
    expect(el.textContent).toContain('codex.upcoming.flightReadyTitle');
    expect(el.querySelector('.badge.new')).not.toBeNull();
  });

  it('favourite button toggles without navigating', () => {
    const { el } = mount(FEED);
    (el.querySelector('button.fav') as HTMLButtonElement).click();
    expect(toggleFavorite).toHaveBeenCalledWith('s1');
  });

  it('loads the feed on enter and acknowledges on destroy', () => {
    const { fixture } = mount(null);
    expect(refresh).toHaveBeenCalled();
    fixture.destroy();
    expect(acknowledge).toHaveBeenCalled();
  });

  it('shows the error card with retry', () => {
    const { fixture, el } = mount(null);
    error.set('errors.network');
    fixture.detectChanges();
    const card = el.querySelector('.err');
    expect(card).not.toBeNull();
    expect(card!.textContent).toContain('errors.network');
    refresh.calls.reset();
    (card!.querySelector('button.retry') as HTMLButtonElement).click();
    expect(refresh).toHaveBeenCalled();
  });

  it('shows the empty card for an empty feed', () => {
    const { el } = mount({ ships: [], counts: null, fetchedAt: '2026-09-01T00:00:00Z' });
    expect(el.querySelector('.empty')?.textContent).toContain('codex.upcoming.empty.title');
    expect(el.querySelectorAll('a.card').length).toBe(0);
  });
});

// Codex UX audit 2026-10-02 (P0): the upcoming grid's search, driven through
// the real <input> against the real service, so a broken template binding fails.
describe('UpcomingGridComponent search (real input, real service)', () => {
  function upShip(id: string, name: string, manufacturer: string, code: string): UpcomingShip {
    return {
      id,
      name,
      manufacturer,
      manufacturerCode: code,
      productionStatus: 'in-concept',
      type: 'combat',
      focus: null,
      rsiUrl: null,
      thumbnail: null,
      flightReadyButMissing: false,
    };
  }

  const SEARCH_FEED: UpcomingShipsFeed = {
    ships: [
      upShip('a', 'Ironclad', 'Drake Interplanetary', 'DRAK'),
      upShip('b', 'Golem OX', 'Drake Interplanetary', 'DRAK'),
      upShip('c', 'Kühlschrank Hauler', 'Consolidated Outland', 'CNOU'),
      upShip('d', 'Concord Ranger', 'Anvil Aerospace', 'ANVL'),
    ],
    counts: null,
    fetchedAt: '2026-09-01T00:00:00Z',
  };

  function mountReal() {
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        provideTranslateService({}),
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: ConsentService, useValue: { preferencesAllowed: () => false } },
      ],
    });
    const svc = TestBed.inject(UpcomingShipsService);
    svc.query.set('');
    svc.feed.set(SEARCH_FEED);
    const fixture = TestBed.createComponent(UpcomingGridComponent);
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    const input = el.querySelector('input.search-input') as HTMLInputElement;
    const type = (value: string) => {
      input.value = value;
      input.dispatchEvent(new Event('input'));
      fixture.detectChanges();
    };
    const cardIds = () =>
      Array.from(el.querySelectorAll('a.card')).map((a) => a.getAttribute('href')!.split('/').pop());
    return { fixture, el, svc, input, type, cardIds };
  }

  it('filters the grid by the typed term', () => {
    const { type, cardIds } = mountReal();
    expect(cardIds().length).toBe(4);
    type('golem');
    expect(cardIds()).toEqual(['b']);
  });

  it('AND-s tokens so more words narrow ("drake conc" is not "drake OR conc")', () => {
    const { type, cardIds } = mountReal();
    type('drake');
    expect(cardIds()).toEqual(['a', 'b']);
    // "conc" alone hits every ship (status in-concept); AND with "drake"
    // must keep only the Drake ships, never widen to the Anvil Concord.
    type('drake conc');
    expect(cardIds()).toEqual(['a', 'b']);
    type('drake golem');
    expect(cardIds()).toEqual(['b']);
    type('anvil concord');
    expect(cardIds()).toEqual(['d']);
  });

  it('ignores case and diacritics in both directions', () => {
    const { type, cardIds } = mountReal();
    type('KUHLSCHRANK');
    expect(cardIds()).toEqual(['c']);
    type('kühl');
    expect(cardIds()).toEqual(['c']);
  });

  it('the clear button appears with a term and restores every ship', () => {
    const { el, type, cardIds, svc, fixture } = mountReal();
    expect(el.querySelector('button.search-clear')).toBeNull();
    type('golem');
    const clear = el.querySelector('button.search-clear') as HTMLButtonElement;
    expect(clear).not.toBeNull();
    clear.click();
    fixture.detectChanges();
    expect(svc.query()).toBe('');
    expect((el.querySelector('input.search-input') as HTMLInputElement).value).toBe('');
    expect(cardIds().length).toBe(4);
    expect(el.querySelector('button.search-clear')).toBeNull();
  });

  it('a term without hits shows the no-matches state, not the empty-feed state', () => {
    const { el, type, cardIds } = mountReal();
    type('zzz-nothing');
    expect(cardIds()).toEqual([]);
    expect(el.textContent).toContain('codex.upcoming.noMatches.title');
    expect(el.textContent).not.toContain('codex.upcoming.empty.title');
  });
});
