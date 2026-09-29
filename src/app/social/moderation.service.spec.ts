import { TestBed } from '@angular/core/testing';
import { SupabaseClientProvider } from '../core/supabase.client';
import { ModerationService } from './moderation.service';

interface RpcResult { error?: { message: string } | null }

/** `client` and `realClient` are DISTINCT spies: the service must only touch realClient. */
function setup(results: Record<string, RpcResult> = {}) {
  const realRpc = jasmine.createSpy('realClient.rpc').and.callFake(async (fn: string) => ({
    data: null,
    error: results[fn]?.error ?? null,
  }));
  const rpc = jasmine.createSpy('client.rpc').and.resolveTo({ data: null, error: null });
  TestBed.configureTestingModule({
    providers: [
      {
        provide: SupabaseClientProvider,
        useValue: { client: { rpc }, realClient: { rpc: realRpc } },
      },
    ],
  });
  return { svc: TestBed.inject(ModerationService), realRpc, rpc };
}

describe('ModerationService', () => {
  it('warn calls warn_user with the trimmed message', async () => {
    const { svc, realRpc } = setup();
    expect(await svc.warn('u1', '  be nice ')).toBeTrue();
    expect(realRpc).toHaveBeenCalledWith('warn_user', { target: 'u1', message: 'be nice' });
  });

  it('suspend passes reason and days, null days = indefinite', async () => {
    const { svc, realRpc } = setup();
    expect(await svc.suspend('u1', ' spam ', 7)).toBeTrue();
    expect(realRpc).toHaveBeenCalledWith('suspend_user', { target: 'u1', reason: 'spam', days: 7 });
    await svc.suspend('u1', 'spam', null);
    expect(realRpc).toHaveBeenCalledWith('suspend_user', { target: 'u1', reason: 'spam', days: null });
  });

  it('unsuspend sends the trimmed note, null when blank', async () => {
    const { svc, realRpc } = setup();
    expect(await svc.unsuspend('u1', ' ok now ')).toBeTrue();
    expect(realRpc).toHaveBeenCalledWith('unsuspend_user', { target: 'u1', note: 'ok now' });
    await svc.unsuspend('u1');
    expect(realRpc).toHaveBeenCalledWith('unsuspend_user', { target: 'u1', note: null });
  });

  it('resolveReports passes the dismiss flag', async () => {
    const { svc, realRpc } = setup();
    expect(await svc.resolveReports('u1', true)).toBeTrue();
    expect(realRpc).toHaveBeenCalledWith('resolve_reports_for_user', { target: 'u1', dismiss: true });
    await svc.resolveReports('u1', false);
    expect(realRpc).toHaveBeenCalledWith('resolve_reports_for_user', { target: 'u1', dismiss: false });
  });

  it('never touches sb.client — moderation always acts as the real admin', async () => {
    const { svc, rpc } = setup();
    await svc.warn('u1', 'm');
    await svc.suspend('u1', 'r', 1);
    await svc.unsuspend('u1');
    await svc.resolveReports('u1', false);
    expect(rpc).not.toHaveBeenCalled();
  });

  const failing: { name: string; fn: string; call: (s: ModerationService) => Promise<boolean> }[] = [
    { name: 'warn', fn: 'warn_user', call: (s) => s.warn('u1', 'm') },
    { name: 'suspend', fn: 'suspend_user', call: (s) => s.suspend('u1', 'r', 1) },
    { name: 'unsuspend', fn: 'unsuspend_user', call: (s) => s.unsuspend('u1') },
    { name: 'resolveReports', fn: 'resolve_reports_for_user', call: (s) => s.resolveReports('u1', true) },
  ];

  for (const f of failing) {
    it(f.name + ' failure resolves false with a moderation error key', async () => {
      const { svc } = setup({ [f.fn]: { error: { message: 'target_protected' } } });
      expect(await f.call(svc)).toBeFalse();
      expect(svc.error()).toBe('admin.moderation.error.protected');
      expect(svc.busy()).toBeFalse();
    });
  }

  it('unknown errors fall back to the generic key and success clears it', async () => {
    const results: Record<string, RpcResult> = { warn_user: { error: { message: 'kaboom' } } };
    const { svc } = setup(results);
    await svc.warn('u1', 'm');
    expect(svc.error()).toBe('admin.moderation.error.generic');
    delete results['warn_user'];
    expect(await svc.warn('u1', 'm')).toBeTrue();
    expect(svc.error()).toBeNull();
  });
});
