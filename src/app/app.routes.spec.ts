import { provideLocationMocks } from '@angular/common/testing';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { blueprintListRedirect, hangarLoadoutRedirect, routes } from './app.routes';

/**
 * The retired hangar loadout editor (admin feedback 34505d70, decision "2A").
 * The route survives ONLY as a redirect, and a redirect nobody exercises is a
 * redirect that silently rots — so the mapping is pinned here.
 */
describe('hangar/loadout/:id bridge', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [provideRouter([])] });
  });

  it('sends an old editor link to the set page of that very set', () => {
    const tree = TestBed.runInInjectionContext(() =>
      hangarLoadoutRedirect({ params: { id: 'set-42' } }),
    );
    expect(TestBed.inject(Router).serializeUrl(tree)).toBe('/hq/spind/set-42');
  });

  it('escapes an id that would otherwise break out of its path segment', () => {
    const tree = TestBed.runInInjectionContext(() =>
      hangarLoadoutRedirect({ params: { id: 'a/b?c=d' } }),
    );
    const url = TestBed.inject(Router).serializeUrl(tree);
    expect(url.startsWith('/hq/spind/')).toBeTrue();
    expect(url).not.toContain('?');
    expect(url.split('/').length).toBe(4);
  });

  it('still registers the path, so a shared link resolves instead of 404ing', () => {
    const shell = routes.find((r) => (r.children ?? []).some((c) => c.path === 'hq'));
    const bridge = (shell?.children ?? []).find((c) => c.path === 'hangar/loadout/:id');
    expect(bridge).toBeDefined();
    // A bridge, not a page: no component may hang off it any more.
    expect(bridge?.loadComponent).toBeUndefined();
    expect(bridge?.redirectTo).toBe(hangarLoadoutRedirect);
  });
});

/**
 * The retired standalone blueprint list (AUD-061) — folded into the Codex
 * index's blueprint category. The detail route (`codex/blueprint/:className`)
 * is untouched; only the list moved.
 */
describe('codex/blueprint bridge', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [provideRouter([])] });
  });

  it('sends the bare list to the index with the blueprint category', () => {
    const tree = TestBed.runInInjectionContext(() =>
      blueprintListRedirect({ queryParams: {} }),
    );
    expect(TestBed.inject(Router).serializeUrl(tree)).toBe('/codex/index?kind=blueprint');
  });

  it('carries an incoming search term over', () => {
    const tree = TestBed.runInInjectionContext(() =>
      blueprintListRedirect({ queryParams: { q: 'gold' } }),
    );
    const url = TestBed.inject(Router).serializeUrl(tree);
    expect(url).toContain('kind=blueprint');
    expect(url).toContain('q=gold');
  });

  it('still registers the detail route unchanged', () => {
    const shell = routes.find((r) => (r.children ?? []).some((c) => c.path === 'codex/blueprint'));
    const list = (shell?.children ?? []).find((c) => c.path === 'codex/blueprint');
    const detail = (shell?.children ?? []).find((c) => c.path === 'codex/blueprint/:className');
    expect(list?.redirectTo).toBe(blueprintListRedirect);
    expect(list?.loadComponent).toBeUndefined();
    expect(detail).toBeDefined();
    expect(detail?.loadComponent).toBeDefined();
  });
});

/**
 * AUD-144 claimed the string redirects drop the query. They do not: every one
 * of them is RELATIVE, and Angular keeps the incoming query + fragment for a
 * relative redirectTo (only an absolute '/…' target drops them). Pinned here
 * with the real route entries so a later absolute rewrite fails at once.
 */
