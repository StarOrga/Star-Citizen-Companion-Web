import { provideLocationMocks } from '@angular/common/testing';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { fpsEquipMode, routes } from './app.routes';

const shellOf = () => routes.find((r) => r.path === '' && r.children?.some((c) => c.path === 'hq'));
/** Every route as its full path (children joined to their parent), so a child 'hangar' under 'hq' reads 'hq/hangar'. */
const allPaths = (): string[] => {
  const out: string[] = [];
  const walk = (list: typeof routes, prefix: string) => {
    for (const r of list) {
      const full = [prefix, r.path ?? ''].filter(Boolean).join('/');
      out.push(full);
      if (r.children) walk(r.children, full);
    }
  };
  walk(routes, '');
  return out;
};

describe('codex/fps equip flow (concept 2026-10-29, b3)', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [provideRouter([])] });
  });

  it('keeps the on-foot list only for the equip flow (no plain-browse redirect any more)', () => {
    const fps = (shellOf()?.children ?? []).filter((c) => c.path === 'codex/fps');
    expect(fps.length).toBe(1);
    expect(fps[0].canMatch).toEqual([fpsEquipMode]);
    expect(fps[0].loadComponent).toBeDefined();
    expect(fps[0].redirectTo).toBeUndefined();
  });

  it('matches the equip route only with equipInto in the url', () => {
    const router = TestBed.inject(Router);
    const nav = (url: string) => ({ extractedUrl: router.parseUrl(url) });
    spyOn(router, 'currentNavigation').and.returnValues(nav('/codex/fps?equipInto=s1&equipSlot=primary') as never, nav('/codex/fps?cat=armor') as never);
    expect(TestBed.runInInjectionContext(() => fpsEquipMode())).toBeTrue();
    expect(TestBed.runInInjectionContext(() => fpsEquipMode())).toBeFalse();
  });
});

/**
 * Alpha cleanup (concept 2026-10-30): the old aliases are gone and fall
 * through to '**' -> verse. Pinned so none of them is quietly re-added.
 */
describe('retired route aliases', () => {
  const retired = [
    'news', 'news/patches', 'news/patches/:line', 'hangar',
    'hangar/ship/:id', 'hangar/loadout/:id', 'codex/set/:id', 'codex/blueprint', 'p4k', 'desktop',
    'desktop/auth', 'admin/integrations', 'konzept/:id', 'companion', 'uploader', 'download',
    'tools/extension',
  ];
  for (const path of retired) {
    it(`has no ${path} route`, () => {
      expect(allPaths()).not.toContain(path);
    });
  }

  it('keeps the bridges installed apps still open until their next release', () => {
    const paths = allPaths();
    expect(paths).toContain('hangar/import');
    expect(paths).toContain('starscape');
  });

  it('keeps the concept route and the two live loopback entry points', () => {
    const paths = allPaths();
    expect(paths).toContain('concept/:id');
    expect(paths).toContain('uploader/auth');
    expect(paths).toContain('desktop/connect');
  });
});

describe('apps hub routes (concept 2026-10-30)', () => {
  const paths = () => allPaths();

  it('registers the hub, the three apps and both loopbacks under /apps', () => {
    for (const p of ['apps', 'apps/uploader', 'apps/uploader/auth', 'apps/starscape', 'apps/starscape/connect', 'apps/extension']) {
      expect(paths()).toContain(p);
    }
  });

  it('runs settings and friends in the content width', () => {
    const data = (p: string) => shellOf()?.children?.find((c) => c.path === p)?.data;
    expect(data('settings')).toEqual({ layout: 'content' });
    expect(data('friends')).toEqual({ layout: 'content' });
  });
});

/**
 * The remaining string redirects ('' and '**') are RELATIVE, and Angular keeps
 * the incoming query + fragment for a relative redirectTo (only an absolute
 * '/…' target drops them; AUD-144). Pinned with the real route entries.
 */
describe('string redirects keep the query (AUD-144)', () => {
  const rootRedirect = routes.find((r) => r.path === '' && typeof r.redirectTo === 'string');
  const wildcard = routes.find((r) => r.path === '**');

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideRouter([
          rootRedirect!,
          { path: 'verse', children: [] },
          wildcard!,
        ]),
        provideLocationMocks(),
      ],
    });
  });

  it('finds both redirect entries, each a relative string', () => {
    for (const r of [rootRedirect, wildcard]) {
      expect(r).toBeDefined();
      expect(typeof r!.redirectTo === 'string' && !r!.redirectTo.startsWith('/')).toBeTrue();
    }
  });

  const cases: [string, string][] = [
    ['/?item=abc#x', '/verse?item=abc#x'],
    ['/news?item=abc', '/verse?item=abc'],
    ['/gibtsnicht?item=z', '/verse?item=z'],
  ];
  for (const [from, to] of cases) {
    it(`${from} lands on ${to}`, async () => {
      const router = TestBed.inject(Router);
      await router.navigateByUrl(from);
      expect(router.url).toBe(to);
    });
  }
});

/** HQ (concept 2026-10-08): the personal area lives under /hq, English paths since 2026-10-30. */
describe('HQ routes', () => {
  const hq = shellOf()?.children?.find((c) => c.path === 'hq');

  it('registers overview, hangar, import, ship, locker, set and ops under /hq', () => {
    expect(hq?.loadComponent).toBeDefined();
    const paths = (hq?.children ?? []).map((c) => c.path);
    expect(paths).toEqual(['', 'hangar', 'hangar/import', 'hangar/:id', 'locker', 'locker/:id', 'ops']);
    // import before :id, so "import" is never read as a ship id
    expect(paths.indexOf('hangar/import')).toBeLessThan(paths.indexOf('hangar/:id'));
  });

  it('hands the dashboard its section through route data', () => {
    const data = (p: string) => hq?.children?.find((c) => c.path === p)?.data;
    expect(data('hangar')).toEqual({ layout: 'tool', section: 'hangar' });
    expect(data('locker')).toEqual({ layout: 'tool', section: 'locker' });
  });

  it('keeps the public shared-loadout pages off the gated shell', () => {
    const pub = routes.find((r) => r.path === '' && r.children?.some((c) => c.path === 'about'));
    const paths = (pub?.children ?? []).map((c) => c.path);
    expect(paths).toContain('hangar/shared/:token');
    expect(paths).toContain('shared/loadout/:token');
  });
});
