import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { AnalyticsService } from '../core/analytics.service';
import { SupabaseClientProvider } from '../core/supabase.client';
import { AuthService } from './auth.service';
import { ImpersonationService, VIEW_AS_STORAGE_KEY } from './impersonation.service';
import { ViewAs } from './impersonation-policy';
import { RoleService } from './role.service';

/**
 * Regression coverage for the boot-order bug where "View as" silently never
 * took effect: `RoleService`'s constructor `effect()` fires the instant the
 * service is constructed, which is BEFORE `AuthService.init()`'s
 * `getSession()` promise resolves. On that first run `auth.realUser()` was
 * `null` regardless of whether a real session was about to be restored, so
 * the effect used to report `setActualRole(null, true)` — "loaded, and it
 * is null" — which made `ImpersonationService`'s self-heal wipe a just
 * written `sc.viewAs` before the reload that set it even had a chance to
 * apply.
 *
 * These specs wire the REAL `RoleService` + `ImpersonationService` +
 * `AuthService` (only `SupabaseClientProvider` is faked) and give the
 * `getSession()` promise a manually-controlled resolution point, so the
 * constructor effect's premature first run is *deterministically* forced to
 * happen before the session settles — matching what always happens in
 * production, where `getSession()` needs several real microtask/IO hops.
 * This is why these specs drive `getSession()` by hand instead of the
 * sibling guard specs' `roles.refresh()`-by-hand pattern, which bypasses
 * the constructor effect entirely and would never have caught this bug.
 */

interface FakeSession {
  role: 'admin' | 'collaborator' | 'viewer';
  approved: boolean;
}

/** Fake `realClient` — enough of the Supabase surface for AuthService + RoleService. */
function fakeSupabase(session: FakeSession | null) {
  const supaSession = session ? { user: { id: 'u1', email: 'a@b.test' } } : null;
  let resolveSession!: () => void;
  const sessionGate = new Promise<void>((resolve) => {
    resolveSession = resolve;
  });
  return {
    realClient: {
      auth: {
        // Blocks on `sessionGate` until the test explicitly releases it —
        // this is what lets the test force the constructor effect's
        // premature first run to happen strictly before the session
        // resolves, deterministically reproducing the real boot race.
        getSession: () => sessionGate.then(() => ({ data: { session: supaSession } })),
        onAuthStateChange: () => ({ data: { subscription: { unsubscribe(): void {} } } }),
        signOut: jasmine.createSpy('authSignOut').and.resolveTo({ error: null }),
      },
      from: () => ({
        select: () => ({
          eq: () => ({
            maybeSingle: async () => ({
              data: session ? { role: session.role, is_approved: session.approved } : null,
              error: null,
            }),
          }),
        }),
      }),
    },
    client: {},
    releaseSession: () => resolveSession(),
  };
}

function fakeRouter() {
  return {
    createUrlTree: jasmine.createSpy('createUrlTree'),
    navigate: jasmine.createSpy('navigate').and.resolveTo(true),
  };
}

function configure(sb: ReturnType<typeof fakeSupabase>) {
  TestBed.configureTestingModule({
    providers: [
      ImpersonationService,
      RoleService,
      AuthService,
      { provide: SupabaseClientProvider, useValue: sb },
      { provide: Router, useValue: fakeRouter() },
      { provide: AnalyticsService, useValue: { capture: (): void => {} } },
    ],
  });
}

