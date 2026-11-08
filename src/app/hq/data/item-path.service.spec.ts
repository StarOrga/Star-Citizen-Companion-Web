import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { AuthService } from '../../auth/auth.service';
import { SearchWishlistService } from '../../codex/search/search-wishlist.service';
import { HangarService } from '../../hangar/hangar.service';
import { HqSuppliesService, type SupplyItem } from '../hq-supplies.service';
import { NachschubEdgeService } from '../nachschub/nachschub-edge.service';
import { NachschubService } from '../nachschub/nachschub.service';
import { HqLiveService } from '../now/hq-live.service';
import { HqInventoryService } from './hq-inventory.service';
import { ItemPathService, PLACE_WITH_ME, isPathError, stepsOf } from './item-path.service';
import { WishlistStore, wishKey, type WishEntry, type WishRow } from './wishlist.store';

interface Line { id: string; name: string; qty: number; done: boolean; className: string; amount: number | null; unit: null; packageId?: string | null }
interface Stock { location: string; name: string; class_name: string | null; qty: number; unit: 'pcs' }
interface Ship { id: string; shipClassName: string; status: 'owned' | 'wishlist'; qty: number }

/**
 * The REAL SearchWishlistService (so a ship's two wish homes are the production rule) over a fake store and hangar;
 * Nachschub lines, stock and the second-copy rule are fakes.
 */
function setup(opts: { user?: boolean; live?: Record<string, unknown> | null; storeFails?: boolean } = {}) {
  const rows = signal<WishRow[]>([]);
  const row = (e: WishEntry, qty: number): WishRow => ({
    kind: e.kind, className: e.className, name: e.name ?? null, manufacturer: null, rsiUrl: null, notes: null, qty, forClassName: '', createdAt: '',
  });
  const find = (k: string, c: string, n?: string | null) => rows().find((r) => wishKey(r.kind, r.className, r.name) === wishKey(k, c, n)) ?? null;
  const store = {
    rows,
    byKey: () => new Map(rows().map((r) => [wishKey(r.kind, r.className, r.name), r] as const)),
    ensureLoaded: async () => undefined,
    has: (k: string, c: string, n?: string | null) => !!find(k, c, n),
    qtyOf: (k: string, c: string, n?: string | null) => find(k, c, n)?.qty ?? 0,
    add: async (e: WishEntry) => {
      if (opts.storeFails) return false;
      if (!find(e.kind, e.className, e.name)) rows.update((r) => [row(e, e.qty ?? 1), ...r]);
      return true;
    },
    setQty: async (e: WishEntry, qty: number) => {
      if (opts.storeFails) return false;
      if (qty <= 0) return store.remove(e.kind, e.className, e.name);
      const hit = find(e.kind, e.className, e.name);
      if (!hit) return store.add({ ...e, qty });
      rows.update((r) => r.map((x) => (x === hit ? { ...x, qty } : x)));
      return true;
    },
    remove: async (k: string, c: string, n?: string | null) => {
      if (opts.storeFails) return false;
      const hit = find(k, c, n);
      rows.update((r) => r.filter((x) => x !== hit));
      return true;
    },
  };

  const ships = signal<Ship[]>([]);
  const patchShip = (id: string, p: Partial<Ship>) => ships.update((s) => s.map((x) => (x.id === id ? { ...x, ...p } : x)));
  const hangar = {
    ships,
    shipByClassName: (c: string) => ships().find((s) => s.shipClassName === c) ?? null,
    addShip: async (c: string, status: 'owned' | 'wishlist') => {
      const s: Ship = { id: `s-${c}`, shipClassName: c, status, qty: 1 };
      ships.update((x) => [s, ...x]);
      return s;
    },
    updateShip: async (id: string, p: Partial<Ship>) => (patchShip(id, p), true),
    removeShip: async (id: string) => (ships.update((s) => s.filter((x) => x.id !== id)), true),
  };
  const edge = {
    addShipCopy: jasmine.createSpy('addShipCopy').and.callFake(async (c: string) => {
      const s = hangar.shipByClassName(c)!;
      patchShip(s.id, { qty: s.qty + 1 });
      return s.qty + 1;
    }),
  };

  const lines: Line[] = [];
  let n = 0;
  const supplies = {
    addLine: (name: string, qty: number, className: string) => lines.push({ id: `l${++n}`, name, qty, done: false, className, amount: null, unit: null }),
    openLinesFor: (c: string) => lines.filter((l) => !l.done && l.className === c) as unknown as SupplyItem[],
    setDone: (id: string, done: boolean) => {
      lines.find((l) => l.id === id)!.done = done;
    },
    setQty: (id: string, qty: number) => {
      lines.find((l) => l.id === id)!.qty = qty;
    },
    setLine: (id: string, qty: number) => {
      lines.find((l) => l.id === id)!.qty = qty;
    },
  };
  const stock = signal<Stock[]>([]);
  const inventory = {
    items: stock,
    error: () => null,
    addStock: async (loc: string, name: string, qty: number, _u: string, cls: string | null) => {
      const have = stock().find((i) => i.location === loc && i.class_name === cls);
      stock.set(have ? stock().map((i) => (i === have ? { ...i, qty: i.qty + qty } : i)) : [...stock(), { location: loc, name, class_name: cls, qty, unit: 'pcs' }]);
      return true;
    },
    removeStock: async (loc: string, _n: string, qty: number, cls: string | null) => {
      stock.set(stock().map((i) => (i.location === loc && i.class_name === cls ? { ...i, qty: i.qty - qty } : i)).filter((i) => i.qty > 0));
      return true;
    },
  };
  const active = signal<{ id: string }[]>([]);
  const nachschub = {
    active,
    reconcile: jasmine.createSpy('reconcile').and.resolveTo(undefined),
    reactivate: jasmine.createSpy('reactivate').and.callFake(async (id: string) => (active.update((a) => [...a, { id }]), { ok: true })),
  };
  TestBed.configureTestingModule({
    providers: [
      { provide: NachschubService, useValue: nachschub },
      { provide: AuthService, useValue: { user: () => (opts.user === false ? null : { id: 'u1' }) } },
      { provide: WishlistStore, useValue: store },
      { provide: HangarService, useValue: hangar },
      { provide: NachschubEdgeService, useValue: edge },
      { provide: HqSuppliesService, useValue: supplies },
      { provide: HqInventoryService, useValue: inventory },
      { provide: HqLiveService, useValue: { state: () => opts.live ?? null, events: () => [] } },
    ],
  });
  const ship = (c: string) => hangar.shipByClassName(c);
  return { svc: TestBed.inject(ItemPathService), wishlist: TestBed.inject(SearchWishlistService), rows, lines, stock, ships, ship, edge, supplies, nachschub, active };
}

