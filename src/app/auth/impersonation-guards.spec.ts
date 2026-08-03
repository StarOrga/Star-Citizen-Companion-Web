import { TestBed } from '@angular/core/testing';
import { ActivatedRouteSnapshot, Router, RouterStateSnapshot, UrlTree } from '@angular/router';
import { AnalyticsService } from '../core/analytics.service';
import { SupabaseClientProvider } from '../core/supabase.client';
import { approvedGuard } from './approved.guard';
import { AuthService } from './auth.service';
import { ImpersonationService, VIEW_AS_STORAGE_KEY } from './impersonation.service';
import { ViewAs } from './impersonation-policy';
import { publicOrApprovedGuard } from './public-or-approved.guard';
import { roleGuard } from './role.guard';
import { RoleService } from './role.service';

/**
 * Security regression tests for the guard/service interplay introduced by
 * the role-preview ("View as") overlay. These pin invariants that are
 * currently unwritten anywhere else:
 *
 *  1. `roleGuard` reads the CLAMPED effective role, not the real one — a
 *     stored downgrade must actually change routing outcomes. This also
 *     pins the load-bearing ordering in `role.service.ts`, where
 *     `_loaded.set(true)` (which unblocks `roles.waitReady()`) runs
 *     immediately before `imp.setActualRole(...)` (which unblocks the
 *     clamp) — both statements execute synchronously, back to back, with no
 *     `await` between them, so `waitReady()` resolving must never observe a
 *     `role()` that hasn't been clamped yet.
 *  2. `approvedGuard` / `publicOrApprovedGuard` must NEVER sign the real
 *     user out just because an anon preview overlay is active. Both guards'
 *     only `auth.signOut()` call sits behind an `isAuthenticated()` early
 *     return, and the REAL `AuthService.isAuthenticated()` is shadowed to
 *     `false` under an anon preview — this test uses the real `AuthService`
 *     (not a stub) specifically so that shadowing is exercised, pinning that
 *     a future refactor can't accidentally sign a real admin out of their
 *     real session while merely *previewing* as a signed-out visitor.
 *  3. `SupabaseClientProvider.client` is the anon preview client ONLY for
 *     `'anon'`, and the real client for every other view.
 */

/** Fake `realClient` — enough of the Supabase surface for AuthService + RoleService. */
function fakeSupabase(role: 'admin' | 'collaborator' | 'viewer', approved: boolean) {
  const session = { user: { id: 'u1', email: 'a@b.test' } };
  return {
    realClient: {
      auth: {
        getSession: async () => ({ data: { session } }),
        onAuthStateChange: () => ({ data: { subscription: { unsubscribe(): void {} } } }),
        signOut: jasmine.createSpy('authSignOut').and.resolveTo({ error: null }),
      },
      from: () => ({
        select: () => ({
          eq: () => ({
            maybeSingle: async () => ({ data: { role, is_approved: approved }, error: null }),
          }),
        }),
      }),
    },
    client: {},
  };
}

function fakeRouter() {
  return {
    createUrlTree: jasmine
      .createSpy('createUrlTree')
      .and.callFake((commands: unknown[]) => ({ __commands: commands }) as unknown as UrlTree),
    navigate: jasmine.createSpy('navigate').and.resolveTo(true),
  };
}

function configure(sb: ReturnType<typeof fakeSupabase>, router: ReturnType<typeof fakeRouter>) {
  TestBed.configureTestingModule({
    providers: [
      ImpersonationService,
      RoleService,
      AuthService,
      { provide: SupabaseClientProvider, useValue: sb },
      { provide: Router, useValue: router },
      { provide: AnalyticsService, useValue: { capture: (): void => {} } },
    ],
  });
}

