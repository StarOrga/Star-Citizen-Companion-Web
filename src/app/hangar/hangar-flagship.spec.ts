import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { AuthService } from '../auth/auth.service';
import { SupabaseClientProvider } from '../core/supabase.client';
import { HangarService } from './hangar.service';

// Focused coverage for the flagship (pinned standard ship) capability:
// single-flagship exclusivity, toggle semantics, and the DB-first persistence
// added by migration 20260705140500 (profiles.flagship_ship_class as source
// of truth, localStorage as offline cache + one-time migration source).
describe('HangarService flagship', () => {
  const USER_ID = 'user-abc';
  const LS_KEY = `sc.hangar.flagship.${USER_ID}`;
  const MIGRATED_KEY = `sc.hangar.flagship.migrated.${USER_ID}`;

  // Chainable supabase-js stub: every builder method returns the chain, the
  // chain is thenable (loadAll awaits it directly) and exposes maybeSingle().
  // `updates` records update() payloads per table for write-through asserts.
  interface StubClient {
    client: unknown;
    updates: { table: string; values: Record<string, unknown> }[];
  }
  function makeStubClient(profileRow: Record<string, unknown> | null = null): StubClient {
    const updates: StubClient['updates'] = [];
    const from = (table: string) => {
      const result =
        table === 'profiles'
          ? { data: profileRow, error: null }
          : { data: [], error: null };
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const chain: any = {};
      for (const m of ['select', 'eq', 'order', 'insert', 'delete']) {
        chain[m] = () => chain;
      }
      chain.update = (values: Record<string, unknown>) => {
        updates.push({ table, values });
        return chain;
      };
      chain.maybeSingle = () => Promise.resolve(result);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      chain.then = (res: any, rej: any) => Promise.resolve(result).then(res, rej);
      return chain;
    };
    return { client: { from }, updates };
  }

  function makeService(stub?: StubClient): HangarService {
    const auth = { user: signal({ id: USER_ID }) } as unknown as AuthService;
    const sb = { client: stub?.client ?? {} } as unknown as SupabaseClientProvider;
    TestBed.configureTestingModule({
      providers: [
        HangarService,
        { provide: AuthService, useValue: auth },
        { provide: SupabaseClientProvider, useValue: sb },
      ],
    });
    return TestBed.inject(HangarService);
  }

  beforeEach(() => localStorage.clear());
  afterEach(() => {
    TestBed.resetTestingModule();
    localStorage.clear();
  });

  it('sets and clears the flagship, keeping a single value', () => {
    const svc = makeService();
    expect(svc.flagshipClassName()).toBeNull();

    svc.setFlagship('AEGS_Gladius');
    expect(svc.flagshipClassName()).toBe('AEGS_Gladius');
    expect(svc.isFlagship('AEGS_Gladius')).toBeTrue();

    // Pinning a new flagship un-pins the previous (single flagship).
    svc.setFlagship('ANVL_Arrow');
    expect(svc.flagshipClassName()).toBe('ANVL_Arrow');
    expect(svc.isFlagship('AEGS_Gladius')).toBeFalse();

    svc.setFlagship(null);
    expect(svc.flagshipClassName()).toBeNull();
  });

  it('toggleFlagship pins when unset and clears when it already is the flagship', () => {
    const svc = makeService();
    svc.toggleFlagship('AEGS_Gladius');
    expect(svc.isFlagship('AEGS_Gladius')).toBeTrue();
    svc.toggleFlagship('AEGS_Gladius');
    expect(svc.isFlagship('AEGS_Gladius')).toBeFalse();
  });

  it('persists the flagship to per-user localStorage and rehydrates it', () => {
    const svc = makeService();
    svc.setFlagship('AEGS_Gladius');
    expect(localStorage.getItem(LS_KEY)).toBe('AEGS_Gladius');

    // A fresh service instance for the same user reads the stored flagship.
    TestBed.resetTestingModule();
    const svc2 = makeService();
    expect(svc2.flagshipClassName()).toBe('AEGS_Gladius');
  });

  it('writes the flagship through to profiles.flagship_ship_class', async () => {
    const stub = makeStubClient();
    const svc = makeService(stub);
    svc.setFlagship('AEGS_Gladius');
    await Promise.resolve(); // let the fire-and-forget write settle
    expect(stub.updates).toContain(
      jasmine.objectContaining({
        table: 'profiles',
        values: { flagship_ship_class: 'AEGS_Gladius' },
      }),
    );
  });

  it('loadAll adopts the remote flagship over a stale local cache (DB wins)', async () => {
    localStorage.setItem(LS_KEY, 'OLD_Ship');
    localStorage.setItem(MIGRATED_KEY, '1');
    const svc = makeService(makeStubClient({ flagship_ship_class: 'ANVL_Arrow' }));
    await svc.loadAll();
    expect(svc.flagshipClassName()).toBe('ANVL_Arrow');
    expect(localStorage.getItem(LS_KEY)).toBe('ANVL_Arrow');
  });

  it('promotes a pre-column local pin to the DB exactly once', async () => {
    localStorage.setItem(LS_KEY, 'AEGS_Gladius'); // pin from before the column
    const stub = makeStubClient(null); // remote: nothing stored yet
    const svc = makeService(stub);
    await svc.loadAll();
    expect(svc.flagshipClassName()).toBe('AEGS_Gladius');
    expect(stub.updates).toContain(
      jasmine.objectContaining({
        table: 'profiles',
        values: { flagship_ship_class: 'AEGS_Gladius' },
      }),
    );
    expect(localStorage.getItem(MIGRATED_KEY)).toBe('1');

    // After the marker is set, a remote NULL means "cleared" and wins.
    await svc.loadAll();
    expect(svc.flagshipClassName()).toBeNull();
  });
});
