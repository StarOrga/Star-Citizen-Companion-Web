import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { AuthService } from '../../auth/auth.service';
import { CodexService } from '../../codex/codex.service';
import { SearchWishlistService } from '../../codex/search/search-wishlist.service';
import { HangarService } from '../../hangar/hangar.service';
import { HqSuppliesService, type SupplyItem } from '../hq-supplies.service';
import { HqLiveService } from '../now/hq-live.service';
import { HqInventoryService } from './hq-inventory.service';
import { ItemPathService, PLACE_WITH_ME, materialLines, stepsOf } from './item-path.service';

interface Line { id: string; name: string; qty: number; done: boolean; className: string }
interface Stock { location: string; name: string; class_name: string | null; qty: number; unit: 'pcs' }

interface Ingredient { ingredientClassName: string | null; nameLocalized: string | null; entityKind: string | null; quantity: number }

let syncFails = false;

function setup(opts: { user?: boolean; live?: Record<string, unknown> | null; recipe?: Ingredient[] | 'fails' } = {}) {
  const wished = new Set<string>();
  const lines: Line[] = [];
  const stock = signal<Stock[]>([]);
  const ships = new Map<string, { id: string; status: 'owned' | 'wishlist' }>();
  let n = 0;
  const wk = (k: string, c: string) => `${k}:${c.toLowerCase()}`;
  const wishlist = {
    has: (k: string, c: string) => wished.has(wk(k, c)),
    add: async (k: string, c: string) => (wished.add(wk(k, c)), true),
    remove: async (k: string, c: string) => (wished.delete(wk(k, c)), true),
  };
  syncFails = false;
  const supplies = {
    sync: async () => undefined,
    syncError: () => (syncFails ? 'errors.hq.syncSupplies' : null),
    addLine: (name: string, qty: number, meta: { className?: string | null }) => {
      const cls = meta.className ?? '';
      const same = lines.find((l) => !l.done && l.className === cls);
      if (same) {
        const prevQty = same.qty;
        same.qty += qty;
        return { id: same.id, prevQty };
      }
      lines.push({ id: `l${++n}`, name, qty, done: false, className: cls });
      return { id: `l${n}`, prevQty: 0 };
    },
    add: (name: string, qty: number, meta: { className?: string | null }) => !!supplies.addLine(name, qty, meta),
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
    remove: (id: string) => {
      lines.splice(lines.findIndex((l) => l.id === id), 1);
    },
  };
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
  const hangar = {
    shipByClassName: (c: string) => ships.get(c) ?? null,
    addShip: async (c: string, status: 'owned' | 'wishlist') => (ships.set(c, { id: `s-${c}`, status }), ships.get(c)),
    updateShip: async (id: string, p: { status: 'owned' | 'wishlist' }) => {
      for (const s of ships.values()) if (s.id === id) s.status = p.status;
      return true;
    },
    removeShip: async (id: string) => {
      for (const [k, s] of ships) if (s.id === id) ships.delete(k);
      return true;
    },
  };
  TestBed.configureTestingModule({
    providers: [
      { provide: AuthService, useValue: { user: () => (opts.user === false ? null : { id: 'u1' }) } },
      { provide: SearchWishlistService, useValue: wishlist },
      { provide: HqSuppliesService, useValue: supplies },
      { provide: HqInventoryService, useValue: inventory },
      { provide: HangarService, useValue: hangar },
      { provide: HqLiveService, useValue: { state: () => opts.live ?? null, events: () => [] } },
      {
        provide: CodexService,
        useValue: {
          getBlueprint: async (cls: string) => {
            if (opts.recipe === 'fails') throw new Error('offline');
            return opts.recipe ? { classNameSlug: cls, row: {}, ingredients: opts.recipe } : null;
          },
        },
      },
    ],
  });
  return { svc: TestBed.inject(ItemPathService), wished, lines, stock, ships };
}

