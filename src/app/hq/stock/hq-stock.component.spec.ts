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
import { HqStockComponent } from './hq-stock.component';

describe('HqStockComponent', () => {
  const ago = (days: number) => new Date(Date.now() - days * 86_400_000).toISOString();

  function mount(opts: { full: boolean; many?: number; user?: boolean }) {
    const base = opts.full
      ? [
          { location: 'Lorville', name: 'Gold', class_name: null, qty: 3, unit: 'scu' },
          { location: 'Area18', name: 'Gold', class_name: null, qty: 4, unit: 'scu' },
          { location: 'Area18', name: 'Helm', class_name: 'ARGO_Helmet_01', qty: 1, unit: 'pcs' },
        ]
      : [];
    const many = Array.from({ length: opts.many ?? 0 }, (_, i) => ({
      location: `Place ${i % 40}`, name: `Item ${i}`, class_name: null, qty: i + 1, unit: 'pcs',
    }));
    const snaps = opts.full
      ? [
          { location: 'Lorville', taken_at: ago(9), source: 'manual' },
          { location: 'Area18', taken_at: ago(1), source: 'manual' },
        ]
      : [];
    const inv = {
      loaded: signal(true),
      error: signal<string | null>(null),
      snapshots: signal([...snaps, ...Array.from({ length: Math.min(40, opts.many ?? 0) }, (_, i) => ({ location: `Place ${i}`, taken_at: ago(1), source: 'manual' }))]),
      locations: signal([]),
      items: signal([...base, ...many]),
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
        { provide: AuthService, useValue: { user: signal(opts.user === false ? null : { id: 'u1' }) } },
        { provide: HangarService, useValue: { ships: signal(ships), roleLoadouts: signal([]) } },
        { provide: HqOwnershipService, useValue: { configs: signal([]), ensureLoaded: () => Promise.resolve() } },
        { provide: HqInventoryService, useValue: inv },
        { provide: HqLiveService, useValue: { state: signal({ location: 'Area18' }) } },
      ],
    });
    const fixture = TestBed.createComponent(HqStockComponent);
    fixture.detectChanges();
    return { fixture, inv, el: fixture.nativeElement as HTMLElement };
  }

  const click = (f: { detectChanges(): void }, b: Element) => {
    (b as HTMLElement).click();
    f.detectChanges();
  };

  it('shows the overview as real controls and anchors, with the stale place named', () => {
    const { el } = mount({ full: true });
    expect(el.querySelector('#hq-stock-title')).toBeTruthy();
    expect(el.querySelectorAll('.num').length).toBe(2);
    expect(el.querySelector('.totals .num b')?.textContent).toBe('3');
    expect(el.querySelector('.chip.warn')?.textContent).toContain('Lorville');
    const fav = el.querySelector('section a[href]') as HTMLAnchorElement;
    expect(fav.getAttribute('href')).toContain('/hq/hangar/sh1');
    expect(el.querySelectorAll('.card button').length).toBeGreaterThan(4);
    expect(el.querySelector('.card div[role=button], .card [tabindex="0"]')).toBeNull();
  });

  it('opens the popup prefiltered from a quick link (place, category) and from the totals', () => {
    const { fixture, el } = mount({ full: true });
    click(fixture, [...el.querySelectorAll('.chip')].find((c) => c.textContent?.includes('Lorville'))!);
    expect(el.querySelector('sc-hq-stock-popup')).toBeTruthy();
    expect(fixture.componentInstance.popup()).toEqual({ mode: 'browse', filter: { place: 'Lorville' } });
    const rows = [...el.querySelectorAll('.list > ul .row')];
    expect(rows.length).toBe(1);
    expect(rows[0].textContent).toContain('Gold');
    fixture.componentInstance.popup.set(null);
    fixture.detectChanges();
    click(fixture, el.querySelector('.totals .num')!);
    expect(el.querySelectorAll('.list > ul .row').length).toBe(3);
  });

  it('opens "Hinzufügen" straight in the capture form, and "Wo liegt" in the finder', () => {
    const { fixture, el } = mount({ full: true });
    click(fixture, el.querySelector('.actions .sc-btn-primary')!);
    expect(el.querySelector('form.capture')).toBeTruthy();
    fixture.componentInstance.popup.set(null);
    fixture.detectChanges();
    click(fixture, el.querySelectorAll('.actions .sc-btn')[1]);
    expect(el.querySelector('#hq-stock-find')).toBeTruthy();
  });

  it('finds an item, nearest first, and marks the places that make up the amount (in the popup)', () => {
    const { fixture, el } = mount({ full: true });
    click(fixture, el.querySelectorAll('.actions .sc-btn')[1]);
    const input = el.querySelector('input[name=find-term]') as HTMLInputElement;
    input.value = 'Gold';
    input.dispatchEvent(new Event('input'));
    const want = el.querySelector('input[name=find-want]') as HTMLInputElement;
    want.value = '5';
    want.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    const hits = [...el.querySelectorAll('.hit')];
    expect(hits.map((h) => h.querySelector('.hit-place')?.textContent)).toEqual(['Area18', 'Lorville']);
    expect(hits.every((h) => h.classList.contains('take'))).toBeTrue();
  });

  it('adds through the popup form', async () => {
    const { fixture, el, inv } = mount({ full: true });
    click(fixture, el.querySelector('.actions .sc-btn-primary')!);
    await fixture.whenStable();
    fixture.detectChanges();
    const set = (n: string, v: string) => {
      const i = el.querySelector(`input[name=${n}]`) as HTMLInputElement;
      i.value = v;
      i.dispatchEvent(new Event('input'));
    };
    set('item', 'Quantanium');
    set('location', 'Area 18');
    fixture.detectChanges();
    await fixture.whenStable();
    (el.querySelector('form.capture') as HTMLFormElement).dispatchEvent(new Event('submit'));
    await fixture.whenStable();
    expect(inv.addManual).toHaveBeenCalledWith('Area 18', 'Quantanium', 1, 'pcs');
  });

  it('renders list rows lazily: a window first, more after scrolling inside the popup', () => {
    const { fixture, el } = mount({ full: true, many: 500 });
    click(fixture, el.querySelector('.actions .sc-btn')!);
    const first = el.querySelectorAll('.list > ul li').length;
    expect(first).toBeLessThanOrEqual(60);
    expect(first).toBeGreaterThan(10);
    const list = el.querySelector('.list') as HTMLElement;
    list.scrollTop = list.scrollHeight;
    list.dispatchEvent(new Event('scroll'));
    fixture.detectChanges();
    expect(el.querySelectorAll('.list > ul li').length).toBeGreaterThan(first);
  });

  it('switches the view: by item lists every place beneath, by amount is flat and largest first', () => {
    const { fixture, el } = mount({ full: true });
    click(fixture, el.querySelector('.actions .sc-btn')!);
    const seg = [...el.querySelectorAll('.bar sc-segmented button')];
    click(fixture, seg[1]);
    const heads = [...el.querySelectorAll('.list .head strong')].map((e) => e.textContent?.trim());
    expect(heads).toContain('Gold');
    click(fixture, seg[2]);
    expect(el.querySelectorAll('.list .head').length).toBe(0);
    expect(el.querySelector('.list .row .qty')?.textContent).toContain('4');
  });

  it('keeps the ship storage: quick link opens the popup on that group, with the ship as a real anchor', () => {
    const { fixture, el } = mount({ full: true });
    click(fixture, [...el.querySelectorAll('.card .chip')].find((c) => c.textContent?.includes('lager.storage'))!);
    expect(fixture.componentInstance.popup()).toEqual({ mode: 'browse', filter: { ships: true } });
    expect(el.querySelectorAll('.list .row').length).toBe(1);
    const a = el.querySelector('.ships a') as HTMLAnchorElement;
    expect(a.getAttribute('href')).toContain('/hq/hangar/sh1');
    expect(el.querySelector('.ships')?.textContent).toContain('Area18');
  });

  it('keeps the signed-out text, the empty state, and a translated error with retry', () => {
    const out = mount({ full: false, user: false });
    expect(out.el.querySelector('[role=status]')).toBeTruthy();
    TestBed.resetTestingModule();
    const empty = mount({ full: false });
    expect(empty.el.querySelector('.intro')).toBeTruthy();
    TestBed.resetTestingModule();
    const bad = mount({ full: true });
    bad.inv.loaded.set(false);
    bad.inv.error.set('errors.generic');
    bad.fixture.detectChanges();
    const retry = bad.el.querySelector('[role=alert] button') as HTMLButtonElement;
    retry.click();
    expect(bad.inv.load).toHaveBeenCalled();
  });

  it('does not grow past the viewport page: measured height of the overview with realistic data', () => {
    const { fixture, el } = mount({ full: true, many: 300 });
    fixture.detectChanges();
    const host = el;
    document.body.appendChild(host);
    const h = host.getBoundingClientRect().height;
    // Karma renders at ~749 px wide (phone branch). The stock page's section keeps min-height 100svh with
    // 64px bar + 24px padding above; the content must leave that room.
    const room = window.innerHeight - 64 - 24 - 32;
    // eslint-disable-next-line no-console
    (window as unknown as { __stockH?: number[] }).__stockH = [h, room, window.innerWidth, window.innerHeight];
    expect(h).toBeLessThanOrEqual(room);
    host.remove();
  });
});
