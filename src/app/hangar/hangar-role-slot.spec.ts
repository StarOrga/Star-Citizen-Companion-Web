import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { AuthService } from '../auth/auth.service';
import { SupabaseClientProvider } from '../core/supabase.client';
import { HangarService } from './hangar.service';
import { HangarRoleLoadout } from './hangar.types';

// setRoleLoadoutSlot (archive audit 2026-09-25): one slot merged against the
// SERVER copy of the set, guarded by updated_at, so two tabs equipping the same
// set keep each other's pieces instead of the later write deleting the first.
describe('HangarService.setRoleLoadoutSlot', () => {
  const row = (updatedAt: string, items: { slot: string; className: string; kind: string }[]) => ({
    id: 'set-1',
    user_id: 'u1',
    name: 'Recon',
    role: 'fps',
    items,
    created_at: '2026-01-01T00:00:00+00:00',
    updated_at: updatedAt,
  });

  /**
   * A scripted client: each read (`maybeSingle`) answers the next entry of
   * `reads`, each write (`update … select`) the next entry of `writes`, and the
   * written items plus their `updated_at` guard are recorded.
   */
  function makeClient(reads: unknown[], writes: unknown[][]) {
    const written: { items: unknown; guard: string | undefined }[] = [];
    const from = () => {
      let guard: string | undefined;
      let payload: { items?: unknown } | undefined;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const chain: any = {
        select: () => chain,
        is: () => chain,
        eq: (column: string, value: string) => {
          if (column === 'updated_at') guard = value;
          return chain;
        },
        maybeSingle: () => Promise.resolve({ data: reads.shift() ?? null, error: null }),
        update: (values: { items?: unknown }) => {
          payload = values;
          return chain;
        },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        then: (res: any, rej: any) => {
          written.push({ items: payload?.items, guard });
          return Promise.resolve({ data: writes.shift() ?? [], error: null }).then(res, rej);
        },
      };
      return chain;
    };
    return { client: { from }, written };
  }

  function makeService(client: unknown, cached: HangarRoleLoadout[] = []): HangarService {
    TestBed.configureTestingModule({
      providers: [
        HangarService,
        { provide: AuthService, useValue: { user: signal({ id: 'u1' }) } as unknown as AuthService },
        { provide: SupabaseClientProvider, useValue: { client } as unknown as SupabaseClientProvider },
      ],
    });
    const svc = TestBed.inject(HangarService);
    svc.roleLoadouts.set(cached);
    return svc;
  }

  it('merges into the server copy, keeping a slot another tab wrote in between', async () => {
    const helmetFromOtherTab = { slot: 'helmet', className: 'rsi_helmet_01', kind: 'item' };
    const stub = makeClient(
      [row('t1', []), row('t2', [helmetFromOtherTab])],
      // first write: the row moved on (0 rows) · second write: lands
      [[], [row('t3', [helmetFromOtherTab, { slot: 'core', className: 'rsi_torso_01', kind: 'item' }])]],
    );
    const svc = makeService(stub.client);

    const saved = await svc.setRoleLoadoutSlot('set-1', 'core', { className: 'rsi_torso_01', kind: 'item' });

    expect(stub.written.map((w) => w.guard)).toEqual(['t1', 't2']);
    expect(stub.written[1].items).toEqual([helmetFromOtherTab, { slot: 'core', className: 'rsi_torso_01', kind: 'item' }]);
    expect(saved?.items.map((i) => i.slot)).toEqual(['helmet', 'core']);
  });

  it('gives up after a second conflict — null, and the shared banner stays clear', async () => {
    const stub = makeClient([row('t1', []), row('t2', [])], [[], []]);
    const svc = makeService(stub.client);

    const saved = await svc.setRoleLoadoutSlot('set-1', 'core', { className: 'x', kind: 'item' });

    expect(saved).toBeNull();
    // Both callers report a refused write inline; `error` drives the hangar
    // banner and the set page's load-failure card, so it must not carry this.
    expect(svc.error()).toBeNull();
  });

  it('clears a slot with a null piece', async () => {
    const stub = makeClient(
      [row('t1', [{ slot: 'primary', className: 'behr_rifle_ballistic_01', kind: 'weapon' }])],
      [[row('t2', [])]],
    );
    const svc = makeService(stub.client);

    await svc.setRoleLoadoutSlot('set-1', 'primary', null);

    expect(stub.written[0].items).toEqual([]);
  });

  it('refreshes a cached set but never inserts one into an unfilled cache', async () => {
    const fresh = row('t2', [{ slot: 'core', className: 'rsi_torso_01', kind: 'item' }]);
    const cachedSet: HangarRoleLoadout = {
      id: 'set-1', name: 'Recon', role: 'fps', items: [], createdAt: 'c', updatedAt: 't1',
    };

    const known = makeService(makeClient([row('t1', [])], [[fresh]]).client, [cachedSet]);
    await known.setRoleLoadoutSlot('set-1', 'core', { className: 'rsi_torso_01', kind: 'item' });
    expect(known.roleLoadouts()[0].items.length).toBe(1);

    TestBed.resetTestingModule();
    // A tab opened straight on /codex/fps has an empty cache: inserting the one
    // set would make it look like the user's only set.
    const unfilled = makeService(makeClient([row('t1', [])], [[fresh]]).client, []);
    await unfilled.setRoleLoadoutSlot('set-1', 'core', { className: 'rsi_torso_01', kind: 'item' });
    expect(unfilled.roleLoadouts()).toEqual([]);
  });

  it('reports a set it cannot read (deleted, or not the reader\'s) without writing', async () => {
    const stub = makeClient([null], []);
    const svc = makeService(stub.client);

    expect(await svc.setRoleLoadoutSlot('gone', 'core', null)).toBeNull();
    expect(stub.written.length).toBe(0);
    expect(svc.error()).toBeNull();
  });

  it('keeps a newer piece another tab put in the slot when a stale clear arrives', async () => {
    // Tab A still shows the C54 in primary; tab B has since put a P4-AR there.
    const p4ar = { slot: 'primary', className: 'behr_rifle_ballistic_01', kind: 'weapon' };
    const cachedSet: HangarRoleLoadout = {
      id: 'set-1', name: 'Recon', role: 'fps',
      items: [{ slot: 'primary', className: 'gmni_smg_energy_01', kind: 'weapon' }],
      createdAt: 'c', updatedAt: 't1',
    };
    const stub = makeClient([row('t2', [p4ar])], []);
    const svc = makeService(stub.client, [cachedSet]);

    const back = await svc.setRoleLoadoutSlot('set-1', 'primary', null, 'gmni_smg_energy_01');

    expect(stub.written.length).toBe(0);
    expect(back?.items).toEqual([p4ar]);
    // The fresh copy replaces the stale cached one, so the page shows the P4-AR.
    expect(svc.roleLoadouts()[0].items).toEqual([p4ar]);
  });

  /** A client whose read answers `read` and whose write answers `write` (both `{ data, error }`). */
  function failingClient(read: unknown, write: unknown = { data: [], error: null }) {
    const from = () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const chain: any = {
        select: () => chain,
        is: () => chain,
        eq: () => chain,
        update: () => chain,
        maybeSingle: () => Promise.resolve(read),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        then: (res: any, rej: any) => Promise.resolve(write).then(res, rej),
      };
      return chain;
    };
    return { from };
  }

  it('logs a refused read instead of failing silently (AUD-255), banner stays clear', async () => {
    const warn = spyOn(console, 'warn');
    const rlsError = { message: 'permission denied for table hangar_role_loadouts', code: '42501' };
    const svc = makeService(failingClient({ data: null, error: rlsError }));

    expect(await svc.setRoleLoadoutSlot('set-1', 'core', null)).toBeNull();
    expect(warn).toHaveBeenCalledWith('[hangar] slot write refused', jasmine.objectContaining({ id: 'set-1', slot: 'core', error: rlsError }));
    expect(svc.error()).toBeNull();
  });

  it('logs a refused write instead of failing silently (AUD-255)', async () => {
    const warn = spyOn(console, 'warn');
    const writeError = { message: 'new row violates row-level security policy', code: '42501' };
    const svc = makeService(failingClient({ data: row('t1', []), error: null }, { data: null, error: writeError }));

    expect(await svc.setRoleLoadoutSlot('set-1', 'core', { className: 'x', kind: 'item' })).toBeNull();
    expect(warn).toHaveBeenCalledWith('[hangar] slot write refused', jasmine.objectContaining({ id: 'set-1', slot: 'core', error: writeError }));
    expect(svc.error()).toBeNull();
  });

  it('clears the slot while it still holds the piece the caller showed', async () => {
    const stub = makeClient(
      [row('t1', [{ slot: 'primary', className: 'gmni_smg_energy_01', kind: 'weapon' }])],
      [[row('t2', [])]],
    );
    const svc = makeService(stub.client);

    await svc.setRoleLoadoutSlot('set-1', 'primary', null, 'gmni_smg_energy_01');

    expect(stub.written).toEqual([{ items: [], guard: 't1' }]);
  });
});

