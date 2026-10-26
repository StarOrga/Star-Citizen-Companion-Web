import { fakeAsync, TestBed, tick } from '@angular/core/testing';
import { FakeCall, fakeSupabase } from '../../testing/fake-supabase';
import {
  HANDOFF_CONNECTED_WATCH_MS,
  HANDOFF_POLL_MS,
  HandoffService,
  handoffTargetPath,
  maskEmail,
} from './handoff.service';

describe('handoffTargetPath', () => {
  it('keeps same-origin paths and refuses the rest', () => {
    expect(handoffTargetPath('/codex/ship/x?a=1')).toBe('/codex/ship/x?a=1');
    expect(handoffTargetPath('//evil.example')).toBe('/');
    expect(handoffTargetPath('https://evil.example')).toBe('/');
    expect(handoffTargetPath('/handoff#c=abc')).toBe('/');
    expect(handoffTargetPath('/login')).toBe('/');
    expect(handoffTargetPath('/a b')).toBe('/');
    expect(handoffTargetPath('/' + 'a'.repeat(600))).toBe('/');
    expect(handoffTargetPath(null)).toBe('/');
  });
});

describe('maskEmail', () => {
  it('matches the edge function', () => {
    expect(maskEmail('jane.doe@gmail.com')).toBe('j***@g***.com');
    expect(maskEmail('nonsense')).toBe('***');
  });
});

