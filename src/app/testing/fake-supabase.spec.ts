import { environment } from '../../environments/environment';
import { chainArgs, FakeCall, fakeSupabase } from './fake-supabase';

describe('fakeSupabase', () => {
  it('records the builder chain in call order and answers with table and chain', async () => {
    const seen: FakeCall[] = [];
    const fake = fakeSupabase({
      answer: (call) => {
        seen.push(call);
        return { data: [{ id: 1 }], error: null, count: 1 };
      },
    });

    const res = await (fake.client.from('hangar_ships') as unknown as {
      select: (c: string) => { eq: (k: string, v: string) => { order: (k: string) => PromiseLike<unknown> } };
    })
      .select('*')
      .eq('user_id', 'u1')
      .order('created_at');

    expect(res).toEqual({ data: [{ id: 1 }], error: null, count: 1 });
    expect(seen.length).toBe(1);
    expect(seen[0].op).toBe('from');
    expect(seen[0].target).toBe('hangar_ships');
    expect(seen[0].chain).toEqual([
      ['select', ['*']],
      ['eq', ['user_id', 'u1']],
      ['order', ['created_at']],
    ]);
    expect(chainArgs(seen[0], 'eq')).toEqual(['user_id', 'u1']);
    expect(fake.calls).toEqual(seen);
  });

  it('defaults to { data: null, error: null } and accepts a promised answer', async () => {
    const plain = fakeSupabase();
    expect(await (plain.client.from('x') as PromiseLike<unknown>)).toEqual({ data: null, error: null });

    const deferred = fakeSupabase({ answer: () => Promise.resolve({ data: 'late' }) });
    expect(await (deferred.client.rpc('slow') as PromiseLike<unknown>)).toEqual({ data: 'late', error: null });
  });

  it('logs rpc and functions.invoke calls with their arguments', async () => {
    const fake = fakeSupabase({
      answer: (call) => (call.op === 'invoke' ? { data: { ok: true } } : { data: 42 }),
    });

    const rpc = await (fake.client.rpc('set_user_role', { target: 'u2', new_role: 'admin' }) as PromiseLike<unknown>);
    const fn = await fake.client.functions.invoke('invite-user', { body: { email: 'a@example.com' } });

    expect(rpc).toEqual({ data: 42, error: null });
    expect(fn).toEqual({ data: { ok: true }, error: null });
    expect(fake.calls.map((c) => [c.op, c.target, c.args])).toEqual([
      ['rpc', 'set_user_role', { target: 'u2', new_role: 'admin' }],
      ['invoke', 'invite-user', { body: { email: 'a@example.com' } }],
    ]);
  });

  it('logs a call as soon as it is sent, before its answer settles', async () => {
    let release: (r: { data: unknown }) => void = () => undefined;
    const fake = fakeSupabase({ answer: () => new Promise((r) => (release = r)) });

    const pending = fake.client.functions.invoke('delete-user');
    expect(fake.calls.map((c) => c.target)).toEqual(['delete-user']);
    release({ data: 'done' });
    expect(await pending).toEqual({ data: 'done', error: null });
  });

  it('serves the scripted session, auth events and the provider', async () => {
    const session = { access_token: 'tok', user: { id: 'u1', email: 'pilot@example.com' } };
    const fake = fakeSupabase({ session });

    expect((await fake.client.auth.getSession()).data.session).toEqual(session);

    const events: string[] = [];
    fake.client.auth.onAuthStateChange((event) => events.push(event));
    fake.emitAuth('SIGNED_OUT', null);
    expect(events).toEqual(['SIGNED_OUT']);
    expect((await fake.client.auth.getSession()).data.session).toBeNull();

    await fake.client.auth.signOut();
    expect(fake.client.auth.signOut).toHaveBeenCalledTimes(1);

    const sb = fake.provider.useValue as unknown as { client: unknown; realClient: unknown };
    expect(sb.client).toBe(fake.client);
    expect(sb.realClient).toBe(fake.client);
    expect(fake.client.supabaseUrl).toBe(environment.supabase.url);
  });
});
