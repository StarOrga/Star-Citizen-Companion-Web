import { readEdgeErrorCode, readErrorBody } from './edge-error';

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

describe('readEdgeErrorCode', () => {
  it('takes the code from data on a 2xx envelope', async () => {
    expect(await readEdgeErrorCode(null, { error: 'x' })).toBe('x');
  });

  it('reads the code from the Response body on a non-2xx answer', async () => {
    const error = { context: new Response(JSON.stringify({ error: 'invalid_email' }), { status: 400 }) };
    expect(await readEdgeErrorCode(error, null)).toBe('invalid_email');
  });

  it('returns null for a body without JSON', async () => {
    const error = { context: new Response('<html>502</html>', { status: 502 }) };
    expect(await readEdgeErrorCode(error, null)).toBeNull();
  });
});
