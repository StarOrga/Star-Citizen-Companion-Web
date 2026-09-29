import { TestBed, fakeAsync, flushMicrotasks, tick } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { AnalyticsService } from '../core/analytics.service';
import { SupabaseClientProvider } from '../core/supabase.client';
import { AUTH_READY_TIMEOUT_MS, AuthService } from './auth.service';

/**
 * The start-up session read has an upper bound (audit D06, AUD-274/195):
 * every guard awaits `whenReady()`, which settles when `getSession` does —
 * resolved OR rejected — and at the latest after AUTH_READY_TIMEOUT_MS.
 */
describe('AuthService.whenReady', () => {
  function setup(getSession: () => Promise<unknown>): AuthService {
    const sb = {
      realClient: {
        auth: {
          getSession,
          onAuthStateChange: () => ({ data: { subscription: { unsubscribe(): void {} } } }),
        },
      },
      client: {},
    };
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        { provide: SupabaseClientProvider, useValue: sb },
        { provide: AnalyticsService, useValue: { capture: (): void => {} } },
      ],
    });
    return TestBed.inject(AuthService);
  }

  beforeEach(() => spyOn(console, 'warn'));
  afterEach(() => TestBed.resetTestingModule());

  it('resolves once getSession resolves, with the session applied', async () => {
    const session = { user: { id: 'u1', email: 'pilot@example.com' } };
    const auth = setup(() => Promise.resolve({ data: { session } }));
    auth.init();
    await auth.whenReady();
    expect(auth.ready()).toBeTrue();
    expect(auth.isAuthenticated()).toBeTrue();
  });

  it('resolves when getSession rejects — the visit counts as signed out', async () => {
    const auth = setup(() => Promise.reject(new Error('storage broken')));
    auth.init();
    await auth.whenReady();
    expect(auth.ready()).toBeTrue();
    expect(auth.isAuthenticated()).toBeFalse();
  });

  it('resolves after the upper bound when getSession hangs', fakeAsync(() => {
    const auth = setup(() => new Promise(() => undefined));
    auth.init();
    let settled = false;
    void auth.whenReady().then(() => (settled = true));
    tick(AUTH_READY_TIMEOUT_MS - 1);
    flushMicrotasks();
    expect(settled).toBeFalse();
    expect(auth.ready()).toBeFalse();
    tick(1);
    flushMicrotasks();
    expect(settled).toBeTrue();
    expect(auth.ready()).toBeTrue();
    expect(auth.isAuthenticated()).toBeFalse();
  }));

  it('does not wait again once ready', async () => {
    const auth = setup(() => Promise.resolve({ data: { session: null } }));
    auth.init();
    await auth.whenReady();
    const t0 = Date.now();
    await auth.whenReady();
    expect(Date.now() - t0).toBeLessThan(50);
  });
});
