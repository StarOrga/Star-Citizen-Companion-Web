import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { AuthService } from '../../auth/auth.service';
import { CodexService } from '../../codex/codex.service';
import { setNumberLocale } from '../../codex/codex-format';
import { SearchWishlistService } from '../../codex/search/search-wishlist.service';
import { HangarService } from '../../hangar/hangar.service';
import { ScConfirmService } from '../../shared/dialog/sc-confirm.service';
import { fakeSupabase } from '../../testing/fake-supabase';
import { HqSuppliesService, SUPPLIES_CACHE_KEY, SUPPLIES_STORAGE_KEY, suppliesCacheKey, supplyQtyText } from '../hq-supplies.service';
import { HqLiveService } from '../now/hq-live.service';
import { HqInventoryService } from './hq-inventory.service';
import { ItemPathService } from './item-path.service';

interface Ing { ingredientClassName: string; nameLocalized: string; entityKind: string | null; quantity: number }
interface Row { location: string; name: string; class_name: string | null; qty: number; unit: 'pcs' | 'scu' }

const RECIPES: Record<string, Ing[]> = {
  BP_X: [
    { ingredientClassName: 'Agricium', nameLocalized: 'Agricium', entityKind: 'item', quantity: 0.36 },
    { ingredientClassName: 'Frame_Alu', nameLocalized: 'Aluminium', entityKind: 'item', quantity: 2.4 },
  ],
  BP_Y: [{ ingredientClassName: 'Agricium', nameLocalized: 'Agricium', entityKind: 'item', quantity: 0.5 }],
};

/** The REAL supplies service (so merging, scaling and tombstones are the production ones) behind the path service. */
function setup() {
  TestBed.resetTestingModule();
  for (const k of [SUPPLIES_STORAGE_KEY, SUPPLIES_CACHE_KEY, suppliesCacheKey('u1')]) localStorage.removeItem(k);
  const stock = signal<Row[]>([]);
  const stockCalls: { loc: string; name: string; qty: number; unit: string; cls: string | null }[] = [];
  const inventory = {
    items: stock,
    error: () => null,
    addStock: async (loc: string, name: string, qty: number, unit: 'pcs' | 'scu', cls: string | null) => {
      stockCalls.push({ loc, name, qty, unit, cls });
      const have = stock().find((i) => i.location === loc && i.class_name === cls);
      stock.set(
        have
          ? stock().map((i) => (i === have ? { ...i, qty: Math.round((i.qty + qty) * 1e6) / 1e6 } : i))
          : [...stock(), { location: loc, name, class_name: cls, qty, unit }],
      );
      return true;
    },
    removeStock: async (loc: string, _n: string, qty: number, cls: string | null) => {
      stock.set(stock().map((i) => (i.location === loc && i.class_name === cls ? { ...i, qty: Math.round((i.qty - qty) * 1e6) / 1e6 } : i)).filter((i) => i.qty > 0));
      return true;
    },
  };
  TestBed.configureTestingModule({
    providers: [
      fakeSupabase().provider,
      { provide: AuthService, useValue: { user: signal({ id: 'u1' }) } },
      { provide: ScConfirmService, useValue: { confirm: async () => false } },
      { provide: SearchWishlistService, useValue: { has: () => false, add: async () => true, remove: async () => true } },
      { provide: HqInventoryService, useValue: inventory },
      { provide: HangarService, useValue: { shipByClassName: () => null } },
      { provide: HqLiveService, useValue: { state: () => null, events: () => [] } },
      { provide: CodexService, useValue: { getBlueprint: async (cls: string) => ({ classNameSlug: cls, row: {}, ingredients: RECIPES[cls] ?? [] }) } },
    ],
  });
  const supplies = TestBed.inject(HqSuppliesService);
  TestBed.flushEffects();
  return { svc: TestBed.inject(ItemPathService), supplies, stock, stockCalls };
}

