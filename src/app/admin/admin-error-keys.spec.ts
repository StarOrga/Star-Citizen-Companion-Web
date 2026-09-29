import de from '../../../public/i18n/de.json';
import en from '../../../public/i18n/en.json';

import {
  DELETE_USER_ERROR_CODES,
  INVITE_ERROR_CODES,
  adminRpcErrorKey,
  deleteUserErrorKey,
  inviteErrorKey,
} from './admin-error-keys';

function lookup(catalogue: unknown, key: string): unknown {
  return key.split('.').reduce<unknown>(
    (node, part) => (node && typeof node === 'object' ? (node as Record<string, unknown>)[part] : undefined),
    catalogue,
  );
}

describe('admin-error-keys', () => {
  it('maps every invite-user code to admin.register.err.<code>', () => {
    for (const code of INVITE_ERROR_CODES) {
      expect(inviteErrorKey(code)).toBe(`admin.register.err.${code}`);
    }
  });

  it('falls back to admin.register.unknownError for an unknown or missing invite code', () => {
    expect(inviteErrorKey('something_new')).toBe('admin.register.unknownError');
    expect(inviteErrorKey(null)).toBe('admin.register.unknownError');
    expect(inviteErrorKey('')).toBe('admin.register.unknownError');
  });

  it('maps every delete-user code to admin.delete.err.<code>', () => {
    for (const code of DELETE_USER_ERROR_CODES) {
      expect(deleteUserErrorKey(code)).toBe(`admin.delete.err.${code}`);
    }
  });

  it('falls back to the given key for an unknown delete-user code', () => {
    expect(deleteUserErrorKey('nope')).toBe('admin.delete.failed');
    expect(deleteUserErrorKey(null)).toBe('admin.delete.failed');
    expect(deleteUserErrorKey('nope', 'settings.danger.failed')).toBe('settings.danger.failed');
  });

  it('does not treat Object.prototype names as known codes', () => {
    expect(inviteErrorKey('toString')).toBe('admin.register.unknownError');
    expect(deleteUserErrorKey('constructor')).toBe('admin.delete.failed');
  });

  it('maps admin RPC prefixes before the generic translator', () => {
    expect(adminRpcErrorKey({ message: 'protected_admin: this account is protected' }))
      .toBe('admin.delete.err.protected_admin');
    expect(adminRpcErrorKey({ message: 'forbidden: admin role required' })).toBe('errors.forbidden');
    expect(adminRpcErrorKey({ message: 'TypeError: Failed to fetch' })).toBeNull();
    expect(adminRpcErrorKey(null)).toBeNull();
  });

  it('every key both lists can produce exists in de.json and en.json', () => {
    const keys = [
      ...INVITE_ERROR_CODES.map(inviteErrorKey),
      inviteErrorKey(null),
      ...DELETE_USER_ERROR_CODES.map((c) => deleteUserErrorKey(c)),
      deleteUserErrorKey(null),
      'adminFeedback.threadsStale',
    ];
    for (const key of keys) {
      expect(typeof lookup(de, key)).withContext(`de: ${key}`).toBe('string');
      expect(typeof lookup(en, key)).withContext(`en: ${key}`).toBe('string');
    }
  });
});
