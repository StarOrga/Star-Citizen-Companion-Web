import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { signal } from '@angular/core';
import { provideTranslateService } from '@ngx-translate/core';
import { AuthService } from '../../auth/auth.service';
import { SupabaseClientProvider } from '../../core/supabase.client';
import { HangarService } from '../../hangar/hangar.service';
import { HqInventoryService } from '../data/hq-inventory.service';
import { HqOwnershipService } from '../hq-ownership.service';
import { HqStockComponent } from './hq-stock.component';

describe('HqStockComponent', () => {
  const ago = (days: number) => new Date(Date.now() - days * 86_400_000).toISOString();

  function mount(opts: { full: boolean }) {
    const inv = {
      loaded: signal(true),
      error: signal<string | null>(null),
      locations: signal(
        opts.full
          ? [
              {
                snapshot: { location: 'Lorville', taken_at: ago(9), source: 'manual' },
                items: [{ name: 'Gold', qty: 3, unit: 'scu' }],
                materials: [{ name: 'Gold', qty: 3, unit: 'scu' }],
                pieces: [],
              },
            ]
          : [],
      ),
      shipStorage: signal(opts.full ? [{ ship_ref: 'sh1', location: 'Area18', taken_at: ago(1) }] : []),
      load: jasmine.createSpy('load').and.resolveTo(),
      addManual: jasmine.createSpy('addManual').and.resolveTo(true),
    };
    const ships = opts.full
      ? [
          { id: 'sh1', shipClassName: 'AEGS_Gladius', customName: 'Pfeil', status: 'owned', pinnedRank: 1 },
          { id: 'sh2', shipClassName: 'MISC_Freelancer', customName: null, status: 'owned', pinnedRank: null },
        ]
      : [];
    TestBed.configureTestingModule({
      imports: [HqStockComponent],
      providers: [
        provideRouter([]),
        provideTranslateService({ fallbackLang: 'en' }),
        { provide: SupabaseClientProvider, useValue: { client: {} } },
        { provide: AuthService, useValue: { user: signal({ id: 'u1' }) } },
        { provide: HangarService, useValue: { ships: signal(ships), roleLoadouts: signal([]) } },
        { provide: HqOwnershipService, useValue: { configs: signal([]), ensureLoaded: () => Promise.resolve() } },
        { provide: HqInventoryService, useValue: inv },
      ],
    });
    const fixture = TestBed.createComponent(HqStockComponent);
    fixture.detectChanges();
    return { fixture, inv };
  }

  it('renders with empty data and offers the capture form', () => {
    const { fixture } = mount({ full: false });
    const el: HTMLElement = fixture.nativeElement;
    expect(el.querySelector('#hq-stock-title')).toBeTruthy();
    expect(el.querySelector('form.capture')).toBeTruthy();
    expect(el.querySelectorAll('.place').length).toBe(0);
  });

  it('renders favourites as anchors and a stale snapshot in the warning style', () => {
    const { fixture } = mount({ full: true });
    const el: HTMLElement = fixture.nativeElement;
    const fav = el.querySelector('section a[href]') as HTMLAnchorElement;
    expect(fav.getAttribute('href')).toContain('/hq/hangar/sh1');
    expect(el.querySelector('.place .age.stale')).toBeTruthy();
    expect(el.textContent).toContain('Pfeil');
  });
});