// getShip / getRoleLoadout (audit D05 step 7, AUD-050): a failed read throws so
// the page can offer a retry; only a missing row is "not found" (null).
describe('HangarService.getShip / getRoleLoadout', () => {
  function serviceAnswering(answer: unknown): HangarService {
    const from = () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const chain: any = {
        select: () => chain,
        is: () => chain,
        eq: () => chain,
        maybeSingle: () => Promise.resolve(answer),
      };
      return chain;
    };
    TestBed.configureTestingModule({
      providers: [
        HangarService,
        { provide: AuthService, useValue: { user: signal({ id: 'u1' }) } as unknown as AuthService },
        { provide: SupabaseClientProvider, useValue: { client: { from } } as unknown as SupabaseClientProvider },
      ],
    });
    return TestBed.inject(HangarService);
  }

  const fetchError = { message: 'TypeError: Failed to fetch', code: '' };

  it('getShip throws a failed read instead of reporting "not found"', async () => {
    const svc = serviceAnswering({ data: null, error: fetchError });
    await expectAsync(svc.getShip('ship-1')).toBeRejectedWith(fetchError);
  });

  it('getShip returns null when no row exists', async () => {
    const svc = serviceAnswering({ data: null, error: null });
    expect(await svc.getShip('ship-1')).toBeNull();
  });

  it('getRoleLoadout throws a failed read and returns null for a missing row', async () => {
    await expectAsync(serviceAnswering({ data: null, error: fetchError }).getRoleLoadout('set-1')).toBeRejectedWith(fetchError);
    TestBed.resetTestingModule();
    expect(await serviceAnswering({ data: null, error: null }).getRoleLoadout('set-1')).toBeNull();
  });
});
