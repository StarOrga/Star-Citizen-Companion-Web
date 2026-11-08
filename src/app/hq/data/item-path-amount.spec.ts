import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { AuthService } from '../../auth/auth.service';
import { setNumberLocale } from '../../codex/codex-format';
import { SearchWishlistService } from '../../codex/search/search-wishlist.service';
import { HangarService } from '../../hangar/hangar.service';
import { ScConfirmService } from '../../shared/dialog/sc-confirm.service';
import { fakeSupabase } from '../../testing/fake-supabase';
import { HqSuppliesService, SUPPLIES_CACHE_KEY, SUPPLIES_STORAGE_KEY, suppliesCacheKey, supplyQtyText } from '../hq-supplies.service';
import { HqLiveService } from '../now/hq-live.service';
import { HqInventoryService } from './hq-inventory.service';
import { ItemPathService } from './item-path.service';

interface Row { location: string; name: string; class_name: string | null; qty: number; unit: 'pcs' | 'scu' }

/** The REAL supplies service (so merging and scaling are the production ones) behind the path service. */
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
      { provide: SearchWishlistService, useValue: { has: () => false, qtyOf: () => 0, setQty: async () => true, add: async () => true, remove: async () => true } },
      { provide: HqInventoryService, useValue: inventory },
      { provide: HangarService, useValue: { shipByClassName: () => null } },
      { provide: HqLiveService, useValue: { state: () => null, events: () => [] } },
    ],
  });
  const supplies = TestBed.inject(HqSuppliesService);
  TestBed.flushEffects();
  return { svc: TestBed.inject(ItemPathService), supplies, stock, stockCalls };
}

/** What the HQ Nachschub writes for one blueprint: its own line plus its material, in exact SCU. */
function blueprintLines(supplies: HqSuppliesService, portions = 1): void {
  supplies.addLine('Laser Cannon', portions, { entityKind: 'blueprint', className: 'BP_X', source: 'search' });
  supplies.addLine('Agricium', portions, { entityKind: 'item', className: 'Agricium', source: 'search', forClassName: 'BP_X', amount: 0.36 * portions, unit: 'scu' });
  supplies.addLine('Aluminium', portions, { entityKind: 'item', className: 'Frame_Alu', source: 'search', forClassName: 'BP_X', amount: 2.4 * portions, unit: 'scu' });
}

describe('ItemPathService - exact amounts of blueprint material', () => {
  afterEach(() => {
    setNumberLocale(null);
    for (const k of [SUPPLIES_STORAGE_KEY, SUPPLIES_CACHE_KEY, suppliesCacheKey('u1')]) localStorage.removeItem(k);
  });

  it('reads 0.36 SCU Agricium as 0,36 SCU (German) / 0.36 SCU (English), never as 1', () => {
    const { svc, supplies } = setup();
    blueprintLines(supplies);
    const agri = supplies.openLinesFor('Agricium')[0];
    setNumberLocale('de-DE');
    expect(supplyQtyText(agri)).toBe('0,36 SCU');
    const st = svc.read('item', 'Agricium');
    expect([st.nachschubQty, st.nachschubUnit]).toEqual([0.36, 'scu']);
    setNumberLocale('en-US');
    expect(supplyQtyText(agri)).toBe('0.36 SCU');
  });

  it('"Besorgt" writes the exact amount to Inventar as SCU and closes the line; undo reopens it', async () => {
    const { svc, supplies, stock, stockCalls } = setup();
    blueprintLines(supplies);
    const st = svc.read('item', 'Agricium');
    const res = await svc.moveToInventar('item', 'Agricium', 'Agricium', 'Port Olisar', st.nachschubQty, { unit: st.nachschubUnit });
    expect(stockCalls.at(-1)).toEqual({ loc: 'Port Olisar', name: 'Agricium', qty: 0.36, unit: 'scu', cls: 'Agricium' });
    expect(stock()[0]).toEqual(expect.objectContaining({ qty: 0.36, unit: 'scu' }));
    expect(supplies.openLinesFor('Agricium').length).toBe(0);
    await res.undo!();
    expect(stock().length).toBe(0);
    expect(supplies.openLinesFor('Agricium')[0].amount).toBe(0.36);
  });

  it('"Besorgt" without options still takes the unit from the line (an SCU amount never turns into pieces)', async () => {
    const { svc, supplies, stockCalls } = setup();
    blueprintLines(supplies);
    await svc.moveToInventar('item', 'Frame_Alu', 'Aluminium', 'Bei mir', 1);
    expect(stockCalls.at(-1)!.unit).toBe('scu');
    expect(stockCalls.at(-1)!.qty).toBe(1);
    expect(supplies.openLinesFor('Frame_Alu')[0].amount).toBe(1.4);
  });
});
