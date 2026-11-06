import { ComponentFixture, TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';
import { provideTranslateService } from '@ngx-translate/core';
import { UpcomingDetailComponent } from './upcoming-detail.component';
import { UpcomingShip, UpcomingShipsService } from './upcoming-ships.service';
import { ItemPathService } from '../hq/data/item-path.service';
import { fakeItemPath } from '../shared/item-path/item-path.testing';

function upcomingShip(over: Partial<UpcomingShip> & { id: string; name: string }): UpcomingShip {
  return {
    manufacturer: 'Roberts Space Industries',
    manufacturerCode: 'RSI',
    productionStatus: 'in-concept',
    type: 'multi',
    focus: 'Corvette',
    rsiUrl: 'https://robertsspaceindustries.com/en/pledge/ships/polaris/Polaris',
    thumbnail: null,
    flightReadyButMissing: false,
    ...over,
  };
}

/** Only the surface UpcomingDetailComponent reads off the RSI feed service. */
function rsiStub(ships: UpcomingShip[], error: string | null = null) {
  const feed = signal<{ ships: UpcomingShip[] } | null>(error ? null : { ships });
  const err = signal<string | null>(error);
  return {
    feed,
    error: err,
    ensureLoaded: jasmine.createSpy('ensureLoaded').and.resolveTo(undefined),
    refresh: jasmine.createSpy('refresh').and.callFake(async () => {
      err.set(null);
      feed.set({ ships });
    }),
    shipById: (id: string) => (feed()?.ships ?? []).find((s) => s.id === id) ?? null,
  };
}

describe('UpcomingDetailComponent', () => {
  async function setup(
    id: string,
    ships: UpcomingShip[],
    feedError: string | null = null,
  ): Promise<{ fixture: ComponentFixture<UpcomingDetailComponent> }> {
    TestBed.configureTestingModule({
      imports: [UpcomingDetailComponent],
      providers: [
        provideTranslateService(),
        provideRouter([]),
        { provide: UpcomingShipsService, useValue: rsiStub(ships, feedError) },
        { provide: ItemPathService, useValue: fakeItemPath() },
        { provide: ActivatedRoute, useValue: { snapshot: { paramMap: convertToParamMap({ id }) } } },
      ],
    });
    const fixture = TestBed.createComponent(UpcomingDetailComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    return { fixture };
  }

  afterEach(() => TestBed.resetTestingModule());

  it('renders the announced ship from OUR codex and keeps RSI as a secondary link', async () => {
    const { fixture } = await setup('polaris', [upcomingShip({ id: 'polaris', name: 'RSI Polaris' })]);
    const el: HTMLElement = fixture.nativeElement;

    expect(el.querySelector('.entity-name')?.textContent?.trim()).toBe('RSI Polaris');
    // #130: the RSI page is still reachable, just no longer the destination the
    // rail throws the user at.
    const rsi = el.querySelector<HTMLAnchorElement>('.actions a');
    expect(rsi?.getAttribute('href')).toBe(
      'https://robertsspaceindustries.com/en/pledge/ships/polaris/Polaris',
    );
    expect(rsi?.getAttribute('target')).toBe('_blank');
    expect(rsi?.getAttribute('rel')).toBe('noopener noreferrer');
  });

  it('waits for the feed before deciding a deep-linked ship does not exist', async () => {
    const { fixture } = await setup('polaris', [upcomingShip({ id: 'polaris', name: 'RSI Polaris' })]);
    expect(TestBed.inject(UpcomingShipsService).ensureLoaded).toHaveBeenCalled();
    expect(fixture.nativeElement.querySelector('.empty')).toBeNull();
  });

  it('renders an honest empty state for an id the matrix no longer lists', async () => {
    const { fixture } = await setup('gone', [upcomingShip({ id: 'polaris', name: 'RSI Polaris' })]);
    const el: HTMLElement = fixture.nativeElement;
    expect(el.querySelector('.entity-name')).toBeNull();
    expect(el.querySelector('.empty')).not.toBeNull();
    expect(el.querySelector<HTMLAnchorElement>('.empty .browse')?.getAttribute('href')).toBe(
      '/codex/upcoming',
    );
  });

  it('shows a failed feed as an error with a retry, never as "not found"', async () => {
    const ships = [upcomingShip({ id: 'polaris', name: 'RSI Polaris' })];
    const { fixture } = await setup('polaris', ships, hangarStub(), 'errors.upcoming.feed');
    const el: HTMLElement = fixture.nativeElement;
    expect(el.querySelector('.empty')).toBeNull();
    const retry = el.querySelector<HTMLButtonElement>('.load-err .retry');
    expect(retry).not.toBeNull();

    retry!.click();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(TestBed.inject(UpcomingShipsService).refresh).toHaveBeenCalled();
    expect(el.querySelector('.load-err')).toBeNull();
    expect(el.querySelector('.entity-name')?.textContent?.trim()).toBe('RSI Polaris');
  });

  it('offers the item path (wish only) instead of the old watch toggle', async () => {
    const { fixture } = await setup('polaris', [upcomingShip({ id: 'polaris', name: 'RSI Polaris' })]);
    const el: HTMLElement = fixture.nativeElement;
    expect(el.querySelector('sc-item-path')).not.toBeNull();
    expect(el.querySelector('button.watch')).toBeNull();
  });

  it('says "in concept" for a hull RSI is still building and "flight-ready" for one we just have not ingested', async () => {
    const conceptFixture = await setup('polaris', [upcomingShip({ id: 'polaris', name: 'RSI Polaris' })]);
    expect(
      conceptFixture.fixture.nativeElement.querySelector('.badge.status')?.classList.contains('concept'),
    ).toBeTrue();

    TestBed.resetTestingModule();
    const readyFixture = await setup('zeus', [
      upcomingShip({
        id: 'zeus',
        name: 'RSI Zeus Mk II',
        productionStatus: 'flight-ready',
        flightReadyButMissing: true,
      }),
    ]);
    expect(
      readyFixture.fixture.nativeElement.querySelector('.badge.status')?.classList.contains('concept'),
    ).toBeFalse();
  });
});