describe('string redirects keep the query (AUD-144)', () => {
  const shell = routes.find((r) => r.path === '' && r.children?.some((c) => c.path === 'p4k'));
  const child = (path: string) => shell?.children?.find((c) => c.path === path && c.redirectTo);
  const rootRedirect = routes.find((r) => r.path === '' && typeof r.redirectTo === 'string');
  const wildcard = routes.find((r) => r.path === '**');
  const p4k = child('p4k');
  const desktop = child('desktop');
  const integrations = child('admin/integrations');

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideRouter([
          rootRedirect!,
          {
            path: '',
            children: [
              { path: 'news', children: [] },
              { path: 'uploader', children: [] },
              { path: 'admin/api-tokens', children: [] },
              p4k!,
              desktop!,
              integrations!,
            ],
          },
          wildcard!,
        ]),
        provideLocationMocks(),
      ],
    });
  });

  it('finds all five redirect entries, each a relative string', () => {
    for (const r of [rootRedirect, p4k, desktop, integrations, wildcard]) {
      expect(r).toBeDefined();
      expect(typeof r!.redirectTo === 'string' && !r!.redirectTo.startsWith('/')).toBeTrue();
    }
  });

  const cases: [string, string][] = [
    ['/?item=abc#x', '/news?item=abc#x'],
    ['/p4k?x=1', '/uploader?x=1'],
    ['/desktop?x=1', '/uploader?x=1'],
    ['/admin/integrations?y=2', '/admin/api-tokens?y=2'],
    ['/gibtsnicht?item=z', '/news?item=z'],
  ];
  for (const [from, to] of cases) {
    it(`${from} lands on ${to}`, async () => {
      const router = TestBed.inject(Router);
      await router.navigateByUrl(from);
      expect(router.url).toBe(to);
    });
  }
});

/**
 * HQ (concept 2026-10-08): the personal area moved under /hq. Every old url
 * still resolves — pinned with the real route entries, query included (the
 * browser extension opens /hangar/import?src=extension).
 */
describe('HQ routes + old hangar urls', () => {
  const shell = routes.find((r) => r.path === '' && r.children?.some((c) => c.path === 'hq'));
  const hq = shell?.children?.find((c) => c.path === 'hq');
  const redirect = (path: string) => shell?.children?.find((c) => c.path === path && c.redirectTo);
  const leaf = { children: [] };

  it('registers overview, hangar, import, ship, locker, set and ops under /hq', () => {
    expect(hq?.loadComponent).toBeDefined();
    const paths = (hq?.children ?? []).map((c) => c.path);
    expect(paths).toEqual(['', 'hangar', 'hangar/import', 'hangar/:id', 'spind', 'spind/:id', 'einsaetze']);
    // import before :id, so "import" is never read as a ship id
    expect(paths.indexOf('hangar/import')).toBeLessThan(paths.indexOf('hangar/:id'));
  });

  it('hands the dashboard its section through route data', () => {
    const data = (p: string) => hq?.children?.find((c) => c.path === p)?.data;
    expect(data('hangar')).toEqual({ section: 'hangar' });
    expect(data('spind')).toEqual({ section: 'locker' });
  });

  it('keeps the public shared-loadout pages off the gated shell', () => {
    const pub = routes.find((r) => r.path === '' && r.children?.some((c) => c.path === 'about'));
    const paths = (pub?.children ?? []).map((c) => c.path);
    expect(paths).toContain('hangar/shared/:token');
    expect(paths).toContain('shared/loadout/:token');
  });

  describe('redirects', () => {
    beforeEach(() => {
      TestBed.configureTestingModule({
        providers: [
          provideRouter([
            {
              path: '',
              children: [
                {
                  path: 'hq',
                  children: [
                    { path: 'hangar', ...leaf },
                    { path: 'hangar/import', ...leaf },
                    { path: 'hangar/:id', ...leaf },
                    { path: 'spind/:id', ...leaf },
                  ],
                },
                redirect('hangar')!,
                redirect('hangar/import')!,
                redirect('hangar/ship/:id')!,
                redirect('hangar/loadout/:id')!,
                redirect('codex/set/:id')!,
              ],
            },
          ]),
          provideLocationMocks(),
        ],
      });
    });

    const cases: [string, string][] = [
      ['/hangar', '/hq/hangar'],
      ['/hangar?tab=x', '/hq/hangar?tab=x'],
      ['/hangar/import?src=extension', '/hq/hangar/import?src=extension'],
      ['/hangar/ship/abc', '/hq/hangar/abc'],
      ['/hangar/loadout/set-1', '/hq/spind/set-1'],
      ['/codex/set/set-2', '/hq/spind/set-2'],
    ];
    for (const [from, to] of cases) {
      it(`${from} lands on ${to}`, async () => {
        const router = TestBed.inject(Router);
        await router.navigateByUrl(from);
        expect(router.url).toBe(to);
      });
    }
  });
});
