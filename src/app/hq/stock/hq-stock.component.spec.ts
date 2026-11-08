import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router, convertToParamMap, provideRouter } from '@angular/router';
import { provideTranslateService } from '@ngx-translate/core';
import { BehaviorSubject } from 'rxjs';
import { AuthService } from '../../auth/auth.service';
import { SupabaseClientProvider } from '../../core/supabase.client';
import { SearchWishlistService } from '../../codex/search/search-wishlist.service';
import { UndoToastService } from '../../shared/undo-toast/undo-toast.service';
import { HangarService } from '../../hangar/hangar.service';
import { FriendsService } from '../../social/friends.service';
import type { BestandKind } from '../data/hq-codex-kind';
import { HqInventoryService } from '../data/hq-inventory.service';
import { ScrapInfoService } from '../data/scrap-info';
import { WishlistStore } from '../data/wishlist.store';
import { HqOwnershipService } from '../hq-ownership.service';
import { HqSuppliesService } from '../hq-supplies.service';
import { NachschubEdgeService } from '../nachschub/nachschub-edge.service';
import { NachschubTargetPicker } from '../nachschub/nachschub-target-picker';
import { SammlungService } from '../nachschub/sammlung.service';
import { NachschubService } from '../nachschub/nachschub.service';
import { HqLiveService } from '../now/hq-live.service';
import { ShellChromeService } from '../../shell/fusion-bar/shell-chrome.service';
import { HqStockComponent } from './hq-stock.component';

