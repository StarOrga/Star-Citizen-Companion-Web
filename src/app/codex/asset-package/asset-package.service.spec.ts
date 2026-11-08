import type { Mock } from 'vitest';
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
  return { calls, provider: { client: { from: vi.fn().mockName('from').mockReturnValue(q) } } };
}

describe('AssetPackageService', () => {
  let fetchSpy: Mock;

  function setup(result: { data: unknown[] | null; error: unknown }) {
    localStorage.removeItem('sc.assetPackages.devBase');
    const sb = supabaseStub(result);
    TestBed.configureTestingModule({ providers: [{ provide: SupabaseClientProvider, useValue: sb.provider }] });
    return { svc: TestBed.inject(AssetPackageService), sb };
  }

  beforeEach(() => {
    fetchSpy = vi.spyOn(window, 'fetch').mockReturnValue(undefined as never);
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
    expect(sb.calls).toContainEqual({ col: 'entity_class', v: 'GUN_A' });
    expect(await svc.findRow(['ship'], 'NOPE')).toBeNull();
  });

  it('throws a query error and does not cache it', async () => {
    const { svc } = setup({ data: null, error: { message: 'boom', code: '500' } });
    await expect(svc.findRow(['ship'], 'AEGS_Gladius')).rejects.toThrow();
  });

  it('fetches + validates a manifest once per sha', async () => {
    const { svc } = setup({ data: [], error: null });
    fetchSpy.mockImplementation(() => Promise.resolve(new Response(JSON.stringify(manifestFixture()))));
    const a = await svc.manifest('abc');
    const b = await svc.manifest('abc');
    expect(a).toBe(b);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(String(vi.mocked(fetchSpy).mock.calls[0][0])).toMatch(/_manifests\/abc\.json$/);
  });

  it('rejects on HTTP failure and retries on the next call', async () => {
    const { svc } = setup({ data: [], error: null });
    fetchSpy.mockReturnValueOnce(Promise.resolve(new Response('nope', { status: 503 }))).mockReturnValueOnce(Promise.resolve(new Response(new ArrayBuffer(4))));
    await expect(svc.glb('https://r2.test/_parts/x.glb')).rejects.toThrow();
    await new Promise((r) => setTimeout(r));
    const buf = await svc.glb('https://r2.test/_parts/x.glb');
    expect(buf.byteLength).toBe(4);
  });

  it('shares one download per GLB url', async () => {
    const { svc } = setup({ data: [], error: null });
    fetchSpy.mockImplementation(() => Promise.resolve(new Response(new ArrayBuffer(8))));
    await Promise.all([svc.glb('u/_parts/s.glb'), svc.glb('u/_parts/s.glb')]);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  describe('preloadShip', () => {
    const rowOf = (manifest: string) => ({ kind: 'ship', entity_class: 'AEGS_Gladius', ship_id: 'AEGS_Gladius', manifest_sha256: manifest });

    it('caches row, manifest, root and part bytes, once per ship', async () => {
      const { svc } = setup({ data: [rowOf('m1')], error: null });
      fetchSpy.mockImplementation((url: string) =>
        Promise.resolve(url.includes('_manifests/') ? new Response(JSON.stringify(manifestFixture())) : new Response(new ArrayBuffer(8))));
      expect(await svc.preloadShip('AEGS_Gladius')).toBe(true);
      const calls = vi.mocked(fetchSpy).mock.calls.length;
      expect(calls).toBeGreaterThan(2);
      expect(await svc.preloadShip('AEGS_Gladius')).toBe(true);
      expect(vi.mocked(fetchSpy).mock.calls.length).toBe(calls);
      // The viewer's own load is now a cache hit.
      const urls = vi.mocked(fetchSpy).mock.calls.map((a) => String(a[0])).filter((u) => u.endsWith('.glb'));
      await svc.glb(urls[0]);
      expect(vi.mocked(fetchSpy).mock.calls.length).toBe(calls);
    });

    it('is false without a package and false (not thrown) on failure', async () => {
      const none = setup({ data: [], error: null });
      expect(await none.svc.preloadShip('NOPE')).toBe(false);
      TestBed.resetTestingModule();
      const bad = setup({ data: null, error: { message: 'boom' } });
      expect(await bad.svc.preloadShip('AEGS_Gladius')).toBe(false);
    });
  });
});
