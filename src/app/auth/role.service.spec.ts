import { TestBed } from '@angular/core/testing';
import { ActivatedRouteSnapshot, Router, RouterStateSnapshot } from '@angular/router';
import { AnalyticsService } from '../core/analytics.service';
import { SupabaseClientProvider } from '../core/supabase.client';
import { approvedGuard } from './approved.guard';
import { publicOrApprovedGuard } from './public-or-approved.guard';
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

/**
 * Regression coverage for the two failure-path defects found in adversarial
 * review of `refresh()`:
 *
 *  A) a transient `profiles` read failure (returned `{ error }` or a thrown
 *     fetch) used to be reported as the AUTHORITATIVE fact "role: viewer,
 *     not approved" — wiping an active preview via the self-heal and
 *     signing a real admin out via `approvedGuard`. A read failure must
 *     never overwrite `_actualRole`/`_approved`; see `refresh()`'s comment
 *     for the known-good-vs-unknown distinction.
 *  B) a THROWN fetch used to be swallowed by the constructor effect's
 *     `.catch(() => null)`, leaving `_loaded` stuck at `false` forever —
 *     `waitReady()`'s `setInterval` then polled with no exit, hanging every
 *     guarded navigation indefinitely.
 */
describe('RoleService failure paths (transient read errors)', () => {
  afterEach(() => {
    sessionStorage.clear();
    TestBed.resetTestingModule();
  });

  /**
   * `getSession()` resolves immediately (no boot-order gate needed for
   * these specs — that race is covered above). `maybeSingle()` serves
   * `first` on the very first call, then each entry of `subsequent` in
   * order (repeating the last entry) for every call after. An entry of
   * `'reject'` makes that call THROW instead of resolving with `{ error }`.
   * `onAuthStateChange`'s callback is captured so tests can simulate a
   * token refresh by emitting a brand-new `Session` object for the same
   * user — `realUser()` is a `computed` compared by reference, so this is
   * what actually re-triggers the constructor effect in production.
   */
  function fakeSupabaseQueued(
    first: FakeSession,
    subsequent: Array<{ error: unknown } | 'reject'>,
  ) {
    let call = 0;
    let authChangeCb: ((event: string, session: unknown) => void) | null = null;
    const toSession = (_s: FakeSession) => ({ user: { id: 'u1', email: 'a@b.test' } });
    return {
      realClient: {
        auth: {
          getSession: async () => ({ data: { session: toSession(first) } }),
          onAuthStateChange: (cb: (event: string, session: unknown) => void) => {
            authChangeCb = cb;
            return { data: { subscription: { unsubscribe(): void {} } } };
          },
          signOut: jasmine.createSpy('authSignOut').and.resolveTo({ error: null }),
        },
        from: () => ({
          select: () => ({
            eq: () => ({
              maybeSingle: async () => {
                const n = call++;
                if (n === 0) {
                  return { data: { role: first.role, is_approved: first.approved }, error: null };
                }
                const outcome = subsequent[Math.min(n - 1, subsequent.length - 1)];
                if (outcome === 'reject') throw new Error('network down');
                return { data: null, error: outcome.error };
              },
            }),
          }),
        }),
      },
      client: {},
      /** Simulates a token refresh: same user, brand-new `Session` object. */
      emitTokenRefresh: () => authChangeCb?.('TOKEN_REFRESHED', toSession(first)),
    };
  }

  function configureQueued(sb: ReturnType<typeof fakeSupabaseQueued>) {
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

  it('a returned {error} while a preview is active leaves sc.viewAs and approved() untouched', async () => {
    seed('collaborator');
    const sb = fakeSupabaseQueued({ role: 'admin', approved: true }, [
      { error: { message: 'transient RLS hiccup' } },
    ]);
    configureQueued(sb);

    const roles = TestBed.inject(RoleService);
    const imp = TestBed.inject(ImpersonationService);
    const auth = TestBed.inject(AuthService);
    auth.init();
    await tick();
    await tick(); // first (successful) refresh settles; preview takes effect

    expect(imp.viewAs()).toBe('collaborator');
    expect(roles.approved()).toBe(true);

    // Simulate a token refresh: the effect re-runs, `maybeSingle` errors.
    sb.emitTokenRefresh();
    await tick();
    await tick();

    expect(sessionStorage.getItem(VIEW_AS_STORAGE_KEY)).toBe(JSON.stringify('collaborator'));
    expect(imp.viewAs()).toBe('collaborator'); // preview SURVIVES the transient error
    expect(roles.approved()).toBe(true); // untouched — not laundered into "not approved"
    expect(roles.realRole()).toBe('admin'); // untouched
    expect(roles.identityUnknown()).toBe(false); // we DO have known-good data
  });

  it('a rejected (thrown) profile read on the very first load still settles waitReady() instead of hanging', async () => {
    const sb = fakeSupabaseQueued({ role: 'admin', approved: true }, ['reject']);
    // Force the FIRST call to reject too, not just subsequent ones.
    sb.realClient.from = () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => {
            throw new Error('offline');
          },
        }),
      }),
    });
    configureQueued(sb);

    const roles = TestBed.inject(RoleService);
    const auth = TestBed.inject(AuthService);
    auth.init();

    // If waitReady() never settles, this `await` hangs and the spec times
    // out — that IS the assertion for defect B.
    await roles.waitReady();

    expect(roles.loaded()).toBe(true);
    expect(roles.identityUnknown()).toBe(true); // unknown, not "confirmed viewer"
    expect(roles.approved()).toBe(false); // guard still fails closed on GRANTING
    expect(roles.realRole()).toBeNull(); // never fabricated a role
  });

  /**
   * The post-OAuth 401 race (observed live 2026-08-30, 18:53:44 UTC): the
   * very first `profiles` read fired right after the PKCE code exchange
   * came back 401, the next one ~1s later came back 200. Without a retry
   * that blip is recorded as `identityUnknown` — and `approvedGuard` then
   * strands the whole (initial) navigation on it.
   */
  it('a transient failure on the very FIRST read is retried, not recorded as an unknown identity', async () => {
    const sb = fakeSupabaseQueued({ role: 'admin', approved: true }, []);
    let call = 0;
    sb.realClient.from = () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () =>
            call++ === 0
              ? { data: null, error: { message: 'JWT expired' } }
              : { data: { role: 'admin', is_approved: true }, error: null },
        }),
      }),
    });
    configureQueued(sb);
    const roles = TestBed.inject(RoleService);
    const auth = TestBed.inject(AuthService);
    auth.init();

    await roles.waitReady();

    expect(call).toBeGreaterThan(1); // the failed read was actually retried
    expect(roles.identityUnknown()).toBe(false);
    expect(roles.approved()).toBe(true);
    expect(roles.realRole()).toBe('admin');

    const route = {} as ActivatedRouteSnapshot;
    const state = { url: '/news' } as RouterStateSnapshot;
    const result = await TestBed.runInInjectionContext(() => approvedGuard(route, state));
    expect(result).toBe(true); // navigation goes through — no blank screen
  });

  it('approvedGuard: an identity that stays unresolved sends the user to a VISIBLE page, without signing out', async () => {
    const sb = fakeSupabaseQueued({ role: 'admin', approved: true }, []);
    sb.realClient.from = () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({ data: null, error: { message: 'down' } }),
        }),
      }),
    });
    configureQueued(sb);
    const auth = TestBed.inject(AuthService);
    auth.init();
    await tick();
    await tick();

    const route = {} as ActivatedRouteSnapshot;
    const state = { url: '/target' } as RouterStateSnapshot;
    const router = TestBed.inject(Router);
    const result = await TestBed.runInInjectionContext(() => approvedGuard(route, state));

    // `false` used to be the answer here: the router then abandons the
    // navigation, and on the FIRST navigation of a page load that leaves an
    // empty document with no route, no UI and no way back except a manual
    // reload — exactly what a user hit after a Google sign-in. Deny by
    // routing somewhere visible instead; the session still stays intact.
    expect(result).not.toBe(false);
    expect(router.createUrlTree).toHaveBeenCalledWith(['/unavailable'], {
      queryParams: { redirect: '/target' },
    });
    expect(sb.realClient.auth.signOut).not.toHaveBeenCalled(); // session intact
  });

  it('publicOrApprovedGuard: an unresolved identity lets the public route render WITHOUT signing out', async () => {
    const sb = fakeSupabaseQueued({ role: 'admin', approved: true }, []);
    sb.realClient.from = () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({ data: null, error: { message: 'down' } }),
        }),
      }),
    });
    configureQueued(sb);
    const auth = TestBed.inject(AuthService);
    auth.init();
    await tick();
    await tick();

    const route = {} as ActivatedRouteSnapshot;
    const state = { url: '/target' } as RouterStateSnapshot;
    const result = await TestBed.runInInjectionContext(() =>
      publicOrApprovedGuard(route, state),
    );

    // Differs from approvedGuard on purpose: this route is public by design,
    // so the conservative answer is to render it (the component falls back to
    // its teaser when `approved()` is false) rather than deny a page an
    // anonymous visitor may see. What must NOT happen is the sign-out.
    expect(result).toBe(true);
    expect(sb.realClient.auth.signOut).not.toHaveBeenCalled();
  });

  it('a genuine is_approved=false profile is still denied and signed out (no over-correction)', async () => {
    const sb = fakeSupabase({ role: 'viewer', approved: false });
    configure(sb);
    const auth = TestBed.inject(AuthService);
    auth.init();
    await tick();
    sb.releaseSession();
    await tick();
    await tick();

    const route = {} as ActivatedRouteSnapshot;
    const state = { url: '/target' } as RouterStateSnapshot;
    await TestBed.runInInjectionContext(() => approvedGuard(route, state));

    expect(sb.realClient.auth.signOut).toHaveBeenCalled();
  });
});