describe('ItemPathService - exact amounts of blueprint material', () => {
  afterEach(() => {
    setNumberLocale(null);
    for (const k of [SUPPLIES_STORAGE_KEY, SUPPLIES_CACHE_KEY, suppliesCacheKey('u1')]) localStorage.removeItem(k);
  });

  it('shows 0.36 SCU Agricium as 0,36 SCU (German) / 0.36 SCU (English), never as 1', async () => {
    const { svc, supplies } = setup();
    await svc.addToNachschub('blueprint', 'BP_X', 'Laser Cannon', 1);
    const agri = supplies.openLinesFor('Agricium')[0];
    expect([agri.amount, agri.unit, agri.qty, agri.forClassName]).toEqual([0.36, 'scu', 1, 'BP_X']);
    expect(supplies.openLinesFor('Frame_Alu')[0].amount).toBe(2.4);
    setNumberLocale('de-DE');
    expect(supplyQtyText(agri)).toBe('0,36 SCU');
    const st = svc.read('item', 'Agricium');
    expect([st.nachschubQty, st.nachschubUnit]).toEqual([0.36, 'scu']);
    setNumberLocale('en-US');
    expect(supplyQtyText(agri)).toBe('0.36 SCU');
  });

  it('a blueprint asked for twice needs twice the material, and the same material of two blueprints adds up in SCU', async () => {
    const { svc, supplies } = setup();
    await svc.addToNachschub('blueprint', 'BP_X', 'Laser Cannon', 2);
    expect(supplies.openLinesFor('Agricium')[0].amount).toBe(0.72);
    await svc.addToNachschub('blueprint', 'BP_Y', 'Scattergun', 1);
    expect(supplies.openLinesFor('Agricium').length).toBe(2);
    expect(svc.read('item', 'Agricium').nachschubQty).toBe(1.22);
  });

  it('-/+ move by one blueprint\'s worth, never round, and - on the last portion removes the line', async () => {
    const { svc, supplies } = setup();
    await svc.addToNachschub('blueprint', 'BP_X', 'Laser Cannon', 1);
    svc.changeNachschubQty('item', 'Agricium', 1);
    expect(supplies.openLinesFor('Agricium')[0].amount).toBe(0.72);
    expect(svc.read('item', 'Agricium').nachschubQty).toBe(0.72);
    const back = svc.changeNachschubQty('item', 'Agricium', -1);
    expect(supplies.openLinesFor('Agricium')[0].amount).toBe(0.36);
    expect(back.params?.['qty']).toContain('SCU');
    const gone = svc.changeNachschubQty('item', 'Agricium', -1);
    expect(supplies.openLinesFor('Agricium').length).toBe(0);
    await gone.undo!();
    expect(supplies.openLinesFor('Agricium')[0].amount).toBe(0.36);
  });

  it('"Besorgt" writes the exact amount to Inventar as SCU and closes the line; undo reopens it', async () => {
    const { svc, supplies, stock, stockCalls } = setup();
    await svc.addToNachschub('blueprint', 'BP_X', 'Laser Cannon', 1);
    const st = svc.read('item', 'Agricium');
    const res = await svc.moveToInventar('item', 'Agricium', 'Agricium', 'Port Olisar', st.nachschubQty, { unit: st.nachschubUnit });
    expect(stockCalls.at(-1)).toEqual({ loc: 'Port Olisar', name: 'Agricium', qty: 0.36, unit: 'scu', cls: 'Agricium' });
    expect(stock()[0]).toEqual(jasmine.objectContaining({ qty: 0.36, unit: 'scu' }));
    expect(supplies.openLinesFor('Agricium').length).toBe(0);
    await res.undo!();
    expect(stock().length).toBe(0);
    expect(supplies.openLinesFor('Agricium')[0].amount).toBe(0.36);
  });

  it('"Besorgt" without options still takes the unit from the line (an SCU amount never turns into pieces)', async () => {
    const { svc, supplies, stockCalls } = setup();
    await svc.addToNachschub('blueprint', 'BP_X', 'Laser Cannon', 1);
    await svc.moveToInventar('item', 'Frame_Alu', 'Aluminium', 'Bei mir', 1);
    expect(stockCalls.at(-1)!.unit).toBe('scu');
    expect(stockCalls.at(-1)!.qty).toBe(1);
    const left = supplies.openLinesFor('Frame_Alu')[0];
    expect(left.amount).toBe(1.4);
  });

  it('"Nachholen" of SCU stock brings the exact amount back, not a rounded piece count', () => {
    const { svc, supplies } = setup();
    const res = svc.nachholen('item', 'Agricium', 'Agricium', 0.36, 'scu');
    expect(supplies.openLinesFor('Agricium')[0].amount).toBe(0.36);
    expect(res.params?.['qty']).toContain('SCU');
    svc.nachholen('item', 'Rifle', 'Rifle', 2);
    expect(supplies.openLinesFor('Rifle')[0].qty).toBe(2);
  });

  describe('removing a blueprint from Nachschub', () => {
    it('takes its material along, keeps lines added on their own or for another blueprint, and undo restores all of it', async () => {
      const { svc, supplies } = setup();
      await svc.addToNachschub('item', 'Agricium', 'Agricium', 2); // on its own, in pieces
      await svc.addToNachschub('blueprint', 'BP_Y', 'Scattergun', 1); // also needs Agricium
      await svc.addToNachschub('blueprint', 'BP_X', 'Laser Cannon', 1);
      const before = supplies.items().map((i) => [i.name, i.qty, i.amount, i.forClassName]);
      expect(supplies.open().length).toBe(5);

      const res = svc.removeFromNachschub('blueprint', 'BP_X');
      expect(res.key).toBe('itemPath.done.nachschubOffMaterial');
      expect(res.params).toEqual({ name: 'Laser Cannon', n: 2 });
      expect(supplies.open().map((i) => i.name).sort()).toEqual(['Agricium', 'Agricium', 'Scattergun']);
      expect(supplies.openLinesFor('Agricium').map((l) => [l.amount, l.forClassName])).toEqual([
        [null, null],
        [0.5, 'BP_Y'],
      ]);
      expect(supplies.openLinesFor('Frame_Alu').length).toBe(0);

      await res.undo!();
      expect(supplies.open().length).toBe(5);
      expect(supplies.items().map((i) => [i.name, i.qty, i.amount, i.forClassName])).toEqual(before);
    });

    it('a plain item without material removes just its line, and "-" to zero on a blueprint takes the material too', async () => {
      const { svc, supplies } = setup();
      await svc.addToNachschub('item', 'rifle', 'Gewehr', 1);
      expect(svc.removeFromNachschub('item', 'rifle').key).toBe('itemPath.done.nachschubOff');
      await svc.addToNachschub('blueprint', 'BP_X', 'Laser Cannon', 1);
      svc.changeNachschubQty('blueprint', 'BP_X', -1);
      expect(supplies.open().length).toBe(0);
    });

    it('a material already ticked off ("besorgt") stays', async () => {
      const { svc, supplies } = setup();
      await svc.addToNachschub('blueprint', 'BP_X', 'Laser Cannon', 1);
      await svc.moveToInventar('item', 'Agricium', 'Agricium', 'Bei mir', 0.36);
      svc.removeFromNachschub('blueprint', 'BP_X');
      expect(supplies.open().length).toBe(0);
      expect(supplies.items().filter((i) => i.done).map((i) => i.name)).toEqual(['Agricium']);
    });
  });
});
