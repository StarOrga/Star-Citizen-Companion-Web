import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { provideTranslateService } from '@ngx-translate/core';
import { AuthService } from '../../auth/auth.service';
import { CodexService, type CodexListRow } from '../../codex/codex.service';
import { WishNamesService } from '../../codex/search/wish-names.service';
import { HangarService } from '../../hangar/hangar.service';
import { HqInventoryService } from '../../hq/data/hq-inventory.service';
import { WishlistStore, type WishRow } from '../../hq/data/wishlist.store';
import { UndoToastService } from '../../shared/undo-toast/undo-toast.service';
import { NachschubService } from '../../hq/nachschub/nachschub.service';
import { WishCartDialogComponent } from './wish-cart-dialog.component';
import { WishCartService } from './wish-cart.service';

const wish = (kind: string, className: string, over: Partial<WishRow> = {}): WishRow => ({
  kind, className, name: className.toUpperCase(), manufacturer: null, rsiUrl: null, notes: null, qty: 1, forClassName: '', createdAt: '2026-11-07T10:00:00Z', ...over,
});

const fpsRow = (className: string, attachType: string | null, over: Partial<CodexListRow> = {}): CodexListRow => ({
  classNameSlug: className, nameLocalized: className, manufacturerCode: 'RRS', size: null, grade: null, role: null, crewSize: null,
  weaponClass: null, componentKind: null, subType: null, attachType, speed: null, isVariant: false, payload: {},
  blueprintCategory: null, blueprintTier: null, craftTimeSec: null, ...over,
});

function setup(rows: WishRow[], catalogue: { armor?: CodexListRow[]; weapon?: CodexListRow[] } = {}, newBlock: string | null = null) {
  const store = {
    rows: signal<readonly WishRow[]>(rows),
    ensureLoaded: () => Promise.resolve(),
    setQty: vi.fn().mockName('setQty').mockResolvedValue(true),
    remove: vi.fn().mockName('remove').mockResolvedValue(true),
    add: vi.fn().mockName('add').mockResolvedValue(true),
  };
  TestBed.configureTestingModule({
    providers: [
      provideRouter([{ path: '**', children: [] }]),
      provideTranslateService({}),
      { provide: AuthService, useValue: { user: signal({ id: 'u1' }) } },
      { provide: WishlistStore, useValue: store },
      { provide: NachschubService, useValue: { newBlock: signal(newBlock), ensureLoaded: () => Promise.resolve() } },
      { provide: HangarService, useValue: { ships: signal([]), updateShip: async () => true, removeShip: async () => true } },
      { provide: HqInventoryService, useValue: { items: signal([]) } },
      { provide: WishNamesService, useValue: { request: () => undefined, nameOf: () => null } },
      {
        provide: CodexService,
        useValue: {
          silhouettes: async () => new Map(),
          listFpsCatalog: async (cat: 'armor' | 'weapon') => (cat === 'armor' ? (catalogue.armor ?? []) : (catalogue.weapon ?? [])),
        },
      },
    ],
  });
  const fixture = TestBed.createComponent(WishCartDialogComponent);
  fixture.detectChanges();
  return { fixture, el: fixture.nativeElement as HTMLElement, store, cart: TestBed.inject(WishCartService), toast: TestBed.inject(UndoToastService) };
}

