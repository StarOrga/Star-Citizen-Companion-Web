import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { AuthService } from '../../auth/auth.service';
import { SupabaseClientProvider } from '../../core/supabase.client';
import { WishlistStore } from './wishlist.store';

describe('WishlistStore', () => {
  it('drops a load that finishes after the user changed', async () => {
    const user = signal<{ id: string } | null>({ id: 'a' });
    const pending: ((v: { data: unknown[]; error: null }) => void)[] = [];
    const client = { from: () => ({ select: () => new Promise((r) => pending.push(r)) }) };
    TestBed.configureTestingModule({
      providers: [
        { provide: AuthService, useValue: { user } },
        { provide: SupabaseClientProvider, useValue: { client } },
      ],
    });
    const store = TestBed.inject(WishlistStore);
    const forA = store.ensureLoaded();
    user.set({ id: 'b' });
    const forB = store.ensureLoaded();
    pending[1]({ data: [{ entity_kind: 'item', class_name: 'mine_b' }], error: null });
    await forB;
    pending[0]({ data: [{ entity_kind: 'item', class_name: 'secret_a' }], error: null });
    await forA;
    expect(store.rows().map((r) => r.className)).toEqual(['mine_b']);
    expect(store.loaded()).toBeTrue();
  });

  describe('quantity', () => {
    function setup() {
      const calls: { op: string; args: unknown[] }[] = [];
      const chain = (op: string, result: unknown) => {
        const c: Record<string, unknown> = {};
        const self = (...args: unknown[]) => {
          calls.push({ op, args });
          return c;
        };
        for (const m of ['eq', 'select']) c[m] = self;
        c['single'] = () => Promise.resolve(result);
        c['then'] = (res: (v: unknown) => void) => res({ error: null });
        return c;
      };
      const client = {
        from: () => ({
          insert: (row: Record<string, unknown>) => {
            calls.push({ op: 'insert', args: [row] });
            return chain('ins', { data: { ...row, created_at: '2026-11-07T10:00:00Z' }, error: null });
          },
          update: (row: unknown) => {
            calls.push({ op: 'update', args: [row] });
            return chain('upd.eq', null);
          },
          delete: () => {
            calls.push({ op: 'delete', args: [] });
            return chain('del.eq', null);
          },
        }),
      };
      TestBed.configureTestingModule({
        providers: [
          { provide: AuthService, useValue: { user: signal({ id: 'u' }) } },
          { provide: SupabaseClientProvider, useValue: { client } },
        ],
      });
      return { store: TestBed.inject(WishlistStore), calls };
    }

    it('a first add writes qty 1; a further add leaves the quantity (the cart opens instead)', async () => {
      const { store, calls } = setup();
      expect(await store.add({ kind: 'item', className: 'rattler', name: 'Rattler' })).toBeTrue();
      expect(store.qtyOf('item', 'rattler')).toBe(1);
      expect(calls.find((c) => c.op === 'insert')?.args[0]).toEqual(jasmine.objectContaining({ qty: 1, for_class_name: '' }));
      expect(await store.add({ kind: 'item', className: 'rattler', name: 'Rattler' })).toBeTrue();
      expect(store.qtyOf('item', 'rattler')).toBe(1);
    });

    it('setQty updates, addQty counts up, qty 0 removes', async () => {
      const { store } = setup();
      await store.add({ kind: 'item', className: 'rattler', qty: 3 });
      expect(store.qtyOf('item', 'rattler')).toBe(3);
      await store.setQty({ kind: 'item', className: 'rattler' }, 20);
      expect(store.qtyOf('item', 'rattler')).toBe(20);
      await store.addQty({ kind: 'item', className: 'rattler' }, 5);
      expect(store.qtyOf('item', 'rattler')).toBe(25);
      await store.setQty({ kind: 'item', className: 'rattler' }, 0);
      expect(store.has('item', 'rattler')).toBeFalse();
    });

    it('clamps to 1..999', async () => {
      const { store } = setup();
      await store.setQty({ kind: 'item', className: 'x' }, 5000);
      expect(store.qtyOf('item', 'x')).toBe(999);
    });

    it('keeps the same material wished for two blueprints apart and sums them in totalQty', async () => {
      const { store } = setup();
      await store.add({ kind: 'material', className: 'alu', qty: 2, forClassName: 'gallant' });
      await store.add({ kind: 'material', className: 'alu', qty: 3, forClassName: 'p4ar' });
      expect(store.rows().length).toBe(2);
      expect(store.qtyOf('material', 'alu', null, 'gallant')).toBe(2);
      expect(store.totalQty('material', 'alu')).toBe(5);
      await store.remove('material', 'alu', null, 'gallant');
      expect(store.totalQty('material', 'alu')).toBe(3);
    });
  });
});
