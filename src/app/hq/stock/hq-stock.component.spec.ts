import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';
import { provideTranslateService } from '@ngx-translate/core';
import { of } from 'rxjs';
import { AuthService } from '../../auth/auth.service';
import { SupabaseClientProvider } from '../../core/supabase.client';
import { HangarService } from '../../hangar/hangar.service';
import { HqInventoryService } from '../data/hq-inventory.service';
import { WishlistStore } from '../data/wishlist.store';
import { HqOwnershipService } from '../hq-ownership.service';
import { HqSuppliesService } from '../hq-supplies.service';
import { NachschubEdgeService } from '../nachschub/nachschub-edge.service';
import { SammlungService } from '../nachschub/sammlung.service';
import { NachschubService } from '../nachschub/nachschub.service';
import { HqLiveService } from '../now/hq-live.service';
import { HqStockComponent } from './hq-stock.component';

describe('HqStockComponent', () => {
  const ago = (hours: number) => new Date(Date.now() - hours * 3_600_000).toISOString();

  interface Opts {
    user?: boolean;
    many?: number;
    params?: Record<string, string>;
    events?: unknown[];
  }

  function mount(opts: Opts = {}) {
    const base = [
      { location: 'Lorville', name: 'Medpen', class_name: 'medpen', qty: 5, unit: 'pcs' },
      { location: 'Cutlass Black', name: 'Medpen', class_name: 'medpen', qty: 2, unit: 'pcs' },
      { location: 'Area18', name: 'P4-AR', class_name: 'ksar_rifle_p4ar', qty: 1, unit: 'pcs' },
      { location: 'Area18', name: 'Gold', class_name: null, qty: 3.5, unit: 'scu' },
      { location: 'Blueprints', name: 'Gallant', class_name: 'gallant_bp', qty: 1, unit: 'pcs' },
    ];
    const many = Array.from({ length: opts.many ?? 0 }, (_, i) => ({ location: `Place ${i % 9}`, name: `Item ${i}`, class_name: `item_${i}`, qty: i + 1, unit: 'pcs' }));
    const inv = {
      loaded: signal(true),
      error: signal<string | null>(null),
      snapshots: signal([]),
      locations: signal([]),
      items: signal([...base, ...many]),
      shipStorage: signal([]),
      load: jasmine.createSpy('load').and.resolveTo(),
      addManual: jasmine.createSpy('addManual').and.resolveTo(true),
    };
    const wish = {
      totalQty: (_k: string, c: string) => (c === 'ksar_rifle_p4ar' ? 2 : 0),
      qtyOf: () => 1,
      setQty: jasmine.createSpy('setQty').and.resolveTo(true),
      ensureLoaded: () => Promise.resolve(),
      error: signal<string | null>(null),
    };
    const ships = [
      { id: 'sh1', shipClassName: 'AEGS_Gladius', customName: 'Pfeil', status: 'owned', pinnedRank: 1, qty: 2, origin: 'pledge' },
      { id: 'sh2', shipClassName: 'MISC_Freelancer', customName: null, status: 'owned', pinnedRank: null, qty: 1, origin: null },
      { id: 'sh3', shipClassName: 'RSI_Zeus', customName: null, status: 'wishlist', pinnedRank: null, qty: 1, origin: null },
    ];
    TestBed.configureTestingModule({
      imports: [HqStockComponent],
      providers: [
        provideRouter([]),
        provideTranslateService({ fallbackLang: 'en' }),
        { provide: ActivatedRoute, useValue: { queryParamMap: of(convertToParamMap(opts.params ?? {})), snapshot: {} } },
        { provide: SupabaseClientProvider, useValue: { client: {} } },
        { provide: AuthService, useValue: { user: signal(opts.user === false ? null : { id: 'u1' }) } },
        { provide: HangarService, useValue: { ships: signal(ships), roleLoadouts: signal([]), isFlagship: (c: string) => c === 'MISC_Freelancer' } },
        { provide: HqOwnershipService, useValue: { configs: signal([]), ensureLoaded: () => Promise.resolve(), configsForShip: () => [] } },
        { provide: HqInventoryService, useValue: inv },
        { provide: WishlistStore, useValue: wish },
        { provide: HqSuppliesService, useValue: { items: signal([]) } },
        { provide: NachschubService, useValue: { packages: signal([]), ensureLoaded: () => Promise.resolve() } },
        { provide: SammlungService, useValue: { blueprints: signal([{ kind: 'blueprint', id: 'gallant_bp', name: 'Gallant' }]), load: () => Promise.resolve() } },
        { provide: NachschubEdgeService, useValue: { resetIngameStock: jasmine.createSpy('reset').and.resolveTo(true), lastError: null } },
        { provide: HqLiveService, useValue: { state: signal(null), events: signal(opts.events ?? []) } },
      ],
    });
    const fixture = TestBed.createComponent(HqStockComponent);
    fixture.detectChanges();
    return { fixture, inv, wish, el: fixture.nativeElement as HTMLElement };
  }

  const click = (f: { detectChanges(): void }, b: Element | null) => {
    (b as HTMLElement).click();
    f.detectChanges();
  };

  it('opens on Inventar: the plus tile first, one tile per thing, the Sammlung place left out', () => {
    const { el } = mount();
    expect(el.querySelector('#hq-stock-title')).toBeTruthy();
    const tiles = [...el.querySelectorAll('.grid .tile')];
    expect(tiles[0].classList).toContain('add');
    // Medpen (two places folded), P4-AR, Gold: three things; the blueprint row is not Inventar.
    expect(tiles.length).toBe(4);
    expect(tiles[1].querySelector('.nm')?.textContent).toBe('Medpen');
    expect(tiles[1].querySelector('.qty')?.textContent).toBe('×7');
    expect(tiles.some((t) => t.textContent?.includes('Gallant'))).toBeFalse();
  });

  it('names the three tabs with their counts', () => {
    const { el } = mount();
    const tabs = [...el.querySelectorAll('.tabs .tab')];
    expect(tabs.map((t) => t.querySelector('small')?.textContent)).toEqual(['3', '2', '1']);
  });

  it('shows a quiet hint on a tile that is already on the wishlist, and Nachholen puts it there counted up', () => {
    const { fixture, wish, el } = mount();
    const p4ar = [...el.querySelectorAll('.grid .tile.item')].find((t) => t.textContent?.includes('P4-AR'))!;
    expect(p4ar.querySelector('.hint span')?.textContent).toContain('hq.bestand.hintWish');
    click(fixture, p4ar.querySelector('.nach'));
    expect(wish.setQty).toHaveBeenCalledWith({ kind: 'item', className: 'ksar_rifle_p4ar', name: 'P4-AR' }, 2);
  });

  it('the plus tile opens the stock popup in add mode', () => {
    const { fixture, el } = mount();
    click(fixture, el.querySelector('.grid .tile.add'));
    expect(el.querySelector('sc-hq-stock-popup')).not.toBeNull();
  });

  it('filters by category chip and by text', () => {
    const { fixture, el } = mount();
    const chips = [...el.querySelectorAll('.chips .chip')];
    // All, Rohstoffe, Waffen (Sonstiges holds Medpen).
    click(fixture, chips.find((c) => c.textContent?.includes('hq.stock.cat.weapons')) ?? null);
    expect(el.querySelectorAll('.grid .tile.item').length).toBe(1);
    click(fixture, chips[0]);
    const input = el.querySelector('.search input') as HTMLInputElement;
    input.value = 'gold';
    input.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    expect(el.querySelectorAll('.grid .tile.item').length).toBe(1);
  });

  it('a deep link carries the filter and brings the focused item on screen', () => {
    const { el } = mount({ params: { bestand: 'inventar', cat: 'weapons', focus: 'KSAR_rifle_p4ar' } });
    expect(el.querySelector('.chips .chip[aria-pressed="true"]')?.textContent).toContain('hq.stock.cat.weapons');
    expect(el.querySelector('.grid .tile.focus')?.textContent).toContain('P4-AR');
  });

  it('lists what was used up in the last 48 hours as a summary with a Nachholen action', () => {
    const events = [
      {
        type: 'inventory.snapshot',
        at: ago(5),
        undone: false,
        applied: { kind: 'snapshot', replaced: true, previous: { snapshot: { location: 'Lorville', source: 'ocr', taken_at: ago(60) }, items: [{ name: 'Medpen', class_name: 'medpen', qty: 8, unit: 'pcs' }] } },
      },
    ];
    const { fixture, wish, el } = mount({ events });
    expect(el.querySelector('.used .u-t')?.textContent).toContain('Medpen');
    click(fixture, el.querySelector('.used'));
    click(fixture, el.querySelector('.used-pop li button'));
    expect(wish.setQty).toHaveBeenCalled();
  });

  it('pages a long list instead of growing the page', () => {
    const { fixture, el } = mount({ many: 60 });
    fixture.componentInstance.capacity.set(8);
    fixture.detectChanges();
    const pg = el.querySelector('.pager .pg');
    expect(pg).not.toBeNull();
    const next = el.querySelector('.pager button:last-child') as HTMLButtonElement;
    expect(next.disabled).toBeFalse();
    const first = el.querySelectorAll('.grid .tile').length;
    click(fixture, next);
    expect(el.querySelectorAll('.grid .tile').length).toBeGreaterThan(0);
    expect(first).toBe(8);
  });

  it('Sammlung: the plus tile first, the collected blueprints as anchors, Ruf as an honest empty state', () => {
    const { fixture, el } = mount();
    click(fixture, el.querySelectorAll('.tabs .tab')[2]);
    const tiles = [...el.querySelectorAll('.grid .tile')];
    expect(tiles[0].classList).toContain('add');
    expect(tiles[1].tagName).toBe('A');
    expect(tiles[1].getAttribute('href')).toContain('/codex/blueprint/gallant_bp');
    expect(el.querySelector('[data-ruf] .empty')).not.toBeNull();
  });

  it('Hangar: owned ships only, as anchors to their page, with copies and origin', () => {
    const { fixture, el } = mount();
    click(fixture, el.querySelectorAll('.tabs .tab')[1]);
    const ships = [...el.querySelectorAll('.grid a.tile')];
    expect(ships.length).toBe(2);
    expect(ships.every((s) => s.getAttribute('href')?.includes('/codex/ship/'))).toBeTrue();
    expect(ships[0].textContent).toContain('hq.bestand.origin.pledge');
  });

  it('a load failure shows a translated error with retry, never an empty page', () => {
    const { fixture, inv, el } = mount();
    inv.loaded.set(false);
    inv.error.set('errors.generic');
    fixture.detectChanges();
    expect(el.querySelector('.state[role="alert"]')).not.toBeNull();
    click(fixture, el.querySelector('.state button'));
    expect(inv.load).toHaveBeenCalled();
  });

  it('"Ingame-Bestand zurücksetzen" sits in the page menu, marked as danger', () => {
    const { fixture, el } = mount();
    click(fixture, el.querySelector('.menu-wrap button'));
    expect(el.querySelector('.menu button.danger')).not.toBeNull();
  });
});