describe('ItemPathService', () => {
  it('lists the stops per kind; an announced ship only has the wish', () => {
    expect(stepsOf('item')).toEqual(['wish', 'inventar']);
    expect(stepsOf('blueprint')).toEqual(['wish', 'inventar']);
    expect(stepsOf('ship')).toEqual(['wish', 'hangar']);
    expect(stepsOf('upcoming')).toEqual(['wish']);
    expect(setup().svc.read('upcoming', 'idris', 'Idris').hint).toBe('notYetInGame');
  });

  it('the stops are parallel: one item can be wished, open in a Nachschub and in Inventar', async () => {
    const { svc, supplies } = setup();
    await svc.moveToInventar('item', 'helmet_01', 'Helm', 'Port Olisar', 2);
    supplies.addLine('Helm', 1, 'helmet_01');
    await svc.addWish('item', 'helmet_01', 'Helm');
    const s = svc.state('item', 'helmet_01', 'Helm')();
    expect(s.wished).toBeTrue();
    expect(s.nachschubQty).toBe(1);
    expect(s.inventarQty).toBe(2);
    expect(s.places).toEqual([{ location: 'Port Olisar', qty: 2 }]);
  });

  it('counts a manual stock entry stored as <kind>:<Class> like a bare class name', () => {
    const { svc, stock } = setup();
    stock.set([{ location: 'Lorville', name: 'Gold', class_name: 'item:Gold', qty: 3, unit: 'pcs' }]);
    expect(svc.read('item', 'Gold').inventarQty).toBe(3);
    expect(svc.read('item', 'Gold').places).toEqual([{ location: 'Lorville', qty: 3 }]);
  });

  it('Inventar closes a matching Nachschub line; undo reopens it and takes the stock back', async () => {
    const { svc, lines, stock, supplies } = setup();
    supplies.addLine('A', 2, 'a');
    const res = await svc.moveToInventar('item', 'a', 'A', 'Lorville', 2);
    expect(res.key).toBe('itemPath.done.inventar');
    expect(stock()[0]).toEqual(jasmine.objectContaining({ location: 'Lorville', class_name: 'a', qty: 2 }));
    expect(lines[0].done).toBeTrue();
    await res.undo!();
    expect(stock().length).toBe(0);
    expect(lines[0].done).toBeFalse();
  });

  it('A8: the default place is the live location while the game runs, else "Bei mir"', () => {
    const live = { presence: { gameRunning: true, at: new Date().toISOString() }, location: { name: 'Area18' } };
    expect(setup({ live }).svc.currentPlaceDefault()).toBe('Area18');
    TestBed.resetTestingModule();
    expect(setup({ live: null }).svc.currentPlaceDefault()).toBe(PLACE_WITH_ME);
    TestBed.resetTestingModule();
    const stale = { ...live, presence: { gameRunning: true, at: '2020-01-01T00:00:00Z' } };
    expect(setup({ live: stale }).svc.currentPlaceDefault()).toBe(PLACE_WITH_ME);
  });

  it('A8: an empty place falls back to the default place', async () => {
    const { svc, stock } = setup();
    await svc.moveToInventar('item', 'a', 'A', '  ', 1);
    expect(stock()[0].location).toBe(PLACE_WITH_ME);
  });

  it('a blueprint is collected into Inventar at the blueprint place', async () => {
    const { svc } = setup();
    await svc.moveToInventar('blueprint', 'bp_1', 'Plan', 'irgendwo', 5);
    expect(svc.read('blueprint', 'bp_1').places.map((p) => p.location)).toEqual(['Blueprints']);
  });

  it('#303: "Ich habe diese" marks a blueprint as owned and takes the mark off again', async () => {
    const { svc, stock } = setup();
    stock.set([{ location: 'Lorville', name: 'Gold', class_name: 'item:Gold', qty: 3, unit: 'pcs' }]);
    expect(svc.ownedBlueprints().size).toBe(0);
    expect((await svc.setBlueprintOwned('BP_Rifle', 'Rifle', true)).ok).toBeTrue();
    expect([...svc.ownedBlueprints()]).toEqual(['BP_Rifle']);
    expect((await svc.setBlueprintOwned('BP_Rifle', 'Rifle', false)).ok).toBeTrue();
    expect(svc.ownedBlueprints().size).toBe(0);
    expect(stock().map((i) => i.name)).toEqual(['Gold']);
  });

  it('#303: signed out the blueprint mark is not written', async () => {
    const { svc, stock } = setup({ user: false });
    expect((await svc.setBlueprintOwned('BP_Rifle', 'Rifle', true)).key).toBe('itemPath.err.failed');
    expect(stock().length).toBe(0);
  });

  it('signed out nothing is written', async () => {
    const { svc, rows, ships } = setup({ user: false });
    expect((await svc.addWish('item', 'a', 'A')).key).toBe('itemPath.err.failed');
    expect((await svc.addToHangar('idris', 'Idris')).ok).toBeFalse();
    expect(rows().length + ships().length).toBe(0);
  });

  describe('tone: a refusal is not an error (AUD-2)', () => {
    it('a step this kind does not have is refused neutrally; a real failure stays an error', async () => {
      const { svc } = setup({ storeFails: true });
      const refused = await svc.moveToInventar('ship', 'idris', 'Idris', 'Lorville', 1);
      expect(refused.ok).toBeFalse();
      expect(refused.tone).toBe('info');
      expect(isPathError(refused)).toBeFalse();
      const failed = await svc.addWish('item', 'a', 'A');
      expect(failed.key).toBe('itemPath.err.failed');
      expect(isPathError(failed)).toBeTrue();
    });
  });

  describe('ships: an owned ship can be wished again (AUD-1, r1 "second copy allowed")', () => {
    it('a ship not in the Hangar is wished as the hangar row; an owned one keeps its row and the wish goes to the list', async () => {
      const { svc, ship, rows } = setup();
      await svc.addWish('ship', 'cutlass', 'Cutlass');
      expect(ship('cutlass')!.status).toBe('wishlist');
      expect(rows().length).toBe(0);

      await svc.addToHangar('starlancer', 'Starlancer');
      const res = await svc.addWish('ship', 'starlancer', 'Starlancer');
      expect(res.ok).toBeTrue();
      expect(res.key).toBe('itemPath.done.wishOn');
      expect(ship('starlancer')!.status).toBe('owned');
      expect(rows().map((r) => [r.kind, r.className, r.qty])).toEqual([['ship', 'starlancer', 1]]);
      const s = svc.read('ship', 'starlancer');
      expect([s.wished, s.wishQty, s.inHangar, s.hangarQty]).toEqual([true, 1, true, 1]);
    });

    it('the wished quantity of an owned ship is a counter like any other, and undo takes the wish off again', async () => {
      const { svc, wishlist, rows, ship } = setup();
      await svc.addToHangar('starlancer', 'Starlancer');
      const res = await svc.addWish('ship', 'starlancer', 'Starlancer');
      expect((await svc.setWishQty('ship', 'starlancer', 'Starlancer', 3)).ok).toBeTrue();
      expect(svc.read('ship', 'starlancer').wishQty).toBe(3);
      expect(wishlist.count()).toBe(1);
      await res.undo!();
      expect(rows().length).toBe(0);
      expect(ship('starlancer')!.status).toBe('owned');
    });

    it('both homes count once: list size, has and quantity agree', async () => {
      const { svc, wishlist } = setup();
      await svc.addWish('ship', 'cutlass', 'Cutlass');
      await svc.setWishQty('ship', 'cutlass', 'Cutlass', 2);
      await svc.addToHangar('starlancer', 'Starlancer');
      await svc.addWish('ship', 'starlancer', 'Starlancer');
      expect(wishlist.count()).toBe(2);
      expect([wishlist.qtyOf('ship', 'cutlass'), wishlist.qtyOf('ship', 'starlancer')]).toEqual([2, 1]);
    });
  });

  describe('ships: buying a wished ship (owning fulfils the wish)', () => {
    it('wished 3, buy 1: one copy owned, 2 still wished; undo restores the 3 wished', async () => {
      const { svc, ship, rows } = setup();
      await svc.addWish('ship', 'idris', 'Idris');
      await svc.setWishQty('ship', 'idris', 'Idris', 3);
      const res = await svc.addToHangar('idris', 'Idris');
      expect(res.key).toBe('itemPath.done.ownWishLeft');
      expect(res.params).toEqual({ name: 'Idris', left: 2 });
      expect([ship('idris')!.status, ship('idris')!.qty]).toEqual(['owned', 1]);
      const s = svc.read('ship', 'idris');
      expect([s.inHangar, s.hangarQty, s.wished, s.wishQty]).toEqual([true, 1, true, 2]);

      await res.undo!();
      expect([ship('idris')!.status, ship('idris')!.qty]).toEqual(['wishlist', 3]);
      expect(rows().length).toBe(0);
    });

    it('wished once, buy 1: the wish is fulfilled, nothing is left on the list', async () => {
      const { svc, ship, rows } = setup();
      await svc.addWish('ship', 'idris', 'Idris');
      const res = await svc.addToHangar('idris', 'Idris');
      expect(res.key).toBe('itemPath.done.ownWish');
      expect([ship('idris')!.status, ship('idris')!.qty]).toEqual(['owned', 1]);
      expect(rows().length).toBe(0);
      expect(svc.read('ship', 'idris').wished).toBeFalse();
    });

    it('an owned ship gets a second copy through the edge rule, and its wish shrinks by one', async () => {
      const { svc, ship, edge, rows } = setup();
      await svc.addToHangar('starlancer', 'Starlancer');
      await svc.addWish('ship', 'starlancer', 'Starlancer');
      await svc.setWishQty('ship', 'starlancer', 'Starlancer', 2);
      const res = await svc.addToHangar('starlancer', 'Starlancer');
      expect(edge.addShipCopy).toHaveBeenCalledOnceWith('starlancer');
      expect(ship('starlancer')!.qty).toBe(2);
      expect(res.key).toBe('itemPath.done.ownWishLeft');
      expect(rows()[0].qty).toBe(1);
      await res.undo!();
      expect(ship('starlancer')!.qty).toBe(1);
      expect(rows()[0].qty).toBe(2);
    });

    it('an owned, unwished ship just counts one more copy', async () => {
      const { svc, ship } = setup();
      await svc.addToHangar('starlancer', 'Starlancer');
      const res = await svc.addToHangar('starlancer', 'Starlancer');
      expect(res.key).toBe('itemPath.done.hangarCopy');
      expect(res.params).toEqual({ name: 'Starlancer', n: 2 });
      expect(ship('starlancer')!.qty).toBe(2);
    });

    it('a wish that cannot stay keeps the purchase out too', async () => {
      const { svc, ship } = setup({ storeFails: true });
      await svc.addWish('ship', 'idris', 'Idris');
      await svc.setWishQty('ship', 'idris', 'Idris', 3);
      const res = await svc.addToHangar('idris', 'Idris');
      expect(res.ok).toBeFalse();
      expect([ship('idris')!.status, ship('idris')!.qty]).toEqual(['wishlist', 3]);
    });
  });

  describe('owning fulfils the wish: Inventar (AUD-4)', () => {
    it('wished 3, 2 land in Inventar: 1 stays wished; undo restores stock and wish', async () => {
      const { svc, rows, stock } = setup();
      await svc.addWish('item', 'medpen', 'Medpen');
      await svc.setWishQty('item', 'medpen', 'Medpen', 3);
      const res = await svc.moveToInventar('item', 'medpen', 'Medpen', 'Lorville', 2);
      expect(res.key).toBe('itemPath.done.ownWishLeft');
      expect(res.params).toEqual({ name: 'Medpen', left: 1 });
      expect(rows()[0].qty).toBe(1);
      await res.undo!();
      expect(stock().length).toBe(0);
      expect(rows()[0].qty).toBe(3);
    });

    it('enough arrived: the wish goes, the toast says it is fulfilled', async () => {
      const { svc, rows } = setup();
      await svc.addWish('item', 'medpen', 'Medpen');
      const res = await svc.moveToInventar('item', 'medpen', 'Medpen', 'Lorville', 2);
      expect(res.key).toBe('itemPath.done.ownWish');
      expect(rows().length).toBe(0);
    });

    it('collecting a wished blueprint fulfils its wish', async () => {
      const { svc, rows } = setup();
      await svc.addWish('blueprint', 'BP_Rifle', 'Rifle');
      await svc.setBlueprintOwned('BP_Rifle', 'Rifle', true);
      expect(rows().length).toBe(0);
    });

    it('nothing wished: the plain Inventar toast', async () => {
      const { svc } = setup();
      expect((await svc.moveToInventar('item', 'medpen', 'Medpen', 'Lorville', 1)).key).toBe('itemPath.done.inventar');
    });
  });

  describe('an arrival on a Nachschub line (harden B/C/E)', () => {
    const packageLine = (lines: Line[], qty: number): Line => {
      const l: Line = { id: 'p1', name: 'Medpen', qty, done: false, className: 'medpen', amount: null, unit: null, packageId: 'n1' };
      lines.push(l);
      return l;
    };

    it('leaves the line to the stock rise: no second count, reconcile closes it', async () => {
      const { svc, lines, active, nachschub } = setup();
      active.set([{ id: 'n1' }]);
      const l = packageLine(lines, 10);
      const res = await svc.moveToInventar('item', 'medpen', 'Medpen', 'Lorville', 6);
      expect(res.ok).toBeTrue();
      expect(l.qty).toBe(10);
      expect(l.done).toBeFalse();
      expect(nachschub.reconcile).toHaveBeenCalled();
    });

    it('a split take keeps the leftover wish: what the line asked for does not shrink it', async () => {
      const { svc, lines, active, wishlist } = setup();
      active.set([{ id: 'n1' }]);
      packageLine(lines, 5);
      await wishlist.setQty('item', 'medpen', 'Medpen', 15);
      await svc.moveToInventar('item', 'medpen', 'Medpen', 'Lorville', 5);
      expect(wishlist.qtyOf('item', 'medpen', 'Medpen')).toBe(15);
      await svc.moveToInventar('item', 'medpen', 'Medpen', 'Lorville', 7);
      expect(wishlist.qtyOf('item', 'medpen', 'Medpen')).toBe(13);
    });

    it('undo brings back a Nachschub the arrival finished and archived', async () => {
      const { svc, lines, active, nachschub } = setup();
      active.set([{ id: 'n1' }]);
      const l = packageLine(lines, 2);
      const res = await svc.moveToInventar('item', 'medpen', 'Medpen', 'Lorville', 2);
      l.done = true;
      active.set([]);
      expect((await res.undo!()).ok).toBeTrue();
      expect(nachschub.reactivate).toHaveBeenCalledWith('n1');
      expect(l.done).toBeFalse();
    });

    it('a line of an archived Nachschub is a loose line: it shrinks as before', async () => {
      const { svc, lines } = setup();
      const l = packageLine(lines, 10);
      await svc.moveToInventar('item', 'medpen', 'Medpen', 'Lorville', 6);
      expect(l.qty).toBe(4);
    });
  });
});
