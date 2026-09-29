import { TestBed } from '@angular/core/testing';
import { provideRouter, Router, UrlTree } from '@angular/router';
import { authGuard } from './auth.guard';
import { AuthService } from './auth.service';

/**
 * The login wall (AUD-054, RULE-G): every auth-gated route goes through this
 * guard. It must wait for the session read (`whenReady`) before deciding —
 * deciding early would bounce a signed-in user to /login on every reload —
 * and send a signed-out visitor to /login with the route they asked for.
 */
describe('authGuard', () => {
  let signedIn: boolean;
  let release: () => void;
  let ready: Promise<void>;
  let auth: { init: jasmine.Spy; whenReady: jasmine.Spy; isAuthenticated: () => boolean };

  beforeEach(() => {
    signedIn = false;
    ready = new Promise<void>((r) => (release = r));
    auth = {
      init: jasmine.createSpy('init'),
      whenReady: jasmine.createSpy('whenReady').and.callFake(() => ready),
      isAuthenticated: () => signedIn,
    };
    TestBed.configureTestingModule({
      providers: [provideRouter([]), { provide: AuthService, useValue: auth }],
    });
  });

  const run = (url = '/codex/ship/x') =>
    TestBed.runInInjectionContext(() => authGuard({} as never, { url } as never)) as Promise<boolean | UrlTree>;

  it('lets a signed-in user through', async () => {
    signedIn = true;
    release();
    expect(await run()).toBeTrue();
    expect(auth.init).toHaveBeenCalled();
  });

  it('sends a signed-out visitor to /login with the requested route as redirect', async () => {
    release();
    const tree = await run();
    expect(tree instanceof UrlTree).toBeTrue();
    expect(TestBed.inject(Router).serializeUrl(tree as UrlTree)).toBe('/login?redirect=%2Fcodex%2Fship%2Fx');
  });

  it('does not decide before the session read is done', async () => {
    let settled: boolean | UrlTree | undefined;
    const pending = run().then((r) => (settled = r));

    // Several turns of the microtask queue: still waiting on whenReady.
    for (let i = 0; i < 5; i++) await Promise.resolve();
    expect(settled).toBeUndefined();
    expect(auth.whenReady).toHaveBeenCalledTimes(1);

    // The session turns out to be there — the user must not see /login.
    signedIn = true;
    release();
    await pending;
    expect(settled).toBeTrue();
  });
});
