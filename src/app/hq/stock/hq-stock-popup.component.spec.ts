import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { provideTranslateService } from '@ngx-translate/core';
import { CodexService } from '../../codex/codex.service';
import { HangarService } from '../../hangar/hangar.service';
import { HqInventoryService } from '../data/hq-inventory.service';
import { ItemPathService } from '../data/item-path.service';
import { WishlistStore } from '../data/wishlist.store';
import { SearchWishlistService } from '../../codex/search/search-wishlist.service';
import { HqSuppliesService } from '../hq-supplies.service';
import { NachschubService } from '../nachschub/nachschub.service';
import { UndoToastService } from '../../shared/undo-toast/undo-toast.service';
import { fakeItemPath } from '../../shared/item-path/item-path.testing';
import { HqLiveService } from '../now/hq-live.service';
import { HqStockPopupComponent, StockStart } from './hq-stock-popup.component';

describe('HqStockPopupComponent: capture and links', () => {
  afterEach(() => TestBed.inject(UndoToastService).flush());
  interface Hit { kind: string; classNameSlug: string; nameLocalized: string }
  interface Row { location: string; name: string; class_name: string | null; qty: number; unit: 'pcs' | 'scu' }

  function mount(start: StockStart, opts: { hits?: Hit[]; items?: Row[] } = {}) {
    const items = opts.items ?? [];
    const path = fakeItemPath();
    const wish = {
      totalQty: () => 0,
      qtyOf: () => 0,
      setQty: vi.fn().mockName('setQty').mockResolvedValue(true),
      remove: vi.fn().mockName('remove').mockResolvedValue(true),
    };
    const inv = {
      loaded: signal(true),
      error: signal<string | null>(null),
      snapshots: signal(items.length ? [{ location: items[0].location, taken_at: new Date().toISOString(), source: 'manual' }] : []),
      locations: signal([]),
      items: signal(items),
      shipStorage: signal([]),
      load: vi.fn().mockName('load').mockResolvedValue(undefined),
      addManual: vi.fn().mockName('addManual').mockResolvedValue(true),
      lastKnownLocation: () => Promise.resolve(null),
    };
    TestBed.configureTestingModule({
      imports: [HqStockPopupComponent],
      providers: [
        provideRouter([]),
        provideTranslateService(),
        { provide: HangarService, useValue: { ships: signal([]), roleLoadouts: signal([]) } },
        { provide: HqInventoryService, useValue: inv },
        { provide: ItemPathService, useValue: path },
        { provide: WishlistStore, useValue: wish },
        { provide: SearchWishlistService, useValue: { qtyOf: () => 0, add: () => Promise.resolve(true), setQty: () => Promise.resolve(true), remove: () => Promise.resolve(true) } },
        { provide: HqSuppliesService, useValue: { items: signal([]) } },
        { provide: NachschubService, useValue: { packages: signal([]) } },
        { provide: HqLiveService, useValue: { state: signal({ location: 'Area18' }), events: signal([]) } },
        { provide: CodexService, useValue: { searchAll: () => Promise.resolve({ hits: opts.hits ?? [], totals: {} }) } },
      ],
    });
    const fixture = TestBed.createComponent(HqStockPopupComponent);
    fixture.componentRef.setInput('start', start);
    fixture.detectChanges();
    return { fixture, inv, path, wish };
  }

  async function type(fixture: ReturnType<typeof mount>['fixture'], text: string) {
    await fixture.whenStable();
    fixture.detectChanges();
    const input = (fixture.nativeElement as HTMLElement).querySelector('#hq-stock-item') as HTMLInputElement;
    input.value = text;
    input.dispatchEvent(new Event('input'));
    await new Promise((r) => setTimeout(r, 300));
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  }

  it('says it does not exist, offers the sub-kind and saves a manual entry with it (I9)', async () => {
    const { fixture, inv } = mount({ mode: 'add' });
    const el: HTMLElement = fixture.nativeElement;
    const c = fixture.componentInstance as unknown as { location: string; manualSub: { set(v: string | null): void }; add(): Promise<void> };
    c.location = 'Area18';
    await type(fixture, 'q34tqaergv');
    expect(el.querySelector('#hq-stock-item-msg')?.textContent).toContain('hq.stock.capture.unknown');
    expect(el.querySelector('sc-select[aria-label], sc-select')).not.toBeNull();
    expect((el.querySelector('form.capture button[type=submit]') as HTMLButtonElement).disabled).toBe(false);
    c.manualSub.set('armor.helmet');
    await c.add();
    expect(inv.addManual).toHaveBeenCalledWith('Area18', 'q34tqaergv', 1, 'pcs', 'manual:armor.helmet');
  });

  it('saves a picked suggestion with its kind and class name', async () => {
    const { fixture, inv } = mount({ mode: 'add' }, { hits: [{ kind: 'ship', classNameSlug: 'AEGS_Idris_P', nameLocalized: 'Idris-P' }] });
    const c = fixture.componentInstance;
    c.location = 'Area18';
    await type(fixture, 'Idr');
    expect(((fixture.nativeElement as HTMLElement).querySelector('[role=option]') as HTMLElement).textContent).toContain('Idris-P');
    c.pick(c.suggestions()[0]);
    fixture.detectChanges();
    expect(c.valid()).toBe(true);
    await c.add();
    expect(inv.addManual).toHaveBeenCalledWith('Area18', 'Idris-P', 1, 'pcs', 'ship:AEGS_Idris_P');
  });

  it('renders a result with a target as an anchor and one without as plain text', async () => {
    const { fixture } = mount(
      { mode: 'browse' },
      {
        items: [
          { location: 'Lorville', name: 'Gold', class_name: 'item:Gold', qty: 3, unit: 'scu' },
          { location: 'Lorville', name: 'Notiz', class_name: null, qty: 1, unit: 'scu' },
        ],
      },
    );
    await fixture.whenStable();
    fixture.detectChanges();
    const rows = [...(fixture.nativeElement as HTMLElement).querySelectorAll('li.row')];
    const gold = rows.find((r) => r.textContent?.includes('Gold'));
    const note = rows.find((r) => r.textContent?.includes('Notiz'));
    expect(gold?.querySelector('a.entry')?.getAttribute('href')).toBe('/codex/item/Gold');
    expect(note?.querySelector('a')).toBeNull();
  });

  it('gives each row with a class name the tertiary path and a Nachholen action; a row without one has neither', async () => {
    const { fixture } = mount(
      { mode: 'browse' },
      {
        items: [
          { location: 'Lorville', name: 'Gold', class_name: 'item:Gold', qty: 3, unit: 'scu' },
          { location: 'Lorville', name: 'Notiz', class_name: null, qty: 1, unit: 'scu' },
        ],
      },
    );
    await fixture.whenStable();
    fixture.detectChanges();
    const rows = [...(fixture.nativeElement as HTMLElement).querySelectorAll('li.row')];
    const gold = rows.find((r) => r.textContent?.includes('Gold'))!;
    const note = rows.find((r) => r.textContent?.includes('Notiz'))!;
    expect(gold.querySelector('sc-item-path')).not.toBeNull();
    expect(gold.querySelector('button.again.sc-action--secondary')).not.toBeNull();
    expect(note.querySelector('sc-item-path')).toBeNull();
    expect(note.querySelector('.again')).toBeNull();
  });

  it('Nachholen puts the row on the wishlist like the tile button, with an undo toast; Nachschub and stock are not written (AUD-5)', async () => {
    const { fixture, inv, path, wish } = mount(
      { mode: 'browse' },
      { items: [{ location: 'Lorville', name: 'Medpen', class_name: 'item:Medpen_01', qty: 4, unit: 'pcs' }] },
    );
    await new Promise((r) => setTimeout(r, 0));
    fixture.detectChanges();
    const el: HTMLElement = fixture.nativeElement;
    const btn = el.querySelector('li.row button.again') as HTMLButtonElement;
    expect(btn.textContent).toContain('hq.stock.popup.onWishlist');
    btn.click();
    await new Promise((r) => setTimeout(r, 0));
    fixture.detectChanges();
    expect(wish.setQty).toHaveBeenCalledExactlyOnceWith({ kind: 'item', className: 'Medpen_01', name: 'Medpen' }, 1);
    expect(path.nachholen).not.toHaveBeenCalled();
    expect(inv.addManual).not.toHaveBeenCalled();
    const toast = TestBed.inject(UndoToastService);
    expect(toast.current()?.messageKey).toBe('itemPath.done.wishOn');
    wish.setQty.mockClear();
    toast.undo();
    expect(wish.remove).toHaveBeenCalledWith('item', 'Medpen_01', 'Medpen');
  });

  it('Nachholen shows the failure inline when the wishlist write fails', async () => {
    const { fixture, wish } = mount(
      { mode: 'browse' },
      { items: [{ location: 'Lorville', name: 'Medpen', class_name: 'item:Medpen_01', qty: 1, unit: 'pcs' }] },
    );
    wish.setQty.mockResolvedValue(false);
    await fixture.whenStable();
    fixture.detectChanges();
    const el: HTMLElement = fixture.nativeElement;
    (el.querySelector('li.row button.again') as HTMLButtonElement).click();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(el.querySelector('[role=alert].warn')?.textContent).toContain('errors.generic');
  });
});