describe('ItemPathService', () => {
  it('lists the stops per kind; an announced ship only has the wish', () => {
    expect(stepsOf('item')).toEqual(['wish', 'nachschub', 'inventar']);
    expect(stepsOf('blueprint')).toEqual(['wish', 'nachschub', 'inventar']);
    expect(stepsOf('ship')).toEqual(['wish', 'nachschub', 'hangar']);
    expect(stepsOf('upcoming')).toEqual(['wish']);
    expect(setup().svc.read('upcoming', 'idris', 'Idris').hint).toBe('notYetInGame');
  });

  it('A1: the steps are parallel - one item can be wished, in Nachschub and in Inventar', async () => {
    const { svc } = setup();
    await svc.addWish('item', 'helmet_01', 'Helm');
    await svc.moveToInventar('item', 'helmet_01', 'Helm', 'Port Olisar', 2);
    svc.nachholen('item', 'helmet_01', 'Helm', 1);
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

  it('A5: a push that fails keeps the wish and takes the line back out', async () => {
    const { svc, wished, lines } = setup();
    await svc.addWish('item', 'rifle_01', 'Gewehr');
    syncFails = true;
    const res = await svc.addToNachschub('item', 'rifle_01', 'Gewehr', 2);
    expect(res.ok).toBeFalse();
    expect(wished.has('item:rifle_01')).toBeTrue();
    expect(lines.length).toBe(0);
  });

  it('A5: Nachschub moves the wish and the toast undo restores it', async () => {
    const { svc, wished, lines } = setup();
    await svc.addWish('item', 'rifle_01', 'Gewehr');
    const res = await svc.addToNachschub('item', 'rifle_01', 'Gewehr', 2);
    expect(res.key).toBe('itemPath.done.moved');
    expect(wished.size).toBe(0);
    expect(svc.read('item', 'rifle_01').nachschubQty).toBe(2);
    await res.undo!();
    expect(wished.has('item:rifle_01')).toBeTrue();
    expect(lines.length).toBe(0);
  });

  it('A5: an unwished item merges into an existing line and undo restores the old quantity', async () => {
    const { svc, lines } = setup();
    await svc.addToNachschub('item', 'a', 'A', 1);
    const res = await svc.addToNachschub('item', 'a', 'A', 2);
    expect(lines[0].qty).toBe(3);
    await res.undo!();
    expect(lines[0].qty).toBe(1);
  });

  it('A6: Besorgt writes Inventar with the class name and closes the line; undo reopens it', async () => {
    const { svc, lines, stock } = setup();
    await svc.addToNachschub('item', 'a', 'A', 2);
    const res = await svc.moveToInventar('item', 'a', 'A', 'Lorville', 2);
    expect(stock()[0]).toEqual(jasmine.objectContaining({ location: 'Lorville', class_name: 'a', qty: 2 }));
    expect(lines[0].done).toBeTrue();
    await res.undo!();
    expect(stock().length).toBe(0);
    expect(lines[0].done).toBeFalse();
    expect(lines[0].qty).toBe(2);
  });

  it('A6: a partial delivery shrinks the line; "Nur abhaken" leaves Inventar alone', async () => {
    const { svc, lines, stock } = setup();
    await svc.addToNachschub('item', 'a', 'A', 5);
    await svc.moveToInventar('item', 'a', 'A', 'Lorville', 2);
    expect(lines[0].qty).toBe(3);
    expect(lines[0].done).toBeFalse();
    const tick = svc.tickOnly('a');
    expect(lines[0].done).toBeTrue();
    expect(stock()[0].qty).toBe(2);
    await tick.undo!();
    expect(lines[0].done).toBeFalse();
  });

  it('A7: Nachholen adds to Nachschub and leaves the stock untouched', async () => {
    const { svc, lines, stock } = setup();
    await svc.moveToInventar('item', 'a', 'A', 'Lorville', 4);
    const res = svc.nachholen('item', 'a', 'A', 3);
    expect(lines[0].qty).toBe(3);
    expect(stock()[0].qty).toBe(4);
    await res.undo!();
    expect(lines.length).toBe(0);
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

  it('A9: a blueprint is collected into Inventar at the blueprint place', async () => {
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

  it('ships: addToHangar flips a wished ship to owned and undo flips it back; upcoming has no Nachschub', async () => {
    const { svc, ships } = setup();
    ships.set('idris', { id: 's-idris', status: 'wishlist' });
    const res = await svc.addToHangar('idris', 'Idris');
    expect(ships.get('idris')!.status).toBe('owned');
    expect(svc.read('ship', 'idris').inHangar).toBeTrue();
    await res.undo!();
    expect(ships.get('idris')!.status).toBe('wishlist');
    expect((await svc.addToNachschub('upcoming', 'x', 'X')).ok).toBeFalse();
  });

  it('signed out nothing is written', async () => {
    const { svc, wished, lines } = setup({ user: false });
    expect((await svc.addWish('item', 'a', 'A')).key).toBe('itemPath.err.failed');
    expect((await svc.addToNachschub('item', 'a', 'A')).ok).toBeFalse();
    expect(wished.size + lines.length).toBe(0);
  });

  describe('A9: a blueprint brings its material to Nachschub', () => {
    const recipe: Ingredient[] = [
      { ingredientClassName: 'Agricium', nameLocalized: 'Agricium', entityKind: null, quantity: 0.36 },
      { ingredientClassName: 'Frame_Alu', nameLocalized: 'Aluminium', entityKind: 'item', quantity: 2.4 },
      { ingredientClassName: null, nameLocalized: null, entityKind: null, quantity: 1 },
    ];

    it('the wish moves and the toast undo takes blueprint and material out together', async () => {
      const { svc, lines, wished } = setup({ recipe });
      await svc.addWish('blueprint', 'BP_X', 'Laser Cannon');
      const res = await svc.addToNachschub('blueprint', 'BP_X', 'Laser Cannon', 1);
      expect(res.key).toBe('itemPath.done.movedMaterial');
      expect(wished.size).toBe(0);
      await res.undo!();
      expect(lines.length).toBe(0);
      expect(wished.has('blueprint:bp_x')).toBeTrue();
    });

    it('a recipe that cannot be read leaves the blueprint line plain', async () => {
      const { svc, lines } = setup({ recipe: 'fails' });
      const res = await svc.addToNachschub('blueprint', 'BP_X', 'Laser Cannon', 1);
      expect(res.ok).toBeTrue();
      expect(res.key).toBe('itemPath.done.nachschub');
      expect(lines.length).toBe(1);
    });

    it('an item brings no material, and a material the catalog cannot place is stocked like an item', async () => {
      const { svc, lines } = setup({ recipe });
      await svc.addToNachschub('item', 'rifle', 'Gewehr', 1);
      expect(lines.length).toBe(1);
      expect(materialLines(recipe).find((m) => m.className === 'Agricium')!.entityKind).toBe('item');
    });

    it('the same material in two slots is one line', () => {
      const two = [recipe[0], { ...recipe[0], quantity: 0.8 }];
      expect(materialLines(two)).toEqual([{ className: 'Agricium', name: 'Agricium', entityKind: 'item', amount: 1.16 }]);
    });
  });
});
