import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { signal } from '@angular/core';
import { provideTranslateService } from '@ngx-translate/core';
import { AuthService } from '../../auth/auth.service';
import { SupabaseClientProvider } from '../../core/supabase.client';
import { HangarService } from '../../hangar/hangar.service';
import { HqInventoryService } from '../data/hq-inventory.service';
import { HqOwnershipService } from '../hq-ownership.service';
import { HqLiveService } from '../now/hq-live.service';
import { CodexService } from '../../codex/codex.service';
import { HqStockComponent } from './hq-stock.component';

describe('HqStockComponent', () => {
  const ago = (days: number) => new Date(Date.now() - days * 86_400_000).toISOString();

  function mount(opts: { full: boolean; hits?: { kind: string; classNameSlug: string; nameLocalized: string }[] }) {
    const inv = {
      loaded: signal(true),
      error: signal<string | null>(null),
      locations: signal(
        opts.full
          ? [
              {
                snapshot: { location: 'Lorville', taken_at: ago(9), source: 'manual' },
                items: [{ name: 'Gold', qty: 3, unit: 'scu' }],
                materials: [{ name: 'Gold', qty: 3, unit: 'scu', class_name: 'item:Gold' }, { name: 'Notiz', qty: 1, unit: 'scu', class_name: null }],
                pieces: [],
              },
            ]
          : [],
      ),
      items: signal(opts.full ? [{ location: 'Lorville', name: 'Gold', qty: 3, unit: 'scu' }, { location: 'Area18', name: 'Gold', qty: 4, unit: 'scu' }] : []),
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
        { provide: CodexService, useValue: { searchAll: () => Promise.resolve({ hits: opts.hits ?? [], totals: {} }) } },
        { provide: HqLiveService, useValue: { state: signal({ location: 'Area18' }) } },
      ],
    });
    const fixture = TestBed.createComponent(HqStockComponent);
    fixture.detectChanges();
    return { fixture, inv };
  }

  it('finds an item, nearest first, and marks the places that make up the amount', () => {
    const { fixture } = mount({ full: true });
    const el: HTMLElement = fixture.nativeElement;
    fixture.componentInstance.term.set('Gold');
    fixture.componentInstance.want.set(5);
    fixture.detectChanges();
    const hits = [...el.querySelectorAll('.hit')];
    expect(hits.map((h) => h.querySelector('.hit-place')?.textContent)).toEqual(['Area18', 'Lorville']);
    expect(hits.every((h) => h.classList.contains('take'))).toBeTrue();
  });

  it('keeps the finder away while the storage is empty', () => {
    const { fixture } = mount({ full: false });
    expect((fixture.nativeElement as HTMLElement).querySelector('.find')).toBeNull();
  });

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

  it('links the earned blueprints straight to the A-Z blueprint index', () => {
    const { fixture } = mount({ full: false });
    const a = (fixture.nativeElement as HTMLElement).querySelector('#hq-stock-earned ~ a.more') as HTMLAnchorElement;
    expect(a.getAttribute('href')).toBe('/codex/index?kind=blueprint');
  });

  async function type(fixture: ReturnType<typeof mount>['fixture'], text: string) {
    await fixture.whenStable();
    const input = (fixture.nativeElement as HTMLElement).querySelector('#hq-stock-item') as HTMLInputElement;
    input.value = text;
    input.dispatchEvent(new Event('input'));
    await new Promise((r) => setTimeout(r, 300));
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  }

  it('says it does not exist and keeps Add disabled for text without a Codex match', async () => {
    const { fixture } = mount({ full: false });
    const el: HTMLElement = fixture.nativeElement;
    fixture.componentInstance.location = 'Area18';
    await type(fixture, 'q34tqaergv');
    expect(el.querySelector('#hq-stock-item-msg')?.textContent).toContain('hq.stock.capture.unknown');
    expect((el.querySelector('form.capture button[type=submit]') as HTMLButtonElement).disabled).toBeTrue();
  });

  it('saves a picked suggestion with its kind and class name', async () => {
    const { fixture, inv } = mount({ full: false, hits: [{ kind: 'ship', classNameSlug: 'AEGS_Idris_P', nameLocalized: 'Idris-P' }] });
    const c = fixture.componentInstance;
    c.location = 'Area18';
    await type(fixture, 'Idr');
    const opt = (fixture.nativeElement as HTMLElement).querySelector('[role=option]') as HTMLElement;
    expect(opt.textContent).toContain('Idris-P');
    c.pick(c.suggestions()[0]);
    fixture.detectChanges();
    expect(c.valid()).toBeTrue();
    await c.add();
    expect(inv.addManual).toHaveBeenCalledWith('Area18', 'Idris-P', 1, 'pcs', 'ship:AEGS_Idris_P');
  });

  it('renders an entry with a target as an anchor and one without as plain text', () => {
    const { fixture } = mount({ full: true });
    const items = [...(fixture.nativeElement as HTMLElement).querySelectorAll('.place .items li')];
    expect(items[0].querySelector('a.entry')?.getAttribute('href')).toBe('/codex/item/Gold');
    expect(items[1].querySelector('a')).toBeNull();
  });
});
