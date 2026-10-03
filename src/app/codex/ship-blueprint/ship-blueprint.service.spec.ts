import { TestBed } from '@angular/core/testing';
import { SupabaseClientProvider } from '../../core/supabase.client';
import { BLUEPRINT_DEV_BASE_KEY, ShipBlueprintService } from './ship-blueprint.service';
import { blueprintSvg } from './ship-blueprint.testing';

const SHA_FULL = 'a'.repeat(64);
const SHA_ICON = 'b'.repeat(64);

function supabaseStub(result: { data: unknown[] | null; error: unknown }) {
  const calls: unknown[][] = [];
  const q = {
    select: (...a: unknown[]) => (calls.push(['select', ...a]), q),
    not: (...a: unknown[]) => (calls.push(['not', ...a]), Promise.resolve(result)),
  };
  const from = jasmine.createSpy('from').and.returnValue(q);
  return { calls, from, provider: { client: { from } } };
}

describe('ShipBlueprintService', () => {
  let fetchSpy: jasmine.Spy;

  function setup(result: { data: unknown[] | null; error: unknown }) {
    localStorage.removeItem(BLUEPRINT_DEV_BASE_KEY);
    const sb = supabaseStub(result);
    TestBed.configureTestingModule({ providers: [{ provide: SupabaseClientProvider, useValue: sb.provider }] });
    return { svc: TestBed.inject(ShipBlueprintService), sb };
  }

  beforeEach(() => {
    fetchSpy = spyOn(window, 'fetch');
  });

  afterEach(() => TestBed.resetTestingModule());

  it('reads which ships have drawings in one query and resolves their URLs case-insensitively', async () => {
    const { svc, sb } = setup({
      data: [
        { ship_id: 'AEGS_Gladius', blueprint_path: `_blueprints/${SHA_FULL}.svg`, blueprint_icon_path: `_blueprints/${SHA_ICON}.svg` },
        { ship_id: 'BAD_Path', blueprint_path: '../../etc.svg', blueprint_icon_path: 'x' },
      ],
      error: null,
    });
    expect(svc.urls('AEGS_Gladius')).toBeNull();
    await Promise.all([svc.load(), svc.load()]);
    expect(sb.from).toHaveBeenCalledOnceWith('ship_skins_index');
    expect(sb.calls).toContain(['not', 'blueprint_icon_path', 'is', null]);
    const urls = svc.urls('aegs_gladius')!;
    expect(urls.full).toMatch(new RegExp(`/ship-skins/_blueprints/${SHA_FULL}\\.svg$`));
    expect(urls.icon).toMatch(new RegExp(`/ship-skins/_blueprints/${SHA_ICON}\\.svg$`));
    // A row whose paths do not have the blueprint shape is no drawing at all.
    expect(svc.urls('BAD_Path')).toBeNull();
    expect(svc.ready()).toBeTrue();
  });

  it('treats a failed index read as "no drawings" for the session — no request per tile', async () => {
    const { svc, sb } = setup({ data: null, error: { code: '42703', message: 'column does not exist' } });
    await svc.load();
    await svc.load();
    expect(sb.from).toHaveBeenCalledTimes(1);
    expect(svc.urls('AEGS_Gladius')).toBeNull();
    expect(svc.ready()).toBeTrue();
  });

  it('fetches and parses a drawing once per URL; a ship without one costs no request', async () => {
    const { svc } = setup({
      data: [{ ship_id: 'AEGS_Gladius', blueprint_path: `_blueprints/${SHA_FULL}.svg`, blueprint_icon_path: `_blueprints/${SHA_ICON}.svg` }],
      error: null,
    });
    await svc.load();
    fetchSpy.and.callFake(() => Promise.resolve(new Response(blueprintSvg('icon'))));
    const [a, b] = await Promise.all([svc.drawing('AEGS_Gladius', 'icon'), svc.drawing('AEGS_Gladius', 'icon')]);
    expect(a?.lod).toBe('icon');
    expect(b).toBe(a);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(await svc.drawing('ANVL_Hornet', 'icon')).toBeNull();
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('answers null for an unreadable file or a file of the wrong level of detail', async () => {
    const { svc } = setup({
      data: [{ ship_id: 'AEGS_Gladius', blueprint_path: `_blueprints/${SHA_FULL}.svg`, blueprint_icon_path: `_blueprints/${SHA_ICON}.svg` }],
      error: null,
    });
    await svc.load();
    fetchSpy.and.callFake(() => Promise.resolve(new Response(blueprintSvg('icon'))));
    expect(await svc.drawing('AEGS_Gladius', 'full')).toBeNull();
    fetchSpy.and.callFake(() => Promise.resolve(new Response('<html>nope</html>')));
    expect(await svc.drawing('AEGS_Gladius', 'icon')).toBeNull();
  });

  it('lets a transient fetch failure be retried by the next view', async () => {
    const { svc } = setup({
      data: [{ ship_id: 'AEGS_Gladius', blueprint_path: `_blueprints/${SHA_FULL}.svg`, blueprint_icon_path: `_blueprints/${SHA_ICON}.svg` }],
      error: null,
    });
    await svc.load();
    fetchSpy.and.returnValues(
      Promise.resolve(new Response('', { status: 503 })),
      Promise.resolve(new Response(blueprintSvg('full'))),
    );
    expect(await svc.drawing('AEGS_Gladius', 'full')).toBeNull();
    expect((await svc.drawing('AEGS_Gladius', 'full'))?.lod).toBe('full');
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });
});
