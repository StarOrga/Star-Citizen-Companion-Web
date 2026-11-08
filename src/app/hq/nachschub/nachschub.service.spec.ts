import { computed, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideTranslateService } from '@ngx-translate/core';
import { AuthService } from '../../auth/auth.service';
import { HangarService } from '../../hangar/hangar.service';
import { FakeCall, FakeResult, chainArgs, fakeSupabase } from '../../testing/fake-supabase';
import { HqInventoryService } from '../data/hq-inventory.service';
import { WishlistStore } from '../data/wishlist.store';
import { HqSuppliesService } from '../hq-supplies.service';
import { NachschubFocusService } from './nachschub-focus.service';
import { NachschubNamingService } from './nachschub-naming';
import type { Nachschub } from './nachschub.model';
import { NachschubService } from './nachschub.service';

interface Ln {
  id: string;
  name: string;
  qty: number;
  amount: number | null;
  unit: null;
  done: boolean;
  entityKind: string | null;
  className: string | null;
  forClassName: string | null;
  packageId: string | null;
  deletedAt: string | null;
}

/** The slice of HqSuppliesService the Nachschub service uses, in memory. */
class FakeSupplies {
  readonly rows = signal<Ln[]>([]);
  readonly items = computed(() => this.rows().filter((r) => !r.deletedAt));
  max = 100;
  private n = 0;

  addLine(name: string, qty: number, meta: { entityKind?: string; className?: string; forClassName?: string | null; packageId?: string | null } = {}) {
    if (this.items().length >= this.max) return null;
    const pkg = meta.packageId ?? null;
    const same = this.items().find((i) => !i.done && i.name.toLowerCase() === name.toLowerCase() && i.packageId === pkg && (i.forClassName ?? '') === (meta.forClassName ?? ''));
    if (same) {
      this.rows.update((rs) => rs.map((r) => (r.id === same.id ? { ...r, qty: r.qty + qty } : r)));
      return { id: same.id, prevQty: same.qty, prevAmount: null };
    }
    const id = `L${++this.n}`;
    this.rows.update((rs) => [
      ...rs,
      { id, name, qty, amount: null, unit: null, done: false, entityKind: meta.entityKind ?? null, className: meta.className ?? null, forClassName: meta.forClassName ?? null, packageId: pkg, deletedAt: null },
    ]);
    return { id, prevQty: 0, prevAmount: null };
  }
  linesOfPackage(id: string) {
    return this.items().filter((i) => i.packageId === id);
  }
  removeMany(ids: readonly string[]) {
    this.rows.update((rs) => rs.map((r) => (ids.includes(r.id) ? { ...r, deletedAt: 'x' } : r)));
  }
  remove(id: string) {
    this.removeMany([id]);
  }
  restore(id: string) {
    this.rows.update((rs) => rs.map((r) => (r.id === id ? { ...r, deletedAt: null } : r)));
  }
  setLine(id: string, qty: number) {
    this.rows.update((rs) => rs.map((r) => (r.id === id ? { ...r, qty } : r)));
  }
  setDone(id: string, done: boolean) {
    this.rows.update((rs) => rs.map((r) => (r.id === id ? { ...r, done } : r)));
  }
}

interface WishRow {
  kind: string;
  className: string;
  name: string | null;
  qty: number;
  forClassName: string;
}

class FakeWish {
  readonly rows = signal<WishRow[]>([]);
  /** Class names whose write fails. */
  failOn = new Set<string>();
  async setQty(e: { kind: string; className: string; name?: string | null; forClassName?: string | null }, qty: number): Promise<boolean> {
    if (this.failOn.has(e.className)) return false;
    const f = e.forClassName ?? '';
    const hit = this.rows().find((r) => r.kind === e.kind && r.className === e.className && r.forClassName === f);
    if (qty <= 0) {
      this.rows.update((rs) => rs.filter((r) => r !== hit));
    } else if (hit) {
      this.rows.update((rs) => rs.map((r) => (r === hit ? { ...r, qty } : r)));
    } else {
      this.rows.update((rs) => [...rs, { kind: e.kind, className: e.className, name: e.name ?? null, qty, forClassName: f }]);
    }
    return true;
  }
  qty(className: string): number {
    return this.rows().find((r) => r.className === className)?.qty ?? 0;
  }
}

