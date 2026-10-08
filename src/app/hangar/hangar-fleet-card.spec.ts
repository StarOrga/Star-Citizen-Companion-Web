import { provideNoShipBlueprints } from '../codex/ship-blueprint/ship-blueprint.testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { provideLocationMocks } from '@angular/common/testing';
import { signal } from '@angular/core';
import { provideTranslateService } from '@ngx-translate/core';
import { AuthService } from '../auth/auth.service';
import { AnalyticsService } from '../core/analytics.service';
import { CodexListRow, CodexService } from '../codex/codex.service';
import { UpcomingShipsService } from '../codex/upcoming-ships.service';
import { LoadoutShareService } from '../social/loadout-share.service';
import { fakeSupabase } from '../testing/fake-supabase';
import { HangarDashboardComponent } from './hangar-dashboard.component';

// The fleet cards of the hangar (polish pass 2026-10-08): every card has a
// picture slot (RSI art first, the ship glyph when there is none — never a
// missing box), a readable name, a link into the ship's Codex page, and the
// flagship toggle as a sibling of the card link, not inside it.
describe('HangarDashboardComponent fleet cards', () => {
  const ship = (id: string, cls: string, custom: string | null = null) => ({
    id,
    user_id: 'u1',
    ship_class_name: cls,
    custom_name: custom,
    status: 'owned',
    pinned_rank: null,
    selected_skin_id: null,
    notes: null,
    created_at: '2026-01-01T00:00:00+00:00',
    updated_at: '2026-01-01T00:00:00+00:00',
  });

  async function setup() {
    const fake = fakeSupabase({
      answer: (call) => {
        if (call.target === 'hangar_ships') {
          return { data: [ship('s1', 'AEGS_Gladius'), ship('s2', 'AEGS_Avenger_Titan', 'Rusty Bucket'), ship('s3', 'XNAA_Unknown_Hull')] };
        }
        if (call.target === 'profiles') return { data: { flagship_ship_class: null } };
        return { data: [] };
      },
    });
    const card = (cls: string, name: string) =>
      ({ classNameSlug: cls, nameLocalized: name, manufacturerCode: 'AEGS', crewSize: 1, payload: {} }) as unknown as CodexListRow;
    const artFor = jasmine.createSpy('artFor').and.callFake((name: string) =>
      name === 'Aegis Gladius' ? ['https://media.example.test/gladius/store_small.jpg'] : [],
    );
    TestBed.configureTestingModule({
      imports: [HangarDashboardComponent],
      providers: [
        provideNoShipBlueprints(),
        provideRouter([]),
        provideLocationMocks(),
        provideTranslateService({ fallbackLang: 'en' }),
        fake.provider,
        { provide: AuthService, useValue: { user: signal({ id: 'u1' }) } as unknown as AuthService },
        { provide: AnalyticsService, useValue: { capture: jasmine.createSpy('capture') } },
        {
          provide: CodexService,
          useValue: {
            loadCurrentBuild: () => Promise.resolve(),
            getShipsByClassNames: () =>
              Promise.resolve(
                new Map([
                  ['AEGS_Gladius', card('AEGS_Gladius', 'Aegis Gladius')],
                  ['AEGS_Avenger_Titan', card('AEGS_Avenger_Titan', 'Aegis Avenger Titan')],
                ]),
              ),
            listByKind: () => Promise.resolve({ rows: [], total: 0 }),
            previewUrl: () => null,
          },
        },
        { provide: UpcomingShipsService, useValue: { ensureLoaded: () => Promise.resolve(), shipByName: () => null, artFor } },
        { provide: LoadoutShareService, useValue: { listSharedWithMe: () => Promise.resolve([]) } },
      ],
    });
    const fixture = TestBed.createComponent(HangarDashboardComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    return { el: fixture.nativeElement as HTMLElement, artFor };
  }

  afterEach(() => localStorage.clear());

  it('gives every card a picture slot: RSI art when known, the ship glyph otherwise', async () => {
    const { el, artFor } = await setup();
    const cards = Array.from(el.querySelectorAll('.fleet-card'));
    expect(cards.length).toBe(3);
    expect(cards.every((c) => c.querySelector('.thumb'))).toBeTrue();
    expect(artFor).toHaveBeenCalledWith('Aegis Gladius');
    expect(cards[0].querySelector('img')?.getAttribute('src')).toBe('https://media.example.test/gladius/store_small.jpg');
    expect(cards[2].querySelector('img')).toBeNull();
    expect(cards[2].querySelector('.thumb sc-codex-icon')).not.toBeNull();
  });

  it('titles a card readably and keeps the ship name under a custom name', async () => {
    const { el } = await setup();
    const names = Array.from(el.querySelectorAll('.fleet-card .name')).map((n) => n.textContent?.trim());
    expect(names).toEqual(['Aegis Gladius', 'Rusty Bucket', 'XNAA Unknown Hull']);
    expect(el.querySelectorAll('.fleet-card .card-sub')[0]?.textContent?.trim()).toBe('Aegis Avenger Titan');
    expect(el.querySelector('.fleet-card code')).toBeNull();
  });

  it('links each card into the hangar entry and into the ship\'s Codex page, with no button inside a link', async () => {
    const { el } = await setup();
    const first = el.querySelector('.fleet-card')!;
    expect(first.querySelector('a.fleet-link')?.getAttribute('href')).toBe('/hq/hangar/s1');
    expect(first.querySelector('.fleet-actions a.codex-link')?.getAttribute('href')).toBe('/codex/ship/AEGS_Gladius');
    expect(first.querySelector('a button, a a')).toBeNull();
    expect(first.querySelector('.fleet-actions button.flag-toggle')).not.toBeNull();
  });
});
