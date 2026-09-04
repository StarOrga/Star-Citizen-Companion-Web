import { ComponentFixture, TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';
import { TranslateModule } from '@ngx-translate/core';
import { UpcomingDetailComponent } from './upcoming-detail.component';
import { UpcomingShip, UpcomingShipsService } from './upcoming-ships.service';
import { HangarService } from '../hangar/hangar.service';
import { ConceptShip } from '../hangar/hangar.types';

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

function conceptShip(name: string, id = name): ConceptShip {
  return { id, name, manufacturer: null, rsiUrl: null, notes: null, createdAt: '' };
}

/** Only the surface UpcomingDetailComponent reads off the RSI feed service. */
function rsiStub(ships: UpcomingShip[]) {
  return {
    ensureLoaded: jasmine.createSpy('ensureLoaded').and.resolveTo(undefined),
    shipById: (id: string) => ships.find((s) => s.id === id) ?? null,
  };
}

function hangarStub(concepts: ConceptShip[] = []) {
  const list = signal<ConceptShip[]>(concepts);
  return {
    error: signal<string | null>(null),
    conceptShips: list,
    ensureConceptShipsLoaded: jasmine.createSpy('ensureConceptShipsLoaded').and.resolveTo(undefined),
    conceptShipByName: (name: string | null | undefined) =>
      list().find((c) => c.name === name) ?? null,
    addConceptShip: jasmine
      .createSpy('addConceptShip')
      .and.callFake(async (input: { name: string }) => {
        const created = conceptShip(input.name, 'new-id');
        list.set([created, ...list()]);
        return created;
      }),
    removeConceptShip: jasmine.createSpy('removeConceptShip').and.callFake(async (id: string) => {
      list.set(list().filter((c) => c.id !== id));
      return true;
    }),
  };
}

describe('UpcomingDetailComponent', () => {
  async function setup(
    id: string,
    ships: UpcomingShip[],
    hangar: ReturnType<typeof hangarStub> = hangarStub(),
  ): Promise<{ fixture: ComponentFixture<UpcomingDetailComponent>; hangar: typeof hangar }> {
    TestBed.configureTestingModule({
      imports: [UpcomingDetailComponent, TranslateModule.forRoot()],
      providers: [
        provideRouter([]),
        { provide: UpcomingShipsService, useValue: rsiStub(ships) },
        { provide: HangarService, useValue: hangar },
        { provide: ActivatedRoute, useValue: { snapshot: { paramMap: convertToParamMap({ id }) } } },
      ],
    });
    const fixture = TestBed.createComponent(UpcomingDetailComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    return { fixture, hangar };
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

  it('adds the hull to the fleet wishlist on the watch toggle, and removes it again', async () => {
    const { fixture, hangar } = await setup('polaris', [
      upcomingShip({ id: 'polaris', name: 'RSI Polaris' }),
    ]);
    const el: HTMLElement = fixture.nativeElement;
    const btn = el.querySelector<HTMLButtonElement>('button.watch')!;

    expect(btn.getAttribute('aria-pressed')).toBe('false');
    btn.click();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(hangar.addConceptShip).toHaveBeenCalledWith({
      name: 'RSI Polaris',
      manufacturer: 'Roberts Space Industries',
      rsiUrl: 'https://robertsspaceindustries.com/en/pledge/ships/polaris/Polaris',
    });
    expect(el.querySelector<HTMLButtonElement>('button.watch')!.getAttribute('aria-pressed')).toBe('true');

    el.querySelector<HTMLButtonElement>('button.watch')!.click();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(hangar.removeConceptShip).toHaveBeenCalledWith('new-id');
    expect(el.querySelector<HTMLButtonElement>('button.watch')!.getAttribute('aria-pressed')).toBe('false');
  });

  it('starts in the watched state when the hull is already on the wishlist', async () => {
    const { fixture } = await setup(
      'polaris',
      [upcomingShip({ id: 'polaris', name: 'RSI Polaris' })],
      hangarStub([conceptShip('RSI Polaris')]),
    );
    const el: HTMLElement = fixture.nativeElement;
    expect(el.querySelector<HTMLButtonElement>('button.watch')!.getAttribute('aria-pressed')).toBe('true');
    // Watched hulls get their route into the hangar, where the strip lives.
    expect(el.querySelector<HTMLAnchorElement>('.hangar-link')?.getAttribute('href')).toBe('/hangar');
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
