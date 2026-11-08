import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { AuthService } from '../auth/auth.service';
import { SupabaseClientProvider } from '../core/supabase.client';
import { SOCIAL_PRESENCE_TICK_MS, SocialPresenceService } from './social-presence.service';

function setup(user: { id: string } | null, result: { error: { message: string } | null } = { error: null }) {
  const rpc = vi.fn().mockName('rpc').mockImplementation(async () => result);
  TestBed.configureTestingModule({
    providers: [
      { provide: SupabaseClientProvider, useValue: { realClient: { rpc } } },
      { provide: AuthService, useValue: { realUser: signal(user) } },
    ],
  });
  return { rpc, svc: TestBed.inject(SocialPresenceService) };
}

describe('SocialPresenceService', () => {
  it('ticks well inside the 5-minute online window', () => {
    expect(SOCIAL_PRESENCE_TICK_MS).toBeLessThan(5 * 60_000);
  });

  it('does nothing without a real session', async () => {
    const { svc, rpc } = setup(null);
    await svc.touch();
    expect(rpc).not.toHaveBeenCalled();
  });

  it('calls touch_presence on the real client', async () => {
    const { svc, rpc } = setup({ id: 'u1' });
    await svc.touch();
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith('touch_presence');
  });

  it('joins a call already in flight', async () => {
    const { svc, rpc } = setup({ id: 'u1' });
    await Promise.all([svc.touch(), svc.touch()]);
    expect(rpc).toHaveBeenCalledTimes(1);
  });

  it('swallows a failure', async () => {
    const { svc } = setup({ id: 'u1' }, { error: { message: 'boom' } });
    await expect(svc.touch()).resolves.not.toThrow();
  });
});