/** Lets `AuthService.init()`'s `getSession().then(...)` microtask settle. */
function flush(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

const route = {} as ActivatedRouteSnapshot;
const state = { url: '/target' } as RouterStateSnapshot;

describe('impersonation × guards (security invariants)', () => {
  afterEach(() => {
    sessionStorage.clear();
    TestBed.resetTestingModule();
  });

  describe('roleGuard reads the clamped effective role', () => {
    it("roleGuard('admin') with real role admin + stored 'viewer' redirects to /news", async () => {
      sessionStorage.setItem(VIEW_AS_STORAGE_KEY, JSON.stringify('viewer' satisfies ViewAs));
      const router = fakeRouter();
      configure(fakeSupabase('admin', true), router);

      const auth = TestBed.inject(AuthService);
      auth.init();
      await flush();
      const roles = TestBed.inject(RoleService);
      await roles.refresh(); // real role: admin; imp is told, clamps stored 'viewer'
      expect(roles.role()).toBe('viewer'); // sanity: preview is in effect

      const result = await TestBed.runInInjectionContext(() => roleGuard('admin')(route, state));

      expect(router.createUrlTree).toHaveBeenCalledWith(['/news']);
      expect((result as unknown as { __commands: unknown[] }).__commands).toEqual(['/news']);
    });

    it("roleGuard('admin') with real role admin and no preview passes", async () => {
      const router = fakeRouter();
      configure(fakeSupabase('admin', true), router);

      const auth = TestBed.inject(AuthService);
      auth.init();
      await flush();
      const roles = TestBed.inject(RoleService);
      await roles.refresh();

      const result = await TestBed.runInInjectionContext(() => roleGuard('admin')(route, state));

      expect(result).toBe(true);
      expect(router.createUrlTree).not.toHaveBeenCalled();
    });
  });

  describe('approvedGuard / publicOrApprovedGuard never sign the real user out while anon-previewing', () => {
    for (const approved of [true, false]) {
      it(`approvedGuard: viewAs='anon', approved=${approved} → never calls signOut`, async () => {
        sessionStorage.setItem(VIEW_AS_STORAGE_KEY, JSON.stringify('anon' satisfies ViewAs));
        const sb = fakeSupabase('admin', approved);
        configure(sb, fakeRouter());

        const auth = TestBed.inject(AuthService);
        auth.init();
        await flush();
        const roles = TestBed.inject(RoleService);
        await roles.refresh();
        expect(auth.isAuthenticated()).toBe(false); // sanity: the anon preview shadow is active

        await TestBed.runInInjectionContext(() => approvedGuard(route, state));

        expect(sb.realClient.auth.signOut).not.toHaveBeenCalled();
      });

      it(`publicOrApprovedGuard: viewAs='anon', approved=${approved} → never calls signOut`, async () => {
        sessionStorage.setItem(VIEW_AS_STORAGE_KEY, JSON.stringify('anon' satisfies ViewAs));
        const sb = fakeSupabase('admin', approved);
        configure(sb, fakeRouter());

        const auth = TestBed.inject(AuthService);
        auth.init();
        await flush();
        const roles = TestBed.inject(RoleService);
        await roles.refresh();

        await TestBed.runInInjectionContext(() => publicOrApprovedGuard(route, state));

        expect(sb.realClient.auth.signOut).not.toHaveBeenCalled();
      });
    }

    it('approvedGuard: still signs out a genuinely non-approved account with NO preview active (baseline — the anon shadow is not the ONLY thing blocking signOut)', async () => {
      const sb = fakeSupabase('viewer', false);
      configure(sb, fakeRouter());

      const auth = TestBed.inject(AuthService);
      auth.init();
      await flush();
      const roles = TestBed.inject(RoleService);
      await roles.refresh();
      expect(auth.isAuthenticated()).toBe(true); // sanity: no preview active

      await TestBed.runInInjectionContext(() => approvedGuard(route, state));

      expect(sb.realClient.auth.signOut).toHaveBeenCalled();
    });
  });

  describe('SupabaseClientProvider.client swaps ONLY for the anon preview', () => {
    const cases: Array<{ stored: ViewAs | null; expectAnon: boolean }> = [
      { stored: null, expectAnon: false },
      { stored: 'viewer', expectAnon: false },
      { stored: 'collaborator', expectAnon: false },
      { stored: 'anon', expectAnon: true },
    ];

    for (const { stored, expectAnon } of cases) {
      it(`stored=${String(stored)} → client is ${expectAnon ? 'the anon preview client' : 'realClient'}`, () => {
        sessionStorage.clear();
        if (stored) sessionStorage.setItem(VIEW_AS_STORAGE_KEY, JSON.stringify(stored));

        TestBed.configureTestingModule({
          providers: [ImpersonationService, SupabaseClientProvider],
        });

        const imp = TestBed.inject(ImpersonationService);
        imp.setActualRole('admin', true);
        const sb = TestBed.inject(SupabaseClientProvider);

        if (expectAnon) {
          expect(sb.client).not.toBe(sb.realClient);
        } else {
          expect(sb.client).toBe(sb.realClient);
        }
      });
    }
  });
});
