import { TestBed } from '@angular/core/testing';
import { ShipSkinsService } from './ship-skins.service';
import { SupabaseClientProvider } from '../core/supabase.client';
import { environment } from '../../environments/environment';

/** Minimal fluent mock of the supabase query chain used by listSkins(). */
function mockProvider(result: { data: unknown; error: unknown }, capture?: (c: any) => void) {
  const calls: any = { table: '', eqCol: '', eqVal: '' };
  const q: any = {
    select: () => q,
    eq: (col: string, val: string) => {
      calls.eqCol = col;
      calls.eqVal = val;
      return q;
    },
    order: () => Promise.resolve(result),
  };
  capture?.(calls);
  return {
    client: {
      from: (t: string) => {
        calls.table = t;
        return q;
      },
    },
  } as unknown as SupabaseClientProvider;
}

function makeService(result: { data: unknown; error: unknown }, capture?: (c: any) => void) {
  TestBed.configureTestingModule({
    providers: [
      ShipSkinsService,
      { provide: SupabaseClientProvider, useValue: mockProvider(result, capture) },
    ],
  });
  return TestBed.inject(ShipSkinsService);
}

describe('ShipSkinsService', () => {
  afterEach(() => TestBed.resetTestingModule());

  describe('assetUrl', () => {
    it('returns null for nullish/empty path', () => {
      const svc = makeService({ data: [], error: null });
      expect(svc.assetUrl(null)).toBeNull();
      expect(svc.assetUrl(undefined)).toBeNull();
      expect(svc.assetUrl('')).toBeNull();
    });

    it('builds a public ship-skins URL and strips leading slashes', () => {
      const svc = makeService({ data: [], error: null });
      const url = svc.assetUrl('/DRAK_Cutlass_Black/pirate.glb');
      expect(url).toBe(
        `${environment.supabase.url}/storage/v1/object/public/ship-skins/DRAK_Cutlass_Black/pirate.glb`,
      );
    });
  });

  describe('listSkins', () => {
    it('returns empty (no error) for empty shipId without querying', async () => {
      const svc = makeService({ data: null, error: { message: 'should not run' } });
      await expectAsync(svc.listSkins('')).toBeResolvedTo({ skins: [], error: false });
    });

    it('maps DB rows to ShipSkin and queries by ship_id', async () => {
      let cap: any;
      const svc = makeService(
        {
          data: [
            {
              ship_id: 'DRAK_Cutlass_Black',
              skin_id: 'pirate',
              name: 'Cutlass Skull and Crossbones Livery',
              description: 'Arr.',
              source: 'store',
              name_verified: true,
              model_path: 'DRAK_Cutlass_Black/pirate.glb',
              icon_path: 'DRAK_Cutlass_Black/pirate.webp',
              model_bytes: 2657524,
              sort: 100,
            },
          ],
          error: null,
        },
        (c) => (cap = c),
      );
      const { skins, error } = await svc.listSkins('DRAK_Cutlass_Black');
      expect(error).toBeFalse();
      expect(cap.table).toBe('ship_skins');
      expect(cap.eqCol).toBe('ship_id');
      expect(cap.eqVal).toBe('DRAK_Cutlass_Black');
      expect(skins.length).toBe(1);
      expect(skins[0]).toEqual(
        jasmine.objectContaining({
          shipId: 'DRAK_Cutlass_Black',
          skinId: 'pirate',
          name: 'Cutlass Skull and Crossbones Livery',
          nameVerified: true,
          modelPath: 'DRAK_Cutlass_Black/pirate.glb',
          source: 'store',
        }),
      );
    });

    it('defaults nullish description/source/sort', async () => {
      const svc = makeService({
        data: [
          {
            ship_id: 'X',
            skin_id: 'a',
            name: 'A',
            description: null,
            source: null,
            name_verified: null,
            model_path: null,
            icon_path: null,
            model_bytes: null,
            sort: null,
          },
        ],
        error: null,
      });
      const { skins } = await svc.listSkins('X');
      const s = skins[0];
      expect(s.description).toBe('');
      expect(s.source).toBe('store');
      expect(s.nameVerified).toBeFalse();
      expect(s.sort).toBe(100);
    });

    it('flags error:true on query failure (distinct from empty)', async () => {
      const svc = makeService({ data: null, error: { message: 'boom' } });
      await expectAsync(svc.listSkins('X')).toBeResolvedTo({ skins: [], error: true });
    });
  });
});
