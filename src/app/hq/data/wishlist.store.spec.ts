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
});
