import { HttpErrorResponse } from '@angular/common/http';
import de from '../../../public/i18n/de.json';
import en from '../../../public/i18n/en.json';
import { ERROR_KINDS, describeError, toErrorKey } from './describe-error';

type Catalogue = Record<string, unknown>;

function lookup(cat: Catalogue, key: string): unknown {
  return key.split('.').reduce<unknown>((node, part) => (node as Catalogue | undefined)?.[part], cat);
}

describe('describeError', () => {
  const kind = (err: unknown, online = true) => describeError(err, online).kind;

  it('timeout: statement timeout, DOMException, deadline message, 504', () => {
    expect(kind({ code: '57014', message: 'canceling statement due to statement timeout' })).toBe('timeout');
    expect(kind(new DOMException('x', 'TimeoutError'))).toBe('timeout');
    expect(kind({ message: 'AbortError: TimeoutError: read deadline 20000 ms exceeded', code: '' })).toBe('timeout');
    expect(kind({ status: 504 })).toBe('timeout');
    expect(kind({ code: 'request_timeout', status: 504 })).toBe('timeout');
  });

  it('network: fetch TypeError, PostgREST transport wrapper, HTTP status 0', () => {
    expect(kind(new TypeError('Failed to fetch'))).toBe('network');
    expect(kind(new TypeError('Load failed'))).toBe('network');
    expect(kind({ message: 'TypeError: Failed to fetch', code: '' })).toBe('network');
    expect(kind(new HttpErrorResponse({ status: 0 }))).toBe('network');
    expect(kind({ name: 'FunctionsFetchError', message: 'Failed to send a request' })).toBe('network');
  });

  it('offline replaces network and timeout while the browser is offline', () => {
    expect(kind(new TypeError('Failed to fetch'), false)).toBe('offline');
    expect(kind({ code: '57014' }, false)).toBe('offline');
    // A server answer is not an offline symptom.
    expect(kind({ code: 'XX000' }, false)).toBe('server');
  });

  it('rateLimit, sessionExpired, forbidden, notFound', () => {
    expect(kind({ status: 429 })).toBe('rateLimit');
    expect(kind({ code: 'over_email_send_rate_limit', status: 429 })).toBe('rateLimit');
    expect(kind({ status: 401 })).toBe('sessionExpired');
    expect(kind({ code: 'PGRST301', message: 'JWT expired' })).toBe('sessionExpired');
    expect(kind({ name: 'AuthSessionMissingError', message: 'Auth session missing!' })).toBe('sessionExpired');
    expect(kind({ code: '42501' })).toBe('forbidden');
    expect(kind({ message: 'forbidden: admin role required', code: 'P0001' })).toBe('forbidden');
    expect(kind({ status: 403 })).toBe('forbidden');
    expect(kind({ code: 'PGRST116' })).toBe('notFound');
    expect(kind({ status: 404 })).toBe('notFound');
  });

  it('reads the status off a FunctionsHttpError Response', () => {
    const err = { name: 'FunctionsHttpError', context: new Response('{}', { status: 403 }) };
    expect(kind(err)).toBe('forbidden');
    const srv = { name: 'FunctionsHttpError', context: new Response('{}', { status: 500 }) };
    expect(kind(srv)).toBe('server');
  });

  it('server: PostgREST error with a code, 5xx', () => {
    expect(kind({ code: 'XX000' })).toBe('server');
    expect(kind({ status: 500 })).toBe('server');
  });

  it('generic: strings, null, plain errors, auth 4xx codes', () => {
    expect(kind('string')).toBe('generic');
    expect(kind(null)).toBe('generic');
    expect(kind(undefined)).toBe('generic');
    expect(kind(new Error('boom'))).toBe('generic');
    expect(kind({ code: 'invalid_credentials', status: 400 })).toBe('generic');
  });

  it('keeps the raw text in detail and a key of the form errors.<kind>', () => {
    const d = describeError({ code: '57014', message: 'canceling statement' }, true);
    expect(d.key).toBe('errors.timeout');
    expect(d.detail).toContain('canceling statement');
    expect(d.detail).toContain('57014');
  });

  it('toErrorKey logs exactly once and returns only the key', () => {
    const warn = spyOn(console, 'warn');
    const err = new Error('boom');
    const key = toErrorKey('codex', 'list', err, { id: 7 });
    expect(key).toBe('errors.generic');
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.calls.mostRecent().args[0]).toBe('[codex] list failed');
    expect(warn.calls.mostRecent().args[1]).toEqual({ id: 7, error: err });
  });

  it('every key describeError can return (plus errors.retry) exists in de and en', () => {
    const keys = [...ERROR_KINDS.map((k) => `errors.${k}`), 'errors.retry'];
    for (const key of keys) {
      expect(typeof lookup(de as Catalogue, key)).withContext(`de ${key}`).toBe('string');
      expect(typeof lookup(en as Catalogue, key)).withContext(`en ${key}`).toBe('string');
    }
  });
});
