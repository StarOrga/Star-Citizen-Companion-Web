import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { SupabaseClientProvider } from '../core/supabase.client';
import { AuthService } from './auth.service';
import { PRESENCE_MIN_INTERVAL_MS, PresenceService } from './presence.service';

/**
 * `PresenceService` is what keeps the admin "last seen" column honest for
 * members who stay signed in (it used to mirror `auth.users.last_sign_in_at`,
 * which never moves on a token refresh). These specs pin the contract of
 * `touch()`: real session only, one RPC per floor window, transient failures
 * do not burn the window.
 */
describe('PresenceService', () => {
  let realUser: ReturnType<typeof signal<{ id: string } | null>>;
  let rpc: jasmine.Spy;

  function setup(user: { id: string } | null) {
    realUser = signal<{ id: string } | null>(user);
    rpc = jasmine.createSpy('rpc').and.resolveTo({ data: '2026-09-21T20:00:00Z', error: null });
    TestBed.configureTestingModule({
      providers: [
        { provide: AuthService, useValue: { realUser } },
        { provide: SupabaseClientProvider, useValue: { realClient: { rpc } } },
      ],
    });
    return TestBed.inject(PresenceService);
  }

  it('does nothing without a real session', async () => {
    const svc = setup(null);
    await svc.touch();
    expect(rpc).not.toHaveBeenCalled();
  });

  it('calls touch_last_seen on the real client for a signed-in user', async () => {
    const svc = setup({ id: 'u1' });
    await svc.touch(1_000_000);
    expect(rpc).toHaveBeenCalledOnceWith('touch_last_seen');
  });

  it('touches at most once per floor window', async () => {
    const svc = setup({ id: 'u1' });
    await svc.touch(1_000_000);
    await svc.touch(1_000_000 + PRESENCE_MIN_INTERVAL_MS - 1);
    expect(rpc).toHaveBeenCalledTimes(1);
    await svc.touch(1_000_000 + PRESENCE_MIN_INTERVAL_MS);
    expect(rpc).toHaveBeenCalledTimes(2);
  });

  it('lets the next trigger retry after an RPC error instead of waiting out the floor', async () => {
    const svc = setup({ id: 'u1' });
    rpc.and.resolveTo({ data: null, error: { message: 'boom' } });
    await svc.touch(1_000_000);
    rpc.and.resolveTo({ data: '2026-09-21T20:00:00Z', error: null });
    await svc.touch(1_000_001);
    expect(rpc).toHaveBeenCalledTimes(2);
  });

  it('swallows a thrown fetch and retries on the next trigger', async () => {
    const svc = setup({ id: 'u1' });
    rpc.and.rejectWith(new Error('offline'));
    await expectAsync(svc.touch(1_000_000)).toBeResolved();
    rpc.and.resolveTo({ data: null, error: null });
    await svc.touch(1_000_001);
    expect(rpc).toHaveBeenCalledTimes(2);
  });

  it('init() touches once a session is present and again for a different account', async () => {
    const svc = setup(null);
    svc.init();
    TestBed.flushEffects();
    expect(rpc).not.toHaveBeenCalled();

    realUser.set({ id: 'u1' });
    TestBed.flushEffects();
    await Promise.resolve();
    expect(rpc).toHaveBeenCalledTimes(1);

    // Sign out, then a different account signs in: the floor is reset.
    realUser.set(null);
    TestBed.flushEffects();
    realUser.set({ id: 'u2' });
    TestBed.flushEffects();
    await Promise.resolve();
    expect(rpc).toHaveBeenCalledTimes(2);
  });
});
