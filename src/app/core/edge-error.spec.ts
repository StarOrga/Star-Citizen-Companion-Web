import { readErrorBody } from './edge-error';

describe('readErrorBody', () => {
  it('reads the JSON body off a FunctionsHttpError-shaped error', async () => {
    const error = {
      context: new Response(JSON.stringify({ error: 'forbidden', message: 'Nur Admins' }), { status: 403 }),
    };
    expect(await readErrorBody(error)).toEqual({ error: 'forbidden', message: 'Nur Admins' });
  });

  it('leaves the Response body readable for other callers (clone)', async () => {
    const res = new Response(JSON.stringify({ error: 'x' }), { status: 400 });
    await readErrorBody({ context: res });
    expect(await res.json()).toEqual({ error: 'x' });
  });

  it('returns {} when the context is not a Response', async () => {
    expect(await readErrorBody({ context: 'nope' })).toEqual({});
    expect(await readErrorBody(new Error('network'))).toEqual({});
    expect(await readErrorBody(null)).toEqual({});
  });

  it('returns {} for a broken JSON body', async () => {
    expect(await readErrorBody({ context: new Response('<html>502</html>', { status: 502 }) })).toEqual({});
  });

  it('returns {} for a JSON body that is not an object', async () => {
    expect(await readErrorBody({ context: new Response('42', { status: 500 }) })).toEqual({});
  });
});
