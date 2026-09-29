import { TestBed } from '@angular/core/testing';
import { environment } from '../../../environments/environment';
import { fakeSupabase } from '../../testing/fake-supabase';
import { ApiTokensService } from './api-tokens.service';

describe('ApiTokensService', () => {
  const base = `${environment.supabase.url}/functions/v1/api/v1/tokens`;
  let fetchSpy: jasmine.Spy;

  function setup(
    session: { access_token: string; user: { id: string } } | null = {
      access_token: 'jwt-1',
      user: { id: 'u1' },
    },
  ): ApiTokensService {
    const fake = fakeSupabase({ session });
    TestBed.configureTestingModule({ providers: [fake.provider] });
    return TestBed.inject(ApiTokensService);
  }

  function reply(status: number, body: unknown): void {
    fetchSpy.and.resolveTo({
      ok: status >= 200 && status < 300,
      status,
      json: () => (body === undefined ? Promise.reject(new Error('no body')) : Promise.resolve(body)),
    } as unknown as Response);
  }

  beforeEach(() => {
    fetchSpy = spyOn(window, 'fetch');
  });

  it('list GETs the tokens route with the session bearer and unwraps data', async () => {
    reply(200, { data: [{ id: 't1' }] });
    const rows = await setup().list();
    expect(rows).toEqual([{ id: 't1' }] as never);
    const [url, init] = fetchSpy.calls.mostRecent().args as [string, RequestInit];
    expect(url).toBe(base);
    expect(init.method).toBe('GET');
    expect(init.headers).toEqual(jasmine.objectContaining({ Authorization: 'Bearer jwt-1' }));
  });

  it('list answers an empty array when the body has no data', async () => {
    reply(200, {});
    expect(await setup().list()).toEqual([]);
  });

  it('omits the Authorization header without a session', async () => {
    reply(200, { data: [] });
    await setup(null).list();
    const init = fetchSpy.calls.mostRecent().args[1] as RequestInit;
    expect(Object.keys(init.headers as object)).not.toContain('Authorization');
  });

  it('create POSTs name and scopes and returns the created token', async () => {
    const created = { plaintext: 'scc_abc', token: { id: 't2' } };
    reply(201, { data: created });
    const out = await setup().create('CI', ['news:read']);
    expect(out).toEqual(created as never);
    const [url, init] = fetchSpy.calls.mostRecent().args as [string, RequestInit];
    expect(url).toBe(base);
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body as string)).toEqual({ name: 'CI', scopes: ['news:read'] });
    expect(init.headers).toEqual(jasmine.objectContaining({ Authorization: 'Bearer jwt-1' }));
  });

  it('revoke DELETEs the token id route', async () => {
    reply(204, undefined);
    await setup().revoke('t9');
    const [url, init] = fetchSpy.calls.mostRecent().args as [string, RequestInit];
    expect(url).toBe(`${base}/t9`);
    expect(init.method).toBe('DELETE');
    expect(init.headers).toEqual(jasmine.objectContaining({ Authorization: 'Bearer jwt-1' }));
  });

  it('throws the envelope code with the HTTP status', async () => {
    reply(403, { error: { code: 'forbidden', message: 'Nope' } });
    const err = await setup()
      .list()
      .catch((e) => e);
    expect(err.message).toBe('forbidden');
    expect(err.code).toBe('forbidden');
    expect(err.status).toBe(403);
  });

  it('falls back to <route>_failed when the error body is missing', async () => {
    const svc = setup();
    reply(500, undefined);
    const list = await svc.list().catch((e) => e);
    expect(list.message).toBe('list_failed');
    expect(list.status).toBe(500);
    expect(list.code).toBeUndefined();

    const create = await svc.create('x', []).catch((e) => e);
    expect(create.message).toBe('create_failed');

    const revoke = await svc.revoke('t1').catch((e) => e);
    expect(revoke.message).toBe('revoke_failed');
    expect(revoke.status).toBe(500);
  });
});