interface ServerPkg {
  user_id: string;
  id: string;
  name: string;
  status: 'active' | 'archived';
  slot: number | null;
  snapshot: Record<string, number>;
  archived_at: string | null;
  deleted_at: string | null;
  created_at: string;
  updated_at: string;
}

const row = (id: string, slot: number | null, patch: Partial<ServerPkg> = {}): ServerPkg => ({
  user_id: 'u1',
  id,
  name: id,
  status: slot === null ? 'archived' : 'active',
  slot,
  snapshot: {},
  archived_at: null,
  deleted_at: null,
  created_at: '2026-11-07T10:00:00Z',
  updated_at: '2026-11-07T10:00:00Z',
  ...patch,
});

const toNach = (r: ServerPkg): Nachschub => ({ id: r.id, name: r.name, status: r.status, slot: r.slot, snapshot: r.snapshot, createdAt: r.created_at, archivedAt: r.archived_at });

describe('NachschubService', () => {
  let server: ServerPkg[];
  /** Hooks into the fake server. */
  let conflictOnce: (() => void) | null;
  let failDrop: boolean;
  let supplies: FakeSupplies;
  let wish: FakeWish;
  let inventory: { items: ReturnType<typeof signal<{ class_name: string | null; qty: number }[]>>; loaded: ReturnType<typeof signal<boolean>>; error: ReturnType<typeof signal<string | null>>; load: () => Promise<void> };
  let calls: FakeCall[];
  let svc: NachschubService;

  const answer = (call: FakeCall): FakeResult => {
    if (call.target !== 'hq_supply_packages') return { data: null };
    const upsert = chainArgs(call, 'upsert');
    if (upsert) {
      const r = upsert[0] as ServerPkg;
      if (r.status === 'active' && conflictOnce) {
        const hook = conflictOnce;
        conflictOnce = null;
        hook();
      }
      if (r.status === 'active' && server.some((s) => s.id !== r.id && !s.deleted_at && s.status === 'active' && s.slot === r.slot)) {
        return { error: { code: '23505', message: 'duplicate key' } };
      }
      const i = server.findIndex((s) => s.id === r.id);
      const next = { ...row(r.id, r.slot), ...r } as ServerPkg;
      if (i >= 0) server[i] = next;
      else server.push(next);
      return { data: null };
    }
    const update = chainArgs(call, 'update');
    if (update) {
      const cols = update[0] as Partial<ServerPkg>;
      if (failDrop && cols.deleted_at) return { error: { code: '500', message: 'boom' } };
      const id = chainArgs(call, 'eq') ? (call.chain.filter(([m]) => m === 'eq').map(([, a]) => a).find((a) => a[0] === 'id') as unknown[])[1] : null;
      const liveOnly = !!chainArgs(call, 'is');
      const hit = server.find((s) => s.id === id && (!liveOnly || !s.deleted_at));
      if (hit) {
        if (cols.slot && cols.status !== 'archived' && server.some((s) => s !== hit && !s.deleted_at && s.status === 'active' && s.slot === cols.slot)) {
          return { error: { code: '23505', message: 'duplicate key' } };
        }
        Object.assign(hit, cols);
      }
      return { data: hit ? [{ id: hit.id }] : [] };
    }
    return { data: server.filter((s) => !s.deleted_at) };
  };

  beforeEach(() => {
    TestBed.resetTestingModule();
    server = [];
    conflictOnce = null;
    failDrop = false;
    supplies = new FakeSupplies();
    wish = new FakeWish();
    inventory = { items: signal([]), loaded: signal(true), error: signal<string | null>(null), load: () => Promise.resolve() };
    const fake = fakeSupabase({ answer });
    calls = fake.calls;
    TestBed.configureTestingModule({
      providers: [
        fake.provider,
        { provide: AuthService, useValue: { user: signal({ id: 'u1' }) } },
        { provide: HqSuppliesService, useValue: supplies },
        { provide: WishlistStore, useValue: wish },
        { provide: HqInventoryService, useValue: inventory },
        { provide: HangarService, useValue: { ships: signal([]), error: signal(null), loadAll: () => Promise.resolve(), shipByClassName: () => undefined } },
        { provide: NachschubNamingService, useValue: { nachschubName: () => Promise.resolve('Auto') } },
      ],
    });
    svc = TestBed.inject(NachschubService);
  });

  const addWish = (className: string, qty: number, forClassName = '') => wish.rows.update((rs) => [...rs, { kind: 'item', className, name: className, qty, forClassName }]);
  const upserts = () => calls.filter((c) => chainArgs(c, 'upsert')).length;
  const create = (picks: { key: string; qty?: number }[], name = 'N') => svc.createFromWishlist({ picks, name });

  describe('createFromWishlist', () => {
    it('H3: a pick without a line stays on the wishlist and the result says so', async () => {
      addWish('medpen', 2);
      addWish('rattler', 1);
      supplies.max = 1;
      const r = await create([{ key: 'item:medpen' }, { key: 'item:rattler' }]);
      expect(r.ok).toBeTrue();
      expect(r.warn).toEqual({ key: 'hq.nachschub.partial', params: { count: 1 } });
      expect(wish.qty('medpen')).toBe(0);
      expect(wish.qty('rattler')).toBe(1);
      expect(supplies.items().length).toBe(1);
    });

    it('H3: with no line at all nothing is saved and the wishlist stays', async () => {
      addWish('medpen', 2);
      supplies.max = 0;
      const r = await create([{ key: 'item:medpen' }]);
      expect(r).toEqual({ ok: false, key: 'hq.nachschub.linesFull' });
      expect(upserts()).toBe(0);
      expect(server.length).toBe(0);
      expect(svc.packages().length).toBe(0);
      expect(wish.qty('medpen')).toBe(2);
    });

    it('AUD-10: a failing wishlist write rolls everything back and reports it', async () => {
      addWish('medpen', 2);
      addWish('rattler', 1);
      wish.failOn.add('rattler');
      const r = await create([{ key: 'item:medpen' }, { key: 'item:rattler' }]);
      expect(r).toEqual({ ok: false, key: 'hq.nachschub.wishlistFailed' });
      expect(wish.qty('medpen')).toBe(2);
      expect(wish.qty('rattler')).toBe(1);
      expect(supplies.items().length).toBe(0);
      expect(svc.packages().length).toBe(0);
      expect(server[0].deleted_at).not.toBeNull();
    });

    it('M6: reads the slots fresh, so a slot taken in another tab is not offered', async () => {
      await svc.ensureLoaded();
      server.push(row('other', 1));
      addWish('medpen', 1);
      const r = await create([{ key: 'item:medpen' }]);
      expect(r.ok).toBeTrue();
      expect(upserts()).toBe(1);
      expect(server.find((s) => s.id === r.id)?.slot).toBe(2);
    });

    it('M6: a unique violation on the slot is retried with the next free slot', async () => {
      conflictOnce = () => server.push(row('other', 1));
      addWish('medpen', 1);
      const r = await create([{ key: 'item:medpen' }]);
      expect(r.ok).toBeTrue();
      expect(upserts()).toBe(2);
      expect(server.find((s) => s.id === r.id)?.slot).toBe(2);
      expect(svc.packages().find((p) => p.id === r.id)?.slot).toBe(2);
    });

    it('M2: a baseline comes from loaded stock only', async () => {
      inventory.items.set([{ class_name: 'medpen', qty: 4 }]);
      addWish('medpen', 1);
      const ok = await create([{ key: 'item:medpen' }]);
      expect(Object.values(server.find((s) => s.id === ok.id)!.snapshot)).toEqual([4]);

      // Stock not loaded: no baseline is stored (the first reconcile after the load takes it).
      TestBed.resetTestingModule();
      server = [];
      inventory.loaded.set(false);
      TestBed.configureTestingModule({
        providers: [
          fakeSupabase({ answer }).provider,
          { provide: AuthService, useValue: { user: signal({ id: 'u1' }) } },
          { provide: HqSuppliesService, useValue: new FakeSupplies() },
          { provide: WishlistStore, useValue: wish },
          { provide: HqInventoryService, useValue: inventory },
          { provide: HangarService, useValue: { ships: signal([]), error: signal(null), loadAll: () => Promise.resolve(), shipByClassName: () => undefined } },
          { provide: NachschubNamingService, useValue: { nachschubName: () => Promise.resolve('Auto') } },
        ],
      });
      const cold = TestBed.inject(NachschubService);
      addWish('rattler', 1);
      const r = await cold.createFromWishlist({ picks: [{ key: 'item:rattler' }], name: 'Kalt' });
      expect(r.ok).toBeTrue();
      expect(server.find((s) => s.id === r.id)!.snapshot).toEqual({});
    });

    it('undo takes out exactly what the creation put in, and keeps a wish added meanwhile', async () => {
      addWish('medpen', 3);
      const r = await create([{ key: 'item:medpen' }]);
      addWish('rattler', 1);
      const u = await r.undo!();
      expect(u.ok).toBeTrue();
      expect(wish.qty('medpen')).toBe(3);
      expect(wish.qty('rattler')).toBe(1);
      expect(supplies.items().length).toBe(0);
      expect(svc.packages().length).toBe(0);
    });
  });

  describe('emptying and deleting', () => {
    it('M3: undo of "Leeren" puts back only its own change', async () => {
      addWish('medpen', 3);
      const made = await create([{ key: 'item:medpen' }]);
      const r = await svc.empty(made.id!, true);
      expect(wish.qty('medpen')).toBe(3);
      addWish('rattler', 2); // a wish added during the toast window
      wish.rows.update((rs) => rs.map((x) => (x.className === 'medpen' ? { ...x, qty: 4 } : x))); // and one more medpen
      const u = await r.undo!();
      expect(u.ok).toBeTrue();
      expect(wish.qty('rattler')).toBe(2);
      expect(wish.qty('medpen')).toBe(1);
      expect(supplies.linesOfPackage(made.id!).length).toBe(1);
    });

    it('L1: merging back above 999 says how much was lost, and the undo restores the exact quantity', async () => {
      addWish('medpen', 600);
      const made = await create([{ key: 'item:medpen' }]);
      addWish('medpen', 600);
      const r = await svc.empty(made.id!, true);
      expect(wish.qty('medpen')).toBe(999);
      expect(r.warn).toEqual({ key: 'hq.nachschub.wishCapped', params: { count: 201 } });
      await r.undo!();
      expect(wish.qty('medpen')).toBe(600);
    });

    it('AUD-10: a failing wishlist write leaves the lines where they are', async () => {
      addWish('medpen', 3);
      const made = await create([{ key: 'item:medpen' }]);
      wish.failOn.add('medpen');
      const r = await svc.empty(made.id!, true);
      expect(r).toEqual({ ok: false, key: 'hq.nachschub.wishlistFailed' });
      expect(supplies.linesOfPackage(made.id!).length).toBe(1);
    });

    it('M8: when the delete fails nothing is left half done', async () => {
      addWish('medpen', 3);
      const made = await create([{ key: 'item:medpen' }]);
      failDrop = true;
      const r = await svc.remove(made.id!, true);
      expect(r.ok).toBeFalse();
      expect(supplies.linesOfPackage(made.id!).length).toBe(1);
      expect(wish.qty('medpen')).toBe(0);
      expect(svc.packages().some((p) => p.id === made.id)).toBeTrue();
    });

    it('M7: undoing a delete when the slot was taken meanwhile uses the next free slot', async () => {
      addWish('medpen', 1);
      const made = await create([{ key: 'item:medpen' }]);
      const r = await svc.remove(made.id!, false);
      server.push(row('other', 1));
      const u = await r.undo!();
      expect(u.ok).toBeTrue();
      const back = server.find((s) => s.id === made.id)!;
      expect(back.deleted_at).toBeNull();
      expect(back.slot).toBe(2);
      expect(supplies.linesOfPackage(made.id!).length).toBe(1);
    });

    it('M7: with every slot taken the undo says so and restores nothing', async () => {
      addWish('medpen', 1);
      const made = await create([{ key: 'item:medpen' }]);
      const r = await svc.remove(made.id!, false);
      for (let s = 1; s <= 7; s++) server.push(row(`o${s}`, s));
      const u = await r.undo!();
      expect(u).toEqual({ ok: false, key: 'hq.nachschub.slotsFull' });
      expect(supplies.linesOfPackage(made.id!).length).toBe(0);
      expect(server.find((s) => s.id === made.id)!.deleted_at).not.toBeNull();
    });
  });

  describe('addFromWishlist', () => {
    it('M5: a pick landing on an existing line keeps its baseline, and the undo only lowers the quantity', async () => {
      inventory.items.set([{ class_name: 'medpen', qty: 5 }]);
      addWish('medpen', 2);
      const made = await create([{ key: 'item:medpen' }]);
      const lineId = supplies.linesOfPackage(made.id!)[0].id;
      expect(svc.packages()[0].snapshot[lineId]).toBe(5);

      inventory.items.set([{ class_name: 'medpen', qty: 7 }]);
      addWish('medpen', 3);
      const r = await svc.addFromWishlist(made.id!, [{ key: 'item:medpen' }]);
      expect(r.ok).toBeTrue();
      expect(supplies.linesOfPackage(made.id!)[0].qty).toBe(5);
      expect(svc.packages()[0].snapshot[lineId]).toBe(5);

      const u = await r.undo!();
      expect(u.ok).toBeTrue();
      const lines = supplies.linesOfPackage(made.id!);
      expect(lines.length).toBe(1);
      expect(lines[0].qty).toBe(2);
      expect(wish.qty('medpen')).toBe(3);
    });

    it('a new line gets a baseline of its own and the undo removes only that line', async () => {
      addWish('medpen', 1);
      const made = await create([{ key: 'item:medpen' }]);
      inventory.items.set([{ class_name: 'rattler', qty: 6 }]);
      addWish('rattler', 1);
      const r = await svc.addFromWishlist(made.id!, [{ key: 'item:rattler' }]);
      const added = supplies.linesOfPackage(made.id!).find((l) => l.className === 'rattler')!;
      expect(svc.packages()[0].snapshot[added.id]).toBe(6);
      await r.undo!();
      expect(supplies.linesOfPackage(made.id!).map((l) => l.className)).toEqual(['medpen']);
    });
  });

  describe('package writes (M6)', () => {
    it('a stale rename does not bring a deleted Nachschub back', async () => {
      server.push(row('a', 1));
      await svc.ensureLoaded();
      server[0].deleted_at = '2026-11-08T10:00:00Z'; // deleted on another device
      expect(await svc.rename('a', 'Neu')).toBeFalse();
      expect(svc.packages().length).toBe(0);
      expect(server[0].deleted_at).not.toBeNull();
      expect(upserts()).toBe(0);
    });

    it('a rename sends only the name', async () => {
      server.push(row('a', 1));
      await svc.ensureLoaded();
      expect(await svc.rename('a', 'Neu')).toBeTrue();
      const upd = calls.find((c) => chainArgs(c, 'update'))!;
      expect(Object.keys(chainArgs(upd, 'update')![0] as object).sort()).toEqual(['name', 'updated_at']);
    });

    it('reactivate reads the slots fresh and takes the next free one on a clash', async () => {
      server.push(row('old', null, { archived_at: '2026-11-01T00:00:00Z' }));
      await svc.ensureLoaded();
      server.push(row('other', 1));
      const r = await svc.reactivate('old');
      expect(r.ok).toBeTrue();
      expect(server.find((s) => s.id === 'old')?.slot).toBe(2);
    });
  });

  describe('reconcile', () => {
    const seed = async (...ids: [string, string][]) => {
      let t = 0;
      for (const [id] of ids) server.push(row(id, ids.findIndex((x) => x[0] === id) + 1, { created_at: `2026-11-0${++t}T10:00:00Z` }));
      await svc.ensureLoaded();
    };
    const line = (pkg: string, className: string, qty = 1) => supplies.addLine(className, qty, { className, entityKind: 'item', packageId: pkg })!.id;

    it('H4: one gained unit closes the line of the older Nachschub only', async () => {
      await seed(['a', ''], ['b', '']);
      const la = line('a', 'laser');
      const lb = line('b', 'laser');
      server[0].snapshot = { [la]: 0 };
      server[1].snapshot = { [lb]: 0 };
      await svc.ensureLoaded();
      await svc.reload();
      inventory.items.set([{ class_name: 'laser', qty: 1 }]);
      await svc.reconcile();
      expect(supplies.items().find((l) => l.id === la)!.done).toBeTrue();
      expect(supplies.items().find((l) => l.id === lb)!.done).toBeFalse();
      expect(svc.packages().find((p) => p.id === 'a')!.status).toBe('archived');
      expect(svc.packages().find((p) => p.id === 'b')!.status).toBe('active');
    });

    it('M1: a baseline above the stock is lowered and stored', async () => {
      await seed(['a', '']);
      const la = line('a', 'laser', 5);
      server[0].snapshot = { [la]: 10 };
      await svc.reload();
      inventory.items.set([]);
      await svc.reconcile();
      expect(server[0].snapshot[la]).toBe(0);
      inventory.items.set([{ class_name: 'laser', qty: 5 }]);
      await svc.reconcile();
      expect(supplies.items().find((l) => l.id === la)!.done).toBeTrue();
    });

    it('M2: nothing is compared while the stock failed to load', async () => {
      await seed(['a', '']);
      const la = line('a', 'laser');
      server[0].snapshot = { [la]: 0 };
      await svc.reload();
      inventory.items.set([{ class_name: 'laser', qty: 1 }]);
      inventory.error.set('errors.generic');
      const before = calls.length;
      await svc.reconcile();
      expect(supplies.items()[0].done).toBeFalse();
      expect(calls.slice(before).some((c) => chainArgs(c, 'update'))).toBeFalse();
    });

    it('M2: a migrated line (no baseline) starts counting at the stock of the first pass, then a purchase closes it', async () => {
      await seed(['a', '']);
      const la = line('a', 'laser');
      await svc.reload();
      inventory.items.set([{ class_name: 'laser', qty: 2 }]);
      await svc.reconcile();
      expect(server[0].snapshot[la]).toBe(2);
      expect(supplies.items()[0].done).toBeFalse();
      inventory.items.set([{ class_name: 'laser', qty: 3 }]);
      await svc.reconcile();
      expect(supplies.items()[0].done).toBeTrue();
    });

    it('AUD-8: a manual row and a cargo crate close the lines they stand for', async () => {
      await seed(['a', '']);
      const lw = line('a', 'Laser_S1');
      const lm = supplies.addLine('Iron', 2, { className: 'Iron', entityKind: 'material', packageId: 'a' })!.id;
      server[0].snapshot = { [lw]: 0, [lm]: 0 };
      await svc.reload();
      inventory.items.set([
        { class_name: 'weapon:Laser_S1', qty: 1 },
        { class_name: 'Carryable_TBO_FL_32SCU_Commodity_Metal_Iron', qty: 2 },
      ]);
      await svc.reconcile();
      expect(supplies.items().every((l) => l.done)).toBeTrue();
    });
  });
});

