import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { AuthService } from '../auth/auth.service';
import { SupabaseClientProvider } from '../core/supabase.client';
import { HangarService } from './hangar.service';
import { HangarShip } from './hangar.types';

// AUD-111 (plan D02 step 8): two devices pinning / activating concurrently.
// The DB keeps one ship per slot (hangar_ships_pin_unique) and one active
// config per ship (hangar_ship_configs_one_active); the service turns the
// resulting 23505 into one re-read + one retry instead of a raw error banner.
describe('HangarService unique-slot retry', () => {
  const USER_ID = 'user-abc';
  type Result = { data: unknown; error: { code?: string; message: string } | null };

  interface Call {
    table: string;
    op: 'update' | 'select';
    values?: Record<string, unknown>;
    filters: [string, ...unknown[]][];
  }

  /**
   * Chainable supabase-js stub. Every awaited chain (or `.single()`) pops the
   * next scripted result for its "table:op" key; unscripted calls resolve to
   * `{ data: null, error: null }`. `calls` records each chain for asserts.
   */
  function makeStub(script: Record<string, Result[]>) {
    const calls: Call[] = [];
    const next = (call: Call): Promise<Result> => {
      const queue = script[`${call.table}:${call.op}`] ?? [];
      return Promise.resolve(queue.shift() ?? { data: null, error: null });
    };
    const from = (table: string) => {
      const call: Call = { table, op: 'select', filters: [] };
      calls.push(call);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const chain: any = {};
      chain.update = (values: Record<string, unknown>) => {
        call.op = 'update';
        call.values = values;
        return chain;
      };
      chain.select = () => chain;
      for (const m of ['eq', 'not', 'order']) {
        chain[m] = (...args: unknown[]) => {
          call.filters.push([m, ...args]);
          return chain;
        };
      }
      chain.single = () => next(call);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      chain.then = (res: any, rej: any) => next(call).then(res, rej);
      return chain;
    };
    return { client: { from }, calls };
  }

  function makeService(client: unknown): HangarService {
    const auth = { user: signal({ id: USER_ID }) } as unknown as AuthService;
    TestBed.configureTestingModule({
      providers: [
        HangarService,
        { provide: AuthService, useValue: auth },
        { provide: SupabaseClientProvider, useValue: { client } },
      ],
    });
    return TestBed.inject(HangarService);
  }

  const ship = (id: string, pinnedRank: number | null): HangarShip => ({
    id,
    shipClassName: `CLS_${id}`,
    customName: null,
    status: 'owned',
    pinnedRank,
    selectedSkinId: null,
    notes: null,
    createdAt: '2026-09-01T00:00:00Z',
    updatedAt: '2026-09-01T00:00:00Z',
  } as HangarShip);

  const row = (id: string, pinned_rank: number | null) => ({
    id,
    ship_class_name: `CLS_${id}`,
    custom_name: null,
    status: 'owned',
    pinned_rank,
    selected_skin_id: null,
    notes: null,
    created_at: '2026-09-01T00:00:00Z',
    updated_at: '2026-09-01T00:00:00Z',
  });

  const conflict = { data: null, error: { code: '23505', message: 'duplicate key value violates unique constraint "hangar_ships_pin_unique"' } };

  afterEach(() => TestBed.resetTestingModule());

  it('pinShip: re-reads the real occupant after a 23505 and succeeds on the retry', async () => {
    const stub = makeStub({
      'hangar_ships:update': [
        conflict, // attempt 1: pin A to 1 (cache thinks slot 1 is free)
        { data: null, error: null }, // attempt 2: clear the real occupant B
        { data: row('A', 1), error: null }, // attempt 2: pin A
      ],
      // Another device pinned B to slot 1 and unpinned C meanwhile.
      'hangar_ships:select': [{ data: [{ id: 'B', pinned_rank: 1 }], error: null }],
    });
    const svc = makeService(stub.client);
    svc.ships.set([ship('A', null), ship('B', null), ship('C', 2)]);

    const ok = await svc.pinShip('A', 1);

    expect(ok).toBeTrue();
    expect(svc.error()).toBeNull();
    const byId = new Map(svc.ships().map((s) => [s.id, s.pinnedRank]));
    expect(byId.get('A')).toBe(1);
    expect(byId.get('B')).toBeNull(); // the real occupant was cleared
    expect(byId.get('C')).toBeNull(); // stale cached pin reconciled away
    const updates = stub.calls.filter((c) => c.op === 'update');
    expect(updates.map((c) => c.values)).toEqual([
      { pinned_rank: 1 },
      { pinned_rank: null },
      { pinned_rank: 1 },
    ]);
    expect(updates[1].filters).toContain(['eq', 'id', 'B']);
    const reread = stub.calls.find((c) => c.op === 'select');
    expect(reread?.filters).toContain(['not', 'pinned_rank', 'is', null]);
  });

  it('pinShip: a second 23505 fails with the error set, after exactly two attempts', async () => {
    const stub = makeStub({
      'hangar_ships:update': [conflict, conflict],
      'hangar_ships:select': [{ data: [], error: null }],
    });
    const svc = makeService(stub.client);
    svc.ships.set([ship('A', null)]);

    const ok = await svc.pinShip('A', 1);

    expect(ok).toBeFalse();
    expect(svc.error()).toContain('hangar_ships_pin_unique');
    const pinAttempts = stub.calls.filter((c) => c.op === 'update' && c.values?.['pinned_rank'] === 1);
    expect(pinAttempts.length).toBe(2);
  });

  it('pinShip: any other error fails at once without a retry', async () => {
    const stub = makeStub({
      'hangar_ships:update': [{ data: null, error: { code: '42501', message: 'denied' } }],
    });
    const svc = makeService(stub.client);
    svc.ships.set([ship('A', null)]);

    expect(await svc.pinShip('A', 1)).toBeFalse();
    expect(svc.error()).toBe('denied');
    expect(stub.calls.length).toBe(1);
  });

  it('activateConfig: retries clear + set once after a 23505', async () => {
    const stub = makeStub({
      'hangar_ship_configs:update': [
        { data: null, error: null }, // clear
        { data: null, error: { code: '23505', message: 'hangar_ship_configs_one_active' } },
        { data: null, error: null }, // clear again (removes the foreign activation)
        { data: null, error: null }, // set
      ],
    });
    const svc = makeService(stub.client);

    expect(await svc.activateConfig('cfg-1', 'ship-1')).toBeTrue();
    expect(svc.error()).toBeNull();
    expect(stub.calls.map((c) => c.values)).toEqual([
      { is_active: false },
      { is_active: true },
      { is_active: false },
      { is_active: true },
    ]);
    expect(stub.calls[2].filters).toEqual([
      ['eq', 'hangar_ship_id', 'ship-1'],
      ['eq', 'is_active', true],
    ]);
  });

  it('activateConfig: a second 23505 fails with the error set', async () => {
    const dup = { data: null, error: { code: '23505', message: 'hangar_ship_configs_one_active' } };
    const ok = { data: null, error: null };
    const stub = makeStub({ 'hangar_ship_configs:update': [ok, dup, ok, dup] });
    const svc = makeService(stub.client);

    expect(await svc.activateConfig('cfg-1', 'ship-1')).toBeFalse();
    expect(svc.error()).toBe('hangar_ship_configs_one_active');
    expect(stub.calls.length).toBe(4);
  });
});