/** Flushes pending microtasks (effect scheduling, promise chains) without a real reload. */
function tick(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function seed(value: ViewAs): void {
  sessionStorage.setItem(VIEW_AS_STORAGE_KEY, JSON.stringify(value));
}

describe('RoleService x ImpersonationService (boot-order regression)', () => {
  afterEach(() => {
    sessionStorage.clear();
    TestBed.resetTestingModule();
  });

  /**
   * Constructs the real service graph, lets the constructor effect's
   * premature pre-ready run happen and settle, asserts the stored value
   * survived that run untouched (the actual regression), then releases the
   * session and lets everything settle for good.
   */
  async function bootAndSettle(sb: ReturnType<typeof fakeSupabase>, storedValueBeforeReady: string | null) {
    const roles = TestBed.inject(RoleService);
    const imp = TestBed.inject(ImpersonationService);
    const auth = TestBed.inject(AuthService);
    auth.init();

    // Let the constructor effect's first (pre-ready) run fire and settle —
    // this is the premature run that used to wipe the stored preview.
    await tick();
    expect(auth.ready()).toBe(false); // sanity: still mid-boot
    expect(sessionStorage.getItem(VIEW_AS_STORAGE_KEY)).toBe(storedValueBeforeReady);

    sb.releaseSession();
    await tick();
    await tick(); // one more turn for refresh()'s own await chain

    return { roles, imp, auth };
  }

  it("a stored 'collaborator' preview survives an async-resolving session and takes effect", async () => {
    seed('collaborator');
    const sb = fakeSupabase({ role: 'admin', approved: true });
    configure(sb);

    const { roles, imp } = await bootAndSettle(sb, JSON.stringify('collaborator'));

    expect(imp.viewAs()).toBe('collaborator');
    expect(roles.role()).toBe('collaborator');
    expect(roles.isAdmin()).toBe(false);
    expect(roles.isCollaborator()).toBe(true);
  });

  it("a stored 'viewer' preview survives an async-resolving session and takes effect", async () => {
    seed('viewer');
    const sb = fakeSupabase({ role: 'admin', approved: true });
    configure(sb);

    const { roles } = await bootAndSettle(sb, JSON.stringify('viewer'));

    expect(roles.role()).toBe('viewer');
    expect(roles.isAdmin()).toBe(false);
    expect(roles.isCollaborator()).toBe(false);
  });

  it("a stored 'anon' preview survives an async-resolving session and takes effect", async () => {
    seed('anon');
    const sb = fakeSupabase({ role: 'admin', approved: true });
    configure(sb);

    const { roles, imp, auth } = await bootAndSettle(sb, JSON.stringify('anon'));

    expect(imp.viewAs()).toBe('anon');
    expect(roles.role()).toBeNull();
    expect(auth.isAuthenticated()).toBe(false);
  });

  it('does NOT elevate: real role viewer + stored admin still clamps to null (no preview)', async () => {
    seed('admin');
    const sb = fakeSupabase({ role: 'viewer', approved: true });
    configure(sb);

    const { roles, imp } = await bootAndSettle(sb, JSON.stringify('admin'));

    expect(sessionStorage.getItem(VIEW_AS_STORAGE_KEY)).toBeNull();
    expect(imp.viewAs()).toBeNull();
    expect(roles.role()).toBe('viewer');
    expect(roles.isAdmin()).toBe(false);
  });

  it('demotion self-heal still fires once auth IS ready and the real role no longer permits the stored target', async () => {
    seed('admin');
    // Real role resolves to 'viewer', which has no valid targets at all —
    // this is the genuine self-heal case the effect must still perform
    // once it actually knows the real role, not just on its premature
    // pre-ready run.
    const sb = fakeSupabase({ role: 'viewer', approved: true });
    configure(sb);

    const { roles, imp } = await bootAndSettle(sb, JSON.stringify('admin'));

    expect(sessionStorage.getItem(VIEW_AS_STORAGE_KEY)).toBeNull();
    expect(imp.viewAs()).toBeNull();
    expect(roles.role()).toBe('viewer');
  });

  it('a genuinely signed-out boot with a stored value gets it wiped once ready', async () => {
    seed('viewer');
    const sb = fakeSupabase(null);
    configure(sb);

    const { roles, imp, auth } = await bootAndSettle(sb, JSON.stringify('viewer'));

    expect(auth.ready()).toBe(true);
    expect(sessionStorage.getItem(VIEW_AS_STORAGE_KEY)).toBeNull();
    expect(imp.viewAs()).toBeNull();
    expect(roles.role()).toBeNull();
    expect(roles.loaded()).toBe(false);
  });
});
