import de from '../../../public/i18n/de.json';
import en from '../../../public/i18n/en.json';
import { AUTH_ERROR_KEYS, authErrorKey } from './auth-error-key';

type Catalogue = Record<string, unknown>;

function lookup(cat: Catalogue, key: string): unknown {
  return key.split('.').reduce<unknown>((node, part) => (node as Catalogue | undefined)?.[part], cat);
}

describe('authErrorKey', () => {
  beforeEach(() => spyOn(console, 'warn'));

  const cases: [string, string][] = [
    ['invalid_credentials', 'auth.errors.invalidCredentials'],
    ['email_not_confirmed', 'auth.errors.emailNotConfirmed'],
    ['over_request_rate_limit', 'auth.errors.rateLimit'],
    ['over_email_send_rate_limit', 'auth.errors.rateLimit'],
    ['weak_password', 'auth.errors.weakPassword'],
    ['same_password', 'auth.errors.samePassword'],
    ['email_address_invalid', 'auth.errors.emailInvalid'],
    ['validation_failed', 'auth.errors.emailInvalid'],
    ['otp_expired', 'auth.errors.linkExpired'],
  ];

  for (const [code, key] of cases) {
    it(`maps ${code} to ${key}`, () => {
      expect(authErrorKey({ code, status: 400, message: 'raw auth-js text' })).toBe(key);
    });
  }

  it('falls back to the general translator for unknown codes and transport errors', () => {
    expect(authErrorKey({ code: 'something_new', status: 400 })).toBe('errors.generic');
    expect(authErrorKey(new TypeError('Failed to fetch'))).toBe('errors.network');
    expect(authErrorKey({ status: 429 })).toBe('errors.rateLimit');
  });

  it('logs the raw error once', () => {
    const err = { code: 'invalid_credentials', message: 'Invalid login credentials' };
    authErrorKey(err, 'sign-in');
    expect(console.warn).toHaveBeenCalledOnceWith('[auth] sign-in failed', err);
  });

  it('every key exists in de and en', () => {
    for (const key of AUTH_ERROR_KEYS) {
      expect(typeof lookup(de as Catalogue, key)).withContext(`de ${key}`).toBe('string');
      expect(typeof lookup(en as Catalogue, key)).withContext(`en ${key}`).toBe('string');
    }
  });
});