describe('NachschubFocusService (M10)', () => {
  beforeEach(() => {
    localStorage.removeItem('sc.hq.nachschub.focus');
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [provideTranslateService(), fakeSupabase().provider, { provide: AuthService, useValue: { user: signal(null) } }],
    });
  });
  afterEach(() => localStorage.removeItem('sc.hq.nachschub.focus'));

  it('Jetzt keeps a focused Nachschub that archived; Planen falls back to an active one', () => {
    const ns = TestBed.inject(NachschubService);
    const focus = TestBed.inject(NachschubFocusService);
    ns.packages.set([toNach(row('a', 1)), toNach(row('b', 2))]);
    focus.select('b');
    expect(focus.current()?.id).toBe('b');
    ns.packages.set([toNach(row('a', 1)), toNach(row('b', null, { archived_at: '2026-11-08T00:00:00Z' }))]);
    expect(focus.current()?.id).toBe('b');
    expect(focus.current()?.status).toBe('archived');
    expect(focus.selected()?.id).toBe('a');
  });

  it('a Nachschub that no longer exists falls back to the first active one', () => {
    const ns = TestBed.inject(NachschubService);
    const focus = TestBed.inject(NachschubFocusService);
    ns.packages.set([toNach(row('a', 1))]);
    focus.select('gone');
    expect(focus.current()?.id).toBe('a');
  });
});
