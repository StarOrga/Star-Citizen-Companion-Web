import { TestBed } from '@angular/core/testing';
import { ActivatedRouteSnapshot, convertToParamMap, Router, UrlTree } from '@angular/router';
import { publicOnlyGuard } from './public-only.guard';
import { AuthService } from './auth.service';

/**
 * Defect B: exiting a "View as" preview reloads the SAME document/URL —
 * including any `?redirect=…` authGuard attached when it bounced a shadowed
 * session to /login in the first place (see impersonation.service.ts's
 * exit()). This guard used to unconditionally send an already-authenticated
 * visitor to `/news`, silently discarding `redirect` and dropping the
 * admin's place. These specs pin the fix and its open-redirect guard.
 */
describe('publicOnlyGuard', () => {
  function routeWithRedirect(redirect: string | null): ActivatedRouteSnapshot {
    return {
      queryParamMap: convertToParamMap(redirect === null ? {} : { redirect }),
    } as unknown as ActivatedRouteSnapshot;
  }

  function configure(isAuthenticated: boolean) {
    const parseUrl = jasmine
      .createSpy('parseUrl')
      .and.callFake((url: string) => ({ __url: url }) as unknown as UrlTree);
    TestBed.configureTestingModule({
      providers: [
        {
          provide: AuthService,
          useValue: {
            init: () => {},
            ready: () => true,
            isAuthenticated: () => isAuthenticated,
          },
        },
        { provide: Router, useValue: { parseUrl } },
      ],
    });
    return { parseUrl };
  }

  it('passes through for a signed-out visitor regardless of redirect', async () => {
    configure(false);
    const result = await TestBed.runInInjectionContext(() =>
      publicOnlyGuard(routeWithRedirect('/starscape'), {} as never),
    );
    expect(result).toBe(true);
  });

  it('sends an authenticated visitor with no redirect param to /news (unchanged baseline)', async () => {
    const { parseUrl } = configure(true);
    const result = await TestBed.runInInjectionContext(() =>
      publicOnlyGuard(routeWithRedirect(null), {} as never),
    );
    expect(parseUrl).toHaveBeenCalledWith('/news');
    expect((result as unknown as { __url: string }).__url).toBe('/news');
  });

  it('honors a same-origin ?redirect= for an authenticated visitor (the Defect B fix)', async () => {
    const { parseUrl } = configure(true);
    const result = await TestBed.runInInjectionContext(() =>
      publicOnlyGuard(routeWithRedirect('/starscape'), {} as never),
    );
    expect(parseUrl).toHaveBeenCalledWith('/starscape');
    expect((result as unknown as { __url: string }).__url).toBe('/starscape');
  });

  it('honors a same-origin ?redirect= that carries its own query string', async () => {
    const { parseUrl } = configure(true);
    await TestBed.runInInjectionContext(() =>
      publicOnlyGuard(routeWithRedirect('/hangar/import?cb=1'), {} as never),
    );
    expect(parseUrl).toHaveBeenCalledWith('/hangar/import?cb=1');
  });

  it('falls back to /news for a protocol-relative open-redirect payload (//evil.example)', async () => {
    const { parseUrl } = configure(true);
    await TestBed.runInInjectionContext(() =>
      publicOnlyGuard(routeWithRedirect('//evil.example'), {} as never),
    );
    expect(parseUrl).toHaveBeenCalledWith('/news');
  });

  it('falls back to /news for a backslash open-redirect payload (/\evil.example)', async () => {
    // The WHATWG URL parser treats a backslash as a forward slash for special
    // schemes, so a naive "starts with / but not //" check lets this through
    // and a browser resolving it lands on //evil.example — a different origin.
    const { parseUrl } = configure(true);
    await TestBed.runInInjectionContext(() =>
      publicOnlyGuard(routeWithRedirect('/\\evil.example'), {} as never),
    );
    expect(parseUrl).toHaveBeenCalledWith('/news');
  });

  it('still honors an ordinary same-origin path (no over-blocking)', async () => {
    const { parseUrl } = configure(true);
    await TestBed.runInInjectionContext(() =>
      publicOnlyGuard(routeWithRedirect('/starscape'), {} as never),
    );
    expect(parseUrl).toHaveBeenCalledWith('/starscape');
  });

  it('falls back to /news for an absolute-URL open-redirect payload (https://evil.example)', async () => {
    const { parseUrl } = configure(true);
    await TestBed.runInInjectionContext(() =>
      publicOnlyGuard(routeWithRedirect('https://evil.example'), {} as never),
    );
    expect(parseUrl).toHaveBeenCalledWith('/news');
  });

  it('falls back to /news for a bare (non-absolute-path) payload', async () => {
    const { parseUrl } = configure(true);
    await TestBed.runInInjectionContext(() =>
      publicOnlyGuard(routeWithRedirect('evil.example'), {} as never),
    );
    expect(parseUrl).toHaveBeenCalledWith('/news');
  });
});
