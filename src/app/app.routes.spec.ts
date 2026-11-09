import { provideLocationMocks } from '@angular/common/testing';
import { TestBed } from '@angular/core/testing';
import { Router, UrlTree, provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { provideTranslateService } from '@ngx-translate/core';
import { BetaService } from './core/beta.service';
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
    vi.spyOn(router, 'currentNavigation').mockReturnValueOnce(nav('/codex/fps?equipInto=s1&equipSlot=primary') as never).mockReturnValueOnce(nav('/codex/fps?cat=armor') as never);
    expect(TestBed.runInInjectionContext(() => fpsEquipMode())).toBe(true);
    expect(TestBed.runInInjectionContext(() => fpsEquipMode())).toBe(false);
  });
});

/**
 * Alpha cleanup (concept 2026-10-30): the old aliases are gone and fall
 * through to '**' (the 404 page). Pinned so none of them is quietly re-added.
 */
describe('retired route aliases', () => {
  const retired = [
    'news', 'news/patches', 'news/patches/:line', 'hangar',
    'hangar/ship/:id', 'hangar/loadout/:id', 'codex/set/:id', 'codex/blueprint', 'p4k', 'desktop',
    'desktop/auth', 'admin/integrations', 'konzept/:id', 'companion', 'uploader', 'download',
    'tools/extension', 'hangar/import', 'starscape', 'uploader/auth', 'desktop/connect',
  ];
  for (const path of retired) {
    it(`has no ${path} route`, () => {
      expect(allPaths()).not.toContain(path);
    });
  }

  it('keeps the concept route', () => {
    expect(allPaths()).toContain('concept/:id');
  });
});

describe('apps hub routes (concept 2026-10-30)', () => {
  const paths = () => allPaths();

  it('registers the hub, the three apps and both loopbacks under /apps', () => {
    for (const p of ['apps', 'apps/uploader', 'apps/uploader/auth', 'apps/starscape', 'apps/starscape/connect', 'apps/extension']) {
      expect(paths()).toContain(p);
    }
  });

  it('runs settings and the social pages in the content width', () => {
    const data = (p: string) => shellOf()?.children?.find((c) => c.path === p)?.data;
    expect(data('settings')).toEqual({ layout: 'content' });
    expect(data('social')).toEqual({ layout: 'content' });
    expect(data('social/:who')).toEqual({ layout: 'content' });
  });

  it('redirects /friends to /social and serves the invite link outside the gated shell', () => {
    const friends = shellOf()?.children?.find((c) => c.path === 'friends');
    expect(friends?.redirectTo).toBe('social');
    expect(paths()).toContain('invite/:token');
    expect(shellOf()?.children?.some((c) => c.path === 'invite/:token')).toBe(false);
  });
});

/**
 * The '' -> verse string redirect is RELATIVE, and Angular keeps the incoming
 * query + fragment for a relative redirectTo (only an absolute '/...' target
 * drops them; AUD-144). Pinned with the real route entry. The wildcard is no
 * redirect any more: it is the real 404 page (concept 2026-11-09).
 */
describe('root redirect keeps the query (AUD-144)', () => {
  const rootRedirect = routes.find((r) => r.path === '' && typeof r.redirectTo === 'string');

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideRouter([rootRedirect!, { path: 'verse', children: [] }]),
        provideLocationMocks(),
      ],
    });
  });

  it('finds the root redirect, a relative string', () => {
    expect(rootRedirect).toBeDefined();
    expect(typeof rootRedirect!.redirectTo === 'string' && !(rootRedirect!.redirectTo as string).startsWith('/')).toBe(true);
  });

  it('lands / on /verse and keeps query and fragment', async () => {
    const router = TestBed.inject(Router);
    await router.navigateByUrl('/?item=abc#x');
    expect(router.url).toBe('/verse?item=abc#x');
  });
});

describe('real 404 page', () => {
  const wildcard = () => shellOf()?.children?.find((c) => c.path === '**');

  it('is the last child of the gated shell and no redirect', () => {
    const kids = shellOf()?.children ?? [];
    expect(kids[kids.length - 1]).toBe(wildcard());
    expect(wildcard()?.redirectTo).toBeUndefined();
    expect(wildcard()?.loadComponent).toBeDefined();
    expect(routes.some((r) => r.path === '**')).toBe(false);
  });

  it('renders the 404 component for an unknown URL, while / still redirects to /verse', async () => {
    TestBed.configureTestingModule({
      providers: [
        provideTranslateService(),
        provideRouter([
          routes.find((r) => r.path === '' && typeof r.redirectTo === 'string')!,
          { path: 'verse', children: [] },
          { path: '**', loadComponent: wildcard()!.loadComponent! },
        ]),
        provideLocationMocks(),
      ],
    });
    const harness = await RouterTestingHarness.create();
    await harness.navigateByUrl('/gibtsnicht?item=z');
    expect(TestBed.inject(Router).url).toBe('/gibtsnicht?item=z');
    expect(harness.routeNativeElement?.querySelector('h1')).not.toBeNull();
    await harness.navigateByUrl('/');
    expect(TestBed.inject(Router).url).toBe('/verse');
  });
});

/** HQ (concept 2026-10-08): the personal area lives under /hq, English paths since 2026-10-30. */
describe('HQ routes', () => {
  const hq = shellOf()?.children?.find((c) => c.path === 'hq');

  it('registers overview, hangar, import, ship, locker, set and ops under /hq', () => {
    expect(hq?.loadComponent).toBeDefined();
    const paths = (hq?.children ?? []).map((c) => c.path);
    expect(paths).toEqual(['', 'hangar', 'hangar/import', 'hangar/:id', 'locker', 'locker/:id', 'ops']);
    // ops: with the shell beta on its canMatch redirects to /hq#planen, else today's page
    // import before :id, so "import" is never read as a ship id
    expect(paths.indexOf('hangar/import')).toBeLessThan(paths.indexOf('hangar/:id'));
  });

  it('sends /hq/hangar to HQ Bestand > Hangar with the shell beta, keeps the page without it', () => {
    const hangar = hq?.children?.find((c) => c.path === 'hangar');
    const guard = hangar?.canMatch?.[0] as () => unknown;
    for (const on of [true, false]) {
      TestBed.resetTestingModule();
      TestBed.configureTestingModule({
        providers: [provideRouter([]), { provide: BetaService, useValue: { isEnabled: () => () => on } }],
      });
      const out = TestBed.runInInjectionContext(() => guard());
      if (on) expect(TestBed.inject(Router).serializeUrl(out as UrlTree)).toBe('/hq?bestand=hangar#inventar');
      else expect(out).toBe(true);
    }
  });

  it('matches the redirecting /hq/hangar only in full, so /hq/hangar/:id (own ship, exemplar links) is never redirected', () => {
    expect(hq?.children?.find((c) => c.path === 'hangar')?.pathMatch).toBe('full');
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
