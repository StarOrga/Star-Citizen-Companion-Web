import { TestBed } from '@angular/core/testing';
import { SupabaseClientProvider } from '../../core/supabase.client';
import { AssetPackageService } from './asset-package.service';
import { manifestFixture } from './asset-package.model.spec';

function supabaseStub(result: { data: unknown[] | null; error: unknown }) {
  const calls: { col: string; v: unknown }[] = [];
  const q = {
    select: () => q,
    eq: (col: string, v: unknown) => (calls.push({ col, v }), q),
    in: (col: string, v: unknown) => (calls.push({ col, v }), q),
    limit: () => Promise.resolve(result),
  };
  return { calls, provider: { client: { from: jasmine.createSpy('from').and.returnValue(q) } } };
}

describe('AssetPackageService', () => {
  let fetchSpy: jasmine.Spy;

  function setup(result: { data: unknown[] | null; error: unknown }) {
    localStorage.removeItem('sc.assetPackages.devBase');
    const sb = supabaseStub(result);
    TestBed.configureTestingModule({ providers: [{ provide: SupabaseClientProvider, useValue: sb.provider }] });
    return { svc: TestBed.inject(AssetPackageService), sb };
  }

  beforeEach(() => {
    fetchSpy = spyOn(window, 'fetch');
  });

  it('returns the row of the first matching kind, null when none', async () => {
    const { svc, sb } = setup({
      data: [
        { kind: 'item', entity_class: 'GUN_A', manifest_sha256: 'mi' },
        { kind: 'fps_weapon', entity_class: 'GUN_A', manifest_sha256: 'mf' },
      ],
      error: null,
    });
    const row = await svc.findRow(['fps_weapon', 'item'], 'GUN_A');
    expect(row?.manifestSha256).toBe('mf');
    expect(sb.calls).toContain({ col: 'entity_class', v: 'GUN_A' });
    expect(await svc.findRow(['ship'], 'NOPE')).toBeNull();
  });

  it('throws a query error and does not cache it', async () => {
    const { svc } = setup({ data: null, error: { message: 'boom', code: '500' } });
    await expectAsync(svc.findRow(['ship'], 'AEGS_Gladius')).toBeRejected();
  });

  it('fetches + validates a manifest once per sha', async () => {
    const { svc } = setup({ data: [], error: null });
    fetchSpy.and.callFake(() => Promise.resolve(new Response(JSON.stringify(manifestFixture()))));
    const a = await svc.manifest('abc');
    const b = await svc.manifest('abc');
    expect(a).toBe(b);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(String(fetchSpy.calls.argsFor(0)[0])).toMatch(/_manifests\/abc\.json$/);
  });

  it('rejects on HTTP failure and retries on the next call', async () => {
    const { svc } = setup({ data: [], error: null });
    fetchSpy.and.returnValues(
      Promise.resolve(new Response('nope', { status: 503 })),
      Promise.resolve(new Response(new ArrayBuffer(4))),
    );
    await expectAsync(svc.glb('https://r2.test/_parts/x.glb')).toBeRejected();
    await new Promise((r) => setTimeout(r));
    const buf = await svc.glb('https://r2.test/_parts/x.glb');
    expect(buf.byteLength).toBe(4);
  });

  it('shares one download per GLB url', async () => {
    const { svc } = setup({ data: [], error: null });
    fetchSpy.and.callFake(() => Promise.resolve(new Response(new ArrayBuffer(8))));
    await Promise.all([svc.glb('u/_parts/s.glb'), svc.glb('u/_parts/s.glb')]);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });
});
