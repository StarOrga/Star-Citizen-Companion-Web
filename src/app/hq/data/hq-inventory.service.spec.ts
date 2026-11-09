import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { AuthService } from '../../auth/auth.service';
import { SupabaseClientProvider } from '../../core/supabase.client';
import type { HqInventoryItemRow } from './hq-db.types';
import { HqInventoryService } from './hq-inventory.service';

/** A chainable, awaitable stand-in for a PostgREST builder: every call returns itself, awaiting yields `result`. */
function builder(result: { data: unknown; error: unknown }, calls: string[]) {
  const b: Record<string, unknown> = {};
  const proxy: object = new Proxy(b, {
    get: (_t, prop) => {
      if (prop === 'then') return (res: (v: unknown) => unknown) => res(result);
      return (...args: unknown[]) => {
        calls.push(String(prop) + (prop === 'update' ? JSON.stringify(args[0]) : ''));
        return proxy;
      };
    },
  });
  return proxy;
}

describe('HqInventoryService.endReservation', () => {
  function make(fail: boolean) {
    const calls: string[] = [];
    const result = { data: [], error: fail ? { message: 'boom', code: '500' } : null };
    TestBed.configureTestingModule({
      providers: [
        { provide: SupabaseClientProvider, useValue: { client: { from: () => builder(result, calls) } } },
        { provide: AuthService, useValue: { user: signal({ id: 'u1' }) } },
      ],
    });
    const svc = TestBed.inject(HqInventoryService);
    // After "add 3, reserve 4, undo add" the row holds 2 pieces but 4 stay reserved.
    svc.items.set([
      { location: 'L', name: 'Item', qty: 2, unit: 'pcs', class_name: null, reservations: [{ amount: 4, note: 'x', at: '2026-11-09T00:00:00Z' }] } as unknown as HqInventoryItemRow,
    ]);
    return { svc, calls };
  }

  it('hands out more than is left: the row goes instead of a silent refusal', async () => {
    const { svc, calls } = make(false);
    expect(await svc.endReservation({ location: 'L', name: 'Item' }, 0, true)).toBe(true);
    expect(calls).toContain('delete');
    expect(svc.error()).toBeNull();
  });

  it('a refused write always sets an error', async () => {
    const { svc } = make(false);
    expect(await svc.setAmount({ location: 'L', name: 'Item' }, 1e12)).toBe(false);
    expect(svc.error()).toBe('errors.generic');
  });
});
