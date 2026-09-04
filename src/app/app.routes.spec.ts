import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { hangarLoadoutRedirect, routes } from './app.routes';

/**
 * The retired hangar loadout editor (admin feedback 34505d70, decision "2A").
 * The route survives ONLY as a redirect, and a redirect nobody exercises is a
 * redirect that silently rots — so the mapping is pinned here.
 */
describe('hangar/loadout/:id bridge', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [provideRouter([])] });
  });

  it('sends an old editor link to the AN BORD zone of that very set', () => {
    const tree = TestBed.runInInjectionContext(() =>
      hangarLoadoutRedirect({ params: { id: 'set-42' } }),
    );
    expect(TestBed.inject(Router).serializeUrl(tree)).toBe('/codex?zone=board&set=set-42');
  });

  it('escapes an id that would otherwise break out of the query string', () => {
    const tree = TestBed.runInInjectionContext(() =>
      hangarLoadoutRedirect({ params: { id: 'a b&c=d' } }),
    );
    const url = TestBed.inject(Router).serializeUrl(tree);
    expect(url.startsWith('/codex?zone=board&set=')).toBeTrue();
    expect(url).not.toContain('c=d');
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
