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
    expect(TestBed.inject(Router).serializeUrl(tree)).toBe('/codex/set/set-42');
  });

  it('escapes an id that would otherwise break out of its path segment', () => {
    const tree = TestBed.runInInjectionContext(() =>
      hangarLoadoutRedirect({ params: { id: 'a/b?c=d' } }),
    );
    const url = TestBed.inject(Router).serializeUrl(tree);
    expect(url.startsWith('/codex/set/')).toBeTrue();
    expect(url).not.toContain('?');
    expect(url.split('/').length).toBe(4);
  });

  it('still registers the path, so a shared link resolves instead of 404ing', () => {
    const shell = routes.find((r) => (r.children ?? []).some((c) => c.path === 'hangar'));
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