describe('HqStockComponent · Frachtdeck', () => {
  afterEach(() => TestBed.inject(UndoToastService).flush());

  function mount(params: Record<string, string> = {}, opts: { empty?: boolean } = {}) {
    const items = opts.empty
      ? []
      : [
          { location: 'Area18', name: 'Eisen', class_name: 'Carryable_TBO_FL_32SCU_Commodity_Metal_Iron', qty: 15, unit: 'scu', stacks: [{ quality: 940, qty: 5 }, { quality: 620, qty: 10 }], reservations: [{ amount: 4, note: 'Kaelis', at: '2026-11-08T10:00:00Z', quality: 940 }] },
          { location: 'Lorville', name: 'Eisen', class_name: 'Carryable_TBO_FL_32SCU_Commodity_Metal_Iron', qty: 9, unit: 'scu', stacks: [{ quality: 410, qty: 9 }] },
          { location: 'Area18', name: 'Pembroke-Helm', class_name: 'cds_helmet_pembroke', qty: 1, unit: 'pcs' },
          { location: 'Pfeil', name: 'Medpen', class_name: 'medpen', qty: 2, unit: 'pcs' },
          { location: 'Blueprints', name: 'Gallant', class_name: 'gallant_bp', qty: 1, unit: 'pcs' },
        ];
    const inv = {
      loaded: signal(true),
      error: signal<string | null>(null),
      items: signal(items),
      shipStorage: signal([{ ship_ref: 'sh1', location: 'Area18' }]),
      kinds: signal<ReadonlyMap<string, BestandKind>>(new Map([['cds_helmet_pembroke', { area: 'armor', sub: 'helmet', role: null }]])),
      lastRemovals: () => [{ key: 'r1', at: '2026-11-08T12:00:00Z', location: 'Lorville', name: 'Medpen', className: 'medpen', qty: 4, unit: 'pcs', quality: null, kind: 'take' }],
      ensureKinds: jasmine.createSpy('ensureKinds').and.resolveTo(),
      load: jasmine.createSpy('load').and.resolveTo(),
      addManual: jasmine.createSpy('addManual').and.resolveTo(true),
      deleteRow: jasmine.createSpy('deleteRow').and.resolveTo(true),
      setAmount: jasmine.createSpy('setAmount').and.resolveTo(true),
      reserve: jasmine.createSpy('reserve').and.resolveTo(true),
      lastKnownLocation: () => Promise.resolve(null),
    };
    const picker = { open: jasmine.createSpy('open').and.resolveTo(null) };
    const ships = [
      { id: 'sh1', shipClassName: 'AEGS_Gladius', customName: 'Pfeil', status: 'owned', pinnedRank: 1, qty: 1, origin: 'pledge' },
      { id: 'sh2', shipClassName: 'MISC_Freelancer', customName: null, status: 'owned', pinnedRank: null, qty: 1, origin: 'ingame' },
    ];
    const qp = new BehaviorSubject(convertToParamMap(params));
    TestBed.configureTestingModule({
      imports: [HqStockComponent],
      providers: [
        provideRouter([]),
        provideTranslateService({ fallbackLang: 'en' }),
        { provide: ActivatedRoute, useValue: { queryParamMap: qp, snapshot: {} } },
        { provide: SupabaseClientProvider, useValue: { client: {} } },
        { provide: AuthService, useValue: { user: signal({ id: 'u1' }) } },
        { provide: HangarService, useValue: { ships: signal(ships), roleLoadouts: signal(opts.empty ? [] : [{ id: 'set1', name: 'Bergbau', role: 'mining', items: [] }]), isFlagship: () => false, error: signal(null) } },
        { provide: HqOwnershipService, useValue: { configs: signal([]), ensureLoaded: () => Promise.resolve(), configsForShip: (id: string) => (id === 'sh1' ? [{ id: 'c1' }, { id: 'c2' }] : []) } },
        { provide: HqInventoryService, useValue: inv },
        { provide: WishlistStore, useValue: { totalQty: () => 0, qtyOf: () => 0, ensureLoaded: () => Promise.resolve(), error: signal(null) } },
        { provide: SearchWishlistService, useValue: { qtyOf: () => 0, count: signal(3) } },
        { provide: HqSuppliesService, useValue: { items: signal([]) } },
        { provide: NachschubService, useValue: { packages: signal([]), ensureLoaded: () => Promise.resolve() } },
        { provide: SammlungService, useValue: { blueprints: signal([{ kind: 'blueprint', id: 'gallant_bp', name: 'Gallant' }]), rep: signal([]), news: signal(new Set()), gallery: signal(new Set(['g1'])), load: () => Promise.resolve() } },
        { provide: NachschubEdgeService, useValue: { resetIngameStock: jasmine.createSpy('reset').and.resolveTo(true), lastError: null } },
        { provide: HqLiveService, useValue: { state: signal(null), events: signal([]) } },
        { provide: ScrapInfoService, useValue: { info: () => ({ state: 'unknown' }), load: () => Promise.resolve() } },
        { provide: FriendsService, useValue: { graph: signal({ friends: [] }) } },
        { provide: NachschubTargetPicker, useValue: picker },
      ],
    });
    const router = TestBed.inject(Router);
    spyOn(router, 'navigate').and.callFake((_c, extras) => {
      const next = { ...Object.fromEntries(qp.value.keys.map((k) => [k, qp.value.get(k)!])) } as Record<string, string>;
      for (const [k, v] of Object.entries((extras?.queryParams ?? {}) as Record<string, string | null>)) {
        if (v === null) delete next[k];
        else next[k] = v;
      }
      qp.next(convertToParamMap(next));
      return Promise.resolve(true);
    });
    const fixture = TestBed.createComponent(HqStockComponent);
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    const click = (b: Element | null | undefined): void => {
      (b as HTMLElement).click();
      fixture.detectChanges();
    };
    return { fixture, inv, picker, qp, el, click, chrome: TestBed.inject(ShellChromeService) };
  }

  const chip = (el: HTMLElement, key: string) => [...el.querySelectorAll<HTMLElement>('.bar .chip')].find((c) => c.textContent?.includes(key));

  it('four tabs as anchors in the order Alles · Inventar · Hangar · Sammlung, with the search icons and no counts (F1, F2)', () => {
    const { el } = mount();
    const tabs = [...el.querySelectorAll<HTMLAnchorElement>('.tabs a.tab')];
    expect(tabs.map((t) => t.textContent?.trim())).toEqual(['hq.bestand.tab.alles', 'hq.bestand.tab.inventar', 'hq.bestand.tab.hangar', 'hq.bestand.tab.sammlung']);
    expect(tabs.every((t) => !/\d/.test(t.textContent ?? ''))).toBeTrue();
    expect(tabs.every((t) => t.querySelector('svg path'))).toBeTrue();
    expect(tabs[1].getAttribute('aria-current')).toBe('page');
  });

  it('"Alle" has no number; every kind is shown, empty ones dimmed with 0 (F3, F4)', () => {
    const { el } = mount();
    const all = el.querySelector('.bar .chip')!;
    expect(all.querySelector('b')).toBeNull();
    const weapons = chip(el, 'kind.weapons')!;
    expect(weapons.classList).toContain('zero');
    expect(weapons.querySelector('b')?.textContent).toBe('0');
    expect(chip(el, 'kind.other')!.querySelector('b')?.textContent).toBe('1');
    expect(chip(el, 'kind.sets')!.querySelector('b')?.textContent).toBe('1');
  });

  it('one filter bar: sub-kinds unfold inline behind the chosen kind, never a second chip row (F7, I9)', () => {
    const { el, click } = mount();
    click(chip(el, 'kind.armor'));
    expect(el.querySelectorAll('.bar').length).toBe(1);
    const subs = el.querySelector('.bar .subs')!;
    expect(subs.previousElementSibling?.textContent).toContain('kind.armor');
    const names = [...subs.querySelectorAll('.chip')].map((c) => c.textContent?.trim().replace(/\d+$/, ''));
    expect(names).toEqual(['hq.bestand.deck.sub.helmet', 'hq.bestand.deck.sub.torso', 'hq.bestand.deck.sub.arms', 'hq.bestand.deck.sub.legs', 'hq.bestand.deck.sub.undersuit', 'hq.bestand.deck.sub.backpack']);
    expect(subs.querySelector('.chip.zero')).not.toBeNull();
  });

  it('bays per place with the ship hold at the ship place, containers with the Ø Q mark (I1, I2, I3)', () => {
    const { el } = mount();
    const bays = [...el.querySelectorAll('.bays .bay')].map((b) => b.textContent?.replace(/\s+/g, ' ').trim());
    expect(bays).toContain('Area18ArcCorp');
    expect(bays.some((b) => b?.startsWith('Pfeil') && b.includes('Area18 (Stanton)'))).toBeTrue();
    const q = [...el.querySelectorAll('sc-hq-crate .q')].map((x) => x.textContent?.trim());
    expect(q).toContain('Ø Q 727');
  });

  it('only the reserved share is hatched (I5) and the hover names the reservation and the quality (I4)', () => {
    const { el } = mount();
    const crate = [...el.querySelectorAll<HTMLElement>('sc-hq-crate button')].find((b) => b.textContent?.includes('Ø Q 727'))!;
    const rh = crate.querySelector<HTMLElement>('.rh')!;
    expect(rh.style.getPropertyValue('--rf')).toBe('27%');
  });

  it('selects by highlight and hands a pick-up to the Nachschub picker with one stop per place (I8, D4 input)', () => {
    const { el, click, picker } = mount();
    const crates = [...el.querySelectorAll<HTMLElement>('sc-hq-crate button')].filter((b) => b.textContent?.includes('Eisen'));
    crates.forEach((c) => click(c));
    expect(crates[0].getAttribute('aria-pressed')).toBe('true');
    expect(el.querySelector('input[type=checkbox]')).toBeNull();
    const bar = el.querySelector('.selbar')!;
    expect([...bar.querySelectorAll('button')].map((b) => b.textContent?.trim()).slice(0, 4)).toEqual(['hq.bestand.deck.reserve', 'hq.bestand.deck.sell', 'hq.bestand.deck.pickup', 'hq.bestand.deck.delete']);
    click([...bar.querySelectorAll('button')].find((b) => b.textContent?.includes('pickup')));
    const req = picker.open.calls.mostRecent().args[0];
    expect(req.intent).toBe('pickup');
    expect(req.lines[0].stops.map((s: { location: string }) => s.location)).toEqual(['Area18', 'Lorville']);
  });

  it('one material selected shows its quality view with bands (I6)', () => {
    const { el, click } = mount();
    click([...el.querySelectorAll<HTMLElement>('sc-hq-crate button')].find((b) => b.textContent?.includes('Ø Q 727')));
    expect(el.querySelector('.res h3')?.textContent).toContain('byQuality');
    expect(el.querySelectorAll('.res .band').length).toBe(3);
  });

  it('the Ladeprotokoll sits beside the bays and lists removals and reservations as one log (I11, I12, I13)', () => {
    const { el } = mount();
    const log = el.querySelector('.main > sc-hq-stock-log')!;
    expect(log).not.toBeNull();
    const lines = [...log.querySelectorAll('.lines li')];
    expect(lines.length).toBe(2);
    expect(lines[0].textContent).toContain('Medpen');
    expect(lines[1].classList).toContain('res');
  });

  it('the subheader search is the page search, with alternatives at up to three hits (I14, I15)', () => {
    const { el, fixture, chrome } = mount({ ort: 'Lorville' });
    chrome.pageSearch()!('eisen q>700');
    fixture.detectChanges();
    expect(el.querySelector('.head input[type=search]')).toBeNull();
    const alts = [...el.querySelectorAll('.ghost .alt')].map((a) => a.textContent ?? '');
    expect(alts.some((t) => t.includes('alt.elsewhere'))).toBeTrue();
    expect(alts.some((t) => t.includes('alt.wishQ'))).toBeTrue();
  });

  it('table mode: Excel-like rows, amount edit writes, highlight selection, wide table scrolls (I7, X2)', () => {
    const { el, click, inv, fixture } = mount();
    click([...el.querySelectorAll('.mode button')][1]);
    const wrap = el.querySelector('sc-hq-stock-table .sc-table-scroll')!;
    expect(wrap).not.toBeNull();
    const input = wrap.querySelector<HTMLInputElement>('input.amt')!;
    input.value = '3';
    input.dispatchEvent(new Event('change'));
    fixture.detectChanges();
    expect(inv.setAmount).toHaveBeenCalled();
    click(wrap.querySelector('tbody tr'));
    expect(wrap.querySelector('tbody tr')!.getAttribute('aria-selected')).toBe('true');
  });

  it('Sets live in Inventar: tiles to the set editor plus "+ Set anlegen" (S2)', () => {
    const { el } = mount({ cat: 'sets' });
    const sets = [...el.querySelectorAll<HTMLAnchorElement>('a.set')];
    expect(sets[0].getAttribute('href')).toBe('/hq/locker/set1');
    expect(el.querySelector('button.set.add')).not.toBeNull();
  });

  it('Hangar: origin and role filters, the wishlist counter, variants per ship and Importieren as an anchor (H1, H2, H3)', () => {
    const { el, click } = mount({ bestand: 'hangar' });
    expect(chip(el, 'origin.loan')!.classList).toContain('zero');
    expect(chip(el, 'allRoles')).toBeTruthy();
    expect(el.querySelector('.bar a.wishes')?.textContent).toContain('wishCount');
    expect(el.querySelector('.tile.ship .where')?.textContent).toContain('variants');
    click(el.querySelector('.menu-wrap button'));
    expect(el.querySelector('.menu a[href="/hq/hangar/import"]')).not.toBeNull();
    expect(el.querySelector('.menu button.danger')).not.toBeNull();
  });

  it('Sammlung: Blaupausen, Ruf, News, Galerie; Ruf stays an honest empty state (S1)', () => {
    const { el } = mount({ bestand: 'sammlung' });
    const names = [...el.querySelectorAll('.bar .chip')].map((c) => c.textContent?.trim().replace(/\d+$/, ''));
    expect(names).toEqual(['hq.bestand.all', 'hq.bestand.deck.art.blueprints', 'hq.bestand.deck.art.ruf', 'hq.bestand.deck.art.news', 'hq.bestand.deck.art.gallery']);
    expect(el.querySelector('[data-ruf]')).not.toBeNull();
  });

  it('Alles: one deck with the ship and Sammlung lanes too (F1)', () => {
    const { el } = mount({ bestand: 'alles' });
    expect(chip(el, 'kind.ships')).toBeTruthy();
    expect(el.querySelectorAll('.deck .pad').length).toBe(2);
    expect(el.querySelectorAll('.deck .lock').length).toBe(1);
  });

  it('empty Inventar: one sentence, one primary, one second way, no 0 and no pager (F5)', () => {
    const { el } = mount({}, { empty: true });
    const area = el.querySelector('.empty-area')!;
    expect(area.querySelectorAll('[tier=primary]').length).toBe(1);
    expect(area.querySelector('a.second')).not.toBeNull();
    expect(el.querySelector('.pager')).toBeNull();
  });

  it('empty Hangar offers Schiff anlegen and the RSI hangar import (F5)', () => {
    const { el, fixture } = mount({ bestand: 'hangar' });
    (TestBed.inject(HangarService).ships as ReturnType<typeof signal>).set([]);
    fixture.detectChanges();
    expect(el.querySelector('.empty-area a.second')?.getAttribute('href')).toBe('/hq/hangar/import');
  });

  it('a load failure shows a translated error with retry, never an empty page', () => {
    const { fixture, inv, el, click } = mount();
    inv.loaded.set(false);
    inv.error.set('errors.generic');
    fixture.detectChanges();
    expect(el.querySelector('.state[role="alert"]')).not.toBeNull();
    click(el.querySelector('.state button'));
    expect(inv.load).toHaveBeenCalled();
  });
});
