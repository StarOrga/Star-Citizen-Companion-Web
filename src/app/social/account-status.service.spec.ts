import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { AuthService } from '../auth/auth.service';
import { SupabaseClientProvider } from '../core/supabase.client';
import { AccountStatusService } from './account-status.service';
import { AccountStatusRow, clearAccountStatus } from './moderation.types';

type RpcOutcome =
  | { data: unknown; error: null }
  | { data: null; error: { message: string; code?: string } }
  | 'throw';

function setup(outcome: RpcOutcome) {
  const realUser = signal<{ id: string } | null>({ id: 'u1' });
  const ready = signal(true);
  let current = outcome;
  const rpc = vi.fn().mockName('rpc').mockImplementation(async () => {
    if (current === 'throw') throw new TypeError('Failed to fetch');
    return current;
  });
  TestBed.configureTestingModule({
    providers: [
      { provide: SupabaseClientProvider, useValue: { client: { rpc }, realClient: { rpc } } },
      { provide: AuthService, useValue: { realUser, ready } },
    ],
  });
  const svc = TestBed.inject(AccountStatusService);
  return {
    svc,
    rpc,
    realUser,
    set: (o: RpcOutcome) => (current = o),
    /** Signs out so the service clears its 3-minute poll interval. */
    stop: () => {
      realUser.set(null);
      TestBed.tick();
    },
  };
}

const suspendedRow = (): AccountStatusRow => ({
  ...clearAccountStatus(),
  suspended: true,
  suspended_at: '2026-09-28T10:00:00Z',
  suspended_until: '2026-10-05T10:00:00Z',
  suspension_reason: 'spam',
});

describe('AccountStatusService', () => {
  it('a suspended account sets suspended(), reason and suspendedUntil()', async () => {
    const t = setup({ data: [suspendedRow()], error: null });
    await t.svc.ensureLoaded();
    expect(t.rpc).toHaveBeenCalledWith('my_account_status');
    expect(t.svc.suspended()).toBe(true);
    expect(t.svc.suspendedUntil()).toBe('2026-10-05T10:00:00Z');
    expect(t.svc.suspensionReason()).toBe('spam');
    expect(t.svc.suspensionNotice()).toEqual({ reason: 'spam', until: '2026-10-05T10:00:00Z' });
    expect(t.svc.loaded()).toBe(true);
    expect(t.svc.unavailable()).toBe(false);
    t.stop();
  });

  it('an empty result means a clean account', async () => {
    const t = setup({ data: [], error: null });
    await t.svc.ensureLoaded();
    expect(t.svc.suspended()).toBe(false);
    expect(t.svc.suspensionNotice()).toBeNull();
    expect(t.svc.loaded()).toBe(true);
    t.stop();
  });

  it('a missing function (pre-migration DB) sets unavailable() and still resolves', async () => {
    const t = setup({
      data: null,
      error: { message: 'Could not find the function public.my_account_status', code: 'PGRST202' },
    });
    await t.svc.ensureLoaded();
    expect(t.svc.unavailable()).toBe(true);
    expect(t.svc.loaded()).toBe(true);
    expect(t.svc.suspended()).toBe(false);
    t.stop();
  });

  it('a transient read error does not eject: nothing suspended, ensureLoaded() resolves, retry later', async () => {
    const t = setup({ data: null, error: { message: 'JWT expired' } });
    await t.svc.ensureLoaded();
    expect(t.svc.suspended()).toBe(false);
    expect(t.svc.unavailable()).toBe(false);
    // loaded stays false so the next navigation asks again
    expect(t.svc.loaded()).toBe(false);
    t.set({ data: [suspendedRow()], error: null });
    await t.svc.ensureLoaded();
    expect(t.svc.suspended()).toBe(true);
    t.stop();
  });

  it('a thrown fetch (offline) is swallowed and ensureLoaded() still resolves', async () => {
    const t = setup('throw');
    await expect(t.svc.ensureLoaded()).resolves.not.toThrow();
    expect(t.svc.suspended()).toBe(false);
    expect(t.svc.loaded()).toBe(false);
    t.stop();
  });

  it('signing out clears the status but keeps the notice for the login page', async () => {
    const t = setup({ data: [suspendedRow()], error: null });
    await t.svc.ensureLoaded();
    t.stop();
    expect(t.svc.suspended()).toBe(false);
    expect(t.svc.loaded()).toBe(false);
    expect(t.svc.suspensionNotice()).not.toBeNull();
    t.svc.clearNotice();
    expect(t.svc.suspensionNotice()).toBeNull();
  });

  it('acknowledgeWarning calls the RPC and dismisses the warning locally', async () => {
    const t = setup({
      data: [{ ...clearAccountStatus(), warning_id: 'w1', warning_reason: 'careful', warning_at: '2026-09-28T10:00:00Z' }],
      error: null,
    });
    await t.svc.ensureLoaded();
    expect(t.svc.warning()?.id).toBe('w1');
    await t.svc.acknowledgeWarning();
    expect(t.rpc).toHaveBeenCalledWith('acknowledge_warning', { action_id: 'w1' });
    expect(t.svc.warning()).toBeNull();
    t.stop();
  });
});