describe('WishCartDialogComponent (Warenkorb)', () => {
  afterEach(() => TestBed.inject(UndoToastService).flush());

  const rows = [
    wish('item', 'klwe_rifle_energy_01', { name: 'Gallant', qty: 2 }),
    wish('item', 'rsi_pembroke_helmet_01_01_01', { name: 'Pembroke Helm' }),
    wish('material', 'alu', { name: 'Aluminium', qty: 20, forClassName: 'bp_gallant' }),
    wish('blueprint', 'bp_gallant', { name: 'Gallant', qty: 2 }),
  ];

  it('is a labelled dialog with the groups in the cart order: Waffen first, the craft group last', () => {
    const { el } = setup(rows);
    expect(el.querySelector('[role="dialog"]')!.getAttribute('aria-modal')).toBe('true');
    const groups = Array.from(el.querySelectorAll('section.group')).map((g) => g.classList.contains('bp'));
    expect(groups).toEqual([false, false, true]);
    expect(el.querySelectorAll('.tile').length).toBe(4);
    expect(el.querySelector('.dlg-title small')!.textContent).toContain('cart.summary');
  });

  it('the Codex page is a real anchor on the tile (the arrow); the silhouette box never stretches (contain)', () => {
    const { el } = setup(rows);
    const a = el.querySelector<HTMLAnchorElement>('.tile a.open')!;
    expect(a.getAttribute('href')).toBe('/codex/item/klwe_rifle_energy_01');
    expect(a.getAttribute('aria-label')).toContain('cart.open');
    expect(el.querySelector('.tile .sil sc-sil-thumb')).not.toBeNull();
  });

  it('a click on the picture or the name ticks the position instead of leaving the cart', () => {
    const { fixture, el } = setup(rows);
    const cart = TestBed.inject(WishCartService);
    const close = vi.spyOn(cart, 'close');
    el.querySelector<HTMLElement>('.tile .pickarea .nm')!.click();
    fixture.detectChanges();
    expect(el.querySelectorAll('.tile.sel').length).toBe(1);
    el.querySelector<HTMLElement>('.tile .pickarea .sil')!.click();
    fixture.detectChanges();
    expect(el.querySelectorAll('.tile.sel').length).toBe(0);
    expect(close).not.toHaveBeenCalled();
  });

  it('a click beside the cart keeps it open (the selection would be lost)', () => {
    const { el } = setup(rows);
    const close = vi.spyOn(TestBed.inject(WishCartService), 'close').mockReturnValue(undefined as never);
    el.querySelector<HTMLElement>('.scrim')!.click();
    expect(close).not.toHaveBeenCalled();
  });

  it('a group checkbox selects the whole group, and "In einen Nachschub" carries the selection to Planen', () => {
    const { fixture, el } = setup(rows);
    const first = el.querySelector<HTMLInputElement>('section.group .g-head .chk')!;
    first.click();
    fixture.detectChanges();
    expect(el.querySelectorAll('.tile.sel').length).toBe(1);
    expect(el.querySelector('.sel-count b')!.textContent).toBe('1');
    const go = el.querySelector<HTMLAnchorElement>('a.go')!;
    const href = go.getAttribute('href')!;
    expect(href).toContain('/hq');
    expect(href).toContain('#planen');
    expect(decodeURIComponent(href)).toContain('item:klwe_rifle_energy_01~2');
  });

  it('with all 7 slots taken the take-over says so up front and offers only an existing Nachschub', () => {
    const open = setup(rows);
    expect(open.el.querySelector('.full-hint')).toBeNull();
    expect(open.el.querySelector('a.go')!.textContent).toContain('cart.toNachschub');
    TestBed.resetTestingModule();
    const full = setup(rows, {}, 'hq.nachschub.slotsFull');
    expect(full.el.querySelector('.full-hint')!.textContent).toContain('cart.slotsFullHint');
    expect(full.el.querySelector('a.go')!.textContent).toContain('cart.toExisting');
    expect(full.el.querySelector('a.go')!.textContent).not.toContain('cart.toNachschub');
  });

  it('selecting a craft group picks the blueprint and its material together', () => {
    const { fixture, el } = setup(rows);
    el.querySelector<HTMLInputElement>('section.group.bp .g-head .chk')!.click();
    fixture.detectChanges();
    expect(el.querySelectorAll('section.group.bp .tile.sel').length).toBe(2);
  });

  it('the primary action is off while nothing is selected', () => {
    const { el } = setup(rows);
    const go = el.querySelector<HTMLAnchorElement>('a.go')!;
    expect(go.getAttribute('aria-disabled')).toBe('true');
    const ev = new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 });
    go.dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(true);
  });

  it('the red trash removes at once and offers an undo, no question; undo brings it back and writes nothing', () => {
    const { fixture, el, store, toast, cart } = setup(rows);
    el.querySelector<HTMLButtonElement>('.tile .foot .sc-action--danger')!.click();
    fixture.detectChanges();
    expect(el.querySelectorAll('.tile').length).toBe(3);
    expect(cart.count()).toBe(3);
    expect(toast.current()?.messageKey).toBe('cart.removed');
    expect(store.remove).not.toHaveBeenCalled();
    toast.undo();
    fixture.detectChanges();
    expect(el.querySelectorAll('.tile').length).toBe(4);
    expect(store.remove).not.toHaveBeenCalled();
  });

  it('the trash of a group removes the whole group, also without a question; the write happens when the toast closes', async () => {
    const { fixture, el, store, toast } = setup(rows);
    el.querySelector<HTMLButtonElement>('section.group.bp .g-trash')!.click();
    fixture.detectChanges();
    expect(el.querySelectorAll('section.group').length).toBe(2);
    expect(toast.current()?.messageKey).toBe('cart.removedGroup');
    toast.flush();
    await Promise.resolve();
    expect(store.remove).toHaveBeenCalledTimes(2);
  });

  it('a wish put on the list again inside the undo window is not deleted by the delayed delete (M9)', async () => {
    const { fixture, el, store, toast } = setup(rows);
    el.querySelector<HTMLButtonElement>('.tile .foot .sc-action--danger')!.click();
    fixture.detectChanges();
    expect(el.querySelectorAll('.tile').length).toBe(3);
    // Wished again from the Codex: the same position, one more of it (the store replaces the row).
    store.rows.update((rs) => rs.map((r) => (r.className === 'klwe_rifle_energy_01' ? { ...r, qty: r.qty + 1 } : r)));
    fixture.detectChanges();
    expect(el.querySelectorAll('.tile').length).toBe(4);
    toast.flush();
    await Promise.resolve();
    expect(store.remove).not.toHaveBeenCalled();
  });

  it('a material tile names its unit: the amounts are SCU (AUD-11)', () => {
    const { el } = setup(rows);
    const tiles = [...el.querySelectorAll('.tile')];
    const alu = tiles.find((t) => t.textContent?.includes('Aluminium'))!;
    expect(alu.querySelector('.step b .unit')?.textContent).toContain('blueprint.detail.unitScu');
    const rifle = tiles.find((t) => t.textContent?.includes('Gallant') && !t.textContent?.includes('Aluminium'))!;
    expect(rifle.querySelector('.step b .unit')).toBeNull();
  });

  it('the stepper sets the quantity', () => {
    const { fixture, el, store } = setup(rows);
    el.querySelectorAll<HTMLButtonElement>('.tile .step button')[1].click();
    fixture.detectChanges();
    expect(store.setQty).toHaveBeenCalledWith(expect.objectContaining({ className: 'klwe_rifle_energy_01' }), 3);
  });

  it('shows the empty state without a retry', () => {
    const { el } = setup([]);
    expect(el.querySelector('.empty-t')).not.toBeNull();
    expect(el.querySelector('section.group')).toBeNull();
  });

  describe('Passt dazu', () => {
    const armor = ['helmet', 'core', 'arms', 'legs', 'backpack', 'undersuit'].map((p, i) =>
      fpsRow(`pembroke_armor_heavy_${p}_01_01_01`, `Char_Armor_${['Helmet', 'Torso', 'Arms', 'Legs', 'Backpack', 'Undersuit'][i]}`),
    );

    it('shows exactly three suggestions out of seven ready; a dismissed one is replaced by the next', async () => {
      const t = setup([wish('item', 'pembroke_armor_heavy_helmet_01_01_01', { name: 'Pembroke Helm' })], { armor });
      await new Promise((r) => setTimeout(r));
      t.fixture.detectChanges();
      expect(t.cart.ready().length).toBeGreaterThanOrEqual(5);
      const names = () => Array.from(t.el.querySelectorAll('.sug b')).map((b) => b.textContent);
      expect(names().length).toBe(3);
      const before = names();
      t.el.querySelector<HTMLButtonElement>('.sug .sug-act button:last-child')!.click();
      t.fixture.detectChanges();
      const after = names();
      expect(after.length).toBe(3);
      expect(after).not.toContain(before[0]);
      expect(after[0]).toBe(before[1]);
    });

    it('a dismissed suggestion comes back after the next add', async () => {
      const t = setup([wish('item', 'pembroke_armor_heavy_helmet_01_01_01', { name: 'Pembroke Helm' })], { armor });
      await new Promise((r) => setTimeout(r));
      t.fixture.detectChanges();
      const first = t.cart.suggestions()[0].className;
      t.cart.dismiss(first);
      expect(t.cart.suggestions().map((s) => s.className)).not.toContain(first);
      t.store.rows.update((rs) => [...rs, wish('item', 'other_thing', { createdAt: '2026-11-08T10:00:00Z' })]);
      t.fixture.detectChanges();
      TestBed.flushEffects();
      expect(t.cart.suggestions().map((s) => s.className)).toContain(first);
    });

    it('adding a suggestion puts it on the wishlist with quantity 1', async () => {
      const t = setup([wish('item', 'pembroke_armor_heavy_helmet_01_01_01')], { armor });
      await new Promise((r) => setTimeout(r));
      t.fixture.detectChanges();
      t.el.querySelector<HTMLButtonElement>('.sug .sug-act button')!.click();
      expect(t.store.add).toHaveBeenCalledWith(expect.objectContaining({ kind: 'item' }));
    });
  });
});
