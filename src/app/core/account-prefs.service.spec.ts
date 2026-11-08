import type { Mock } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { AuthService } from '../auth/auth.service';
import { AccountPrefsService } from './account-prefs.service';
import { SupabaseClientProvider } from './supabase.client';

/**
 * `AccountPrefsService` is what makes a view choice (the Holodeck comparison
 * group) follow the user to another browser. Pinned here: nothing is known
 * until the account's map loaded, a write is one merged key, signed out
 * nothing is written.
 */
describe('AccountPrefsService', () => {
  let user: ReturnType<typeof signal<{ id: string } | null>>;
  let rpc: Mock;
  let stored: Record<string, unknown> | null;

  function setup(initial: { id: string } | null) {
    user = signal<{ id: string } | null>(initial);
    stored = { 'codex.rankScope': 'career' };
    rpc = vi.fn().mockName('rpc').mockResolvedValue({ data: null, error: null });
    const query = {
      select: () => query,
      eq: () => query,
      maybeSingle: () => Promise.resolve({ data: stored ? { ui_prefs: stored } : null, error: null }),
    };
    TestBed.configureTestingModule({
      providers: [
        { provide: AuthService, useValue: { user } },
        { provide: SupabaseClientProvider, useValue: { client: { from: () => query, rpc } } },
      ],
    });
    return TestBed.inject(AccountPrefsService);
  }

  async function settle(): Promise<void> {
    TestBed.tick();
    await Promise.resolve();
    await Promise.resolve();
  }

  it('stays unknown (null) while signed out', async () => {
    const svc = setup(null);
    await settle();
    expect(svc.prefs()).toBeNull();
  });

  it("loads the signed-in account's map", async () => {
    const svc = setup({ id: 'u1' });
    await settle();
    expect(svc.prefs()).toEqual({ 'codex.rankScope': 'career' });
  });

  it('writes one key through set_ui_pref and updates the signal at once', async () => {
    const svc = setup({ id: 'u1' });
    await settle();
    svc.set('codex.rankScope', 'role');
    expect(svc.prefs()?.['codex.rankScope']).toBe('role');
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith('set_ui_pref', { pref_key: 'codex.rankScope', pref_value: 'role' });
  });

  it('writes nothing when the account already holds that value', async () => {
    const svc = setup({ id: 'u1' });
    await settle();
    svc.set('codex.rankScope', 'career');
    svc.set('absent.key', null);
    expect(rpc).not.toHaveBeenCalled();
    svc.set('codex.rankScope', null);
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith('set_ui_pref', { pref_key: 'codex.rankScope', pref_value: null });
  });

  it('still writes while the map has not loaded yet', async () => {
    const svc = setup({ id: 'u1' });
    svc.set('codex.rankScope', 'career');
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith('set_ui_pref', { pref_key: 'codex.rankScope', pref_value: 'career' });
  });

  it('writes nothing while signed out', async () => {
    const svc = setup(null);
    await settle();
    svc.set('codex.rankScope', 'role');
    expect(rpc).not.toHaveBeenCalled();
  });

  it('forgets the map on sign-out', async () => {
    const svc = setup({ id: 'u1' });
    await settle();
    user.set(null);
    await settle();
    expect(svc.prefs()).toBeNull();
  });
});