describe('HandoffService', () => {
  let rowState: Record<string, unknown> | null;
  let pollError: unknown;
  let createAnswer: () => { data?: unknown; error?: unknown };
  let revokeAnswer: { data?: unknown; error?: unknown };
  let fake: ReturnType<typeof fakeSupabase>;

  function setup(): HandoffService {
    fake = fakeSupabase({
      answer: (c: FakeCall) => {
        if (c.op === 'invoke' && c.target === 'handoff-create') return createAnswer();
        if (c.op === 'invoke' && c.target === 'handoff-revoke') return revokeAnswer;
        if (c.op === 'invoke' && c.target === 'handoff-redeem') {
          const body = (c.args as { body: { peek?: boolean } }).body;
          return body.peek
            ? { data: { email_masked: 'j***@g***.com', user_id: 'u-1', target_path: '/codex' } }
            : { data: { access_token: 'a', refresh_token: 'r', target_path: '//evil.example' } };
        }
        if (c.op === 'from' && c.chain.some(([m]) => m === 'limit')) {
          return { data: [{ id: 'row-9', consumed_device: 'iOS - Safari', consumed_at: '2026-10-26T10:00:00Z' }] };
        }
        return { data: rowState, error: pollError };
      },
    });
    TestBed.configureTestingModule({ providers: [fake.provider] });
    return TestBed.inject(HandoffService);
  }

  beforeEach(() => {
    rowState = { consumed_at: null, consumed_device: null, revoked_at: null };
    pollError = null;
    revokeAnswer = { data: { revoked: true, outcome: 'revoked' } };
    createAnswer = () => ({
      data: { id: 'row-1', code: 'CODE', expires_at: new Date(Date.now() + 60_000).toISOString() },
    });
  });

  it('create() puts the code in the fragment and starts pending', async () => {
    const svc = setup();
    const made = await svc.create('/codex');
    expect(made.url).toBe(`${location.origin}/handoff#c=CODE`);
    expect(svc.status()).toBe('pending');
    expect(fake.calls.find((c) => c.target === 'handoff-create')?.args).toEqual({ body: { target_path: '/codex' } });
    svc.stopWatching();
  });

  it('create() sanitises an unsafe target path before sending it', async () => {
    const svc = setup();
    await svc.create('//evil.example');
    expect(fake.calls.find((c) => c.target === 'handoff-create')?.args).toEqual({ body: { target_path: '/' } });
    svc.stopWatching();
  });

  it('create() failure sets error status and rethrows', async () => {
    createAnswer = () => ({ error: new Error('boom') });
    const svc = setup();
    await expectAsync(svc.create('/')).toBeRejected();
    expect(svc.status()).toBe('error');
  });

  it('polling flips to connected with the device label, then to revoked', fakeAsync(() => {
    const svc = setup();
    void svc.create('/');
    tick(0);
    // consumed but no session attached (yet / failed mint): NOT connected
    rowState = { consumed_at: 'now', consumed_device: 'Android - Chrome', revoked_at: null, session_attached: false };
    tick(HANDOFF_POLL_MS);
    expect(svc.status()).toBe('pending');
    rowState = { consumed_at: 'now', consumed_device: 'Android - Chrome', revoked_at: null, session_attached: true };
    tick(HANDOFF_POLL_MS);
    expect(svc.status()).toBe('connected');
    expect(svc.device()).toBe('Android - Chrome');
    rowState = { consumed_at: 'now', consumed_device: 'Android - Chrome', revoked_at: 'now' };
    tick(HANDOFF_POLL_MS);
    expect(svc.status()).toBe('revoked');
    tick(HANDOFF_POLL_MS * 3);
  }));

  it('polling reports expired once the TTL passed unredeemed', fakeAsync(() => {
    createAnswer = () => ({ data: { id: 'row-1', code: 'C', expires_at: new Date(Date.now() + 3000).toISOString() } });
    const svc = setup();
    void svc.create('/');
    tick(0);
    tick(HANDOFF_POLL_MS * 2);
    expect(svc.status()).toBe('expired');
  }));

  it('a vanished row is an error after 3 polls, never a false expired', fakeAsync(() => {
    createAnswer = () => ({ data: { id: 'row-1', code: 'C', expires_at: new Date(Date.now() + 1).toISOString() } });
    const svc = setup();
    void svc.create('/');
    tick(0);
    rowState = null;
    tick(HANDOFF_POLL_MS);
    tick(HANDOFF_POLL_MS);
    expect(svc.status()).toBe('pending');
    tick(HANDOFF_POLL_MS);
    expect(svc.status()).toBe('error');
  }));

  it('stops watching a connected phone after the cap but stays connected', fakeAsync(() => {
    const svc = setup();
    void svc.create('/');
    tick(0);
    rowState = { consumed_at: 'now', consumed_device: 'X', revoked_at: null, session_attached: true };
    tick(HANDOFF_POLL_MS);
    const before = fake.calls.length;
    tick(HANDOFF_CONNECTED_WATCH_MS + HANDOFF_POLL_MS);
    const during = fake.calls.length;
    expect(during).toBeGreaterThan(before);
    tick(HANDOFF_POLL_MS * 5);
    expect(fake.calls.length).toBe(during);
    expect(svc.status()).toBe('connected');
  }));

  it('revoke() calls handoff-revoke with the row id', async () => {
    const svc = setup();
    await svc.create('/');
    await svc.revoke();
    expect(fake.calls.find((c) => c.target === 'handoff-revoke')?.args).toEqual({ body: { id: 'row-1' } });
    expect(svc.status()).toBe('revoked');
  });

  it('revoke() throws when the server changed nothing', async () => {
    revokeAnswer = { data: { revoked: false, outcome: 'none' } };
    const svc = setup();
    await expectAsync(svc.revoke('row-7')).toBeRejected();
  });

  it('listConnected() returns own attached, unrevoked rows', async () => {
    const svc = setup();
    const list = await svc.listConnected();
    expect(fake.calls[0].chain.some(([m, a]) => m === 'eq' && a[0] === 'session_attached' && a[1] === true)).toBeTrue();
    expect(list).toEqual([{ id: 'row-9', device: 'iOS - Safari', connectedAt: Date.parse('2026-10-26T10:00:00Z') }]);
  });

  it('peek() returns the masked account and never sends a redeem', async () => {
    const svc = setup();
    expect(await svc.peek('CODE')).toEqual({ account: 'j***@g***.com', userId: 'u-1', targetPath: '/codex' });
    expect(fake.calls[0].args).toEqual({ body: { code: 'CODE', peek: true } });
  });

  it('redeem() sets the session and returns a sanitised target', async () => {
    const svc = setup();
    const setSession = jasmine.createSpy('setSession').and.resolveTo({ error: null });
    (fake.client.auth as unknown as { setSession: unknown }).setSession = setSession;
    const target = await svc.redeem('CODE');
    expect(setSession).toHaveBeenCalledWith({ access_token: 'a', refresh_token: 'r' });
    expect(target).toBe('/');
  });

  it('errorKey() maps hand-off codes and falls back to errors.*', async () => {
    const svc = setup();
    const withBody = (error: string) => ({
      context: new Response(JSON.stringify({ error }), { status: 404 }),
    });
    expect(await svc.errorKey('redeem', withBody('invalid_code'))).toBe('handoff.errors.invalidCode');
    expect(await svc.errorKey('redeem', withBody('mint_failed'))).toBe('handoff.errors.mintFailed');
    expect(await svc.errorKey('redeem', withBody('auth_rate_limited'))).toBe('handoff.errors.authRateLimit');
    expect(await svc.errorKey('revoke', withBody('revoke_unavailable'))).toBe('handoff.errors.revokeUnavailable');
    expect(await svc.errorKey('redeem', new TypeError('Failed to fetch'))).toMatch(/^errors\./);
  });
});
