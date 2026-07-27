import { TestBed } from '@angular/core/testing';
import { ShowroomService } from './showroom.service';
import { ShipSkinsService } from './ship-skins.service';
import { SupabaseClientProvider } from '../core/supabase.client';
import { environment } from '../../environments/environment';

/** Fluent mock of the supabase chain used by list(): from().select().order(). */
function mockProvider(result: { data: unknown; error: unknown }, capture?: (c: any) => void) {
  const calls: any = { table: '', orderCol: '', fromCount: 0 };
  const q: any = {
    select: () => q,
    order: (col: string) => {
      calls.orderCol = col;
      return Promise.resolve(result);
    },
  };
  capture?.(calls);
  return {
    client: { from: (t: string) => { calls.table = t; calls.fromCount++; return q; } },
  } as unknown as SupabaseClientProvider;
}

function makeService(result: { data: unknown; error: unknown }, capture?: (c: any) => void) {
  TestBed.configureTestingModule({
    providers: [
      ShowroomService,
      ShipSkinsService,
      { provide: SupabaseClientProvider, useValue: mockProvider(result, capture) },
    ],
  });
  return TestBed.inject(ShowroomService);
}

const ROW = {
  ship_id: 'DRAK_Cutlass_Black',
  livery_count: 7,
  model_count: 7,
  poster_path: 'DRAK_Cutlass_Black/cypress.webp',
  sources: ['factory', 'pu_npc', 'store', 'subscriber'],
  latest_added: '2026-06-03T00:00:00Z',
};

describe('ShowroomService', () => {
  afterEach(() => TestBed.resetTestingModule());

  it('reads ship_skins_index ordered by latest_added and maps to ShowroomEntry', async () => {
    let cap: any;
    const svc = makeService({ data: [ROW], error: null }, (c) => (cap = c));
    const { entries, error } = await svc.list();
    expect(error).toBeFalse();
    expect(cap.table).toBe('ship_skins_index');
    expect(cap.orderCol).toBe('latest_added');
    expect(entries.length).toBe(1);
    expect(entries[0]).toEqual({
      shipId: 'DRAK_Cutlass_Black',
      liveryCount: 7,
      modelCount: 7,
      sources: ['factory', 'pu_npc', 'store', 'subscriber'],
      latestAdded: '2026-06-03T00:00:00Z',
      posterUrl:
        `${environment.supabase.url}/storage/v1/object/public/ship-skins/DRAK_Cutlass_Black/cypress.webp`,
    });
  });

  it('maps a null poster_path to a null posterUrl', async () => {
    const svc = makeService({ data: [{ ...ROW, poster_path: null }], error: null });
    const { entries } = await svc.list();
    expect(entries[0].posterUrl).toBeNull();
  });

  it('flags error:true on query failure (distinct from empty)', async () => {
    const svc = makeService({ data: null, error: { message: 'boom' } });
    await expectAsync(svc.list()).toBeResolvedTo({ entries: [], error: true });
  });

  it('load() fills entries and modelShipIds (only ships with >=1 model)', async () => {
    const svc = makeService({
      data: [ROW, { ...ROW, ship_id: 'NO_MODEL', model_count: 0, poster_path: null }],
      error: null,
    });
    await svc.load();
    expect(svc.entries().length).toBe(2);
    expect(svc.modelShipIds().has('DRAK_Cutlass_Black')).toBeTrue();
    expect(svc.modelShipIds().has('NO_MODEL')).toBeFalse();
  });

  it('load() dedupes a concurrent burst and an already-loaded cache into one query', async () => {
    let cap: any;
    const svc = makeService({ data: [ROW], error: null }, (c) => (cap = c));
    // Many badges mount in the same render pass → all call load() before it resolves.
    await Promise.all([svc.load(), svc.load(), svc.load()]);
    expect(cap.fromCount).toBe(1); // shared in-flight query, not one per caller
    await svc.load(); // already loaded → short-circuits, no re-query
    expect(cap.fromCount).toBe(1);
  });

  it('load() clears the in-flight handle on failure so a later call can retry', async () => {
    let cap: any;
    const svc = makeService({ data: null, error: { message: 'boom' } }, (c) => (cap = c));
    await svc.load();
    expect(svc.entries().length).toBe(0); // error swallowed, cache stays empty
    await svc.load(); // not loaded + no in-flight → retries
    expect(cap.fromCount).toBe(2);
  });
});
