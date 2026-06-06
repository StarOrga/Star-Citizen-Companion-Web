import { describe, it, expect } from 'vitest';
import {
  SessionStore,
  isAccessTokenFresh,
  type PersistedSession,
  type SafeStorageLike,
  type BlobIO,
} from '../src/lib/session-store.js';

function fakeSafe(available = true): SafeStorageLike {
  return {
    isEncryptionAvailable: () => available,
    // Reversible "encryption" — prefix so we can assert it was used + detect garbage.
    encryptString: (s) => Buffer.from('enc:' + s, 'utf-8'),
    decryptString: (b) => {
      const raw = b.toString('utf-8');
      if (!raw.startsWith('enc:')) throw new Error('not encrypted by this keyring');
      return raw.slice(4);
    },
  };
}

function fakeIO(): BlobIO {
  let data: Buffer | null = null;
  return {
    read: () => data,
    write: (d) => {
      data = d;
    },
    remove: () => {
      data = null;
    },
  };
}

const sample: PersistedSession = {
  accessToken: 'access-abc',
  refreshToken: 'refresh-xyz',
  email: 'pilot@example.com',
  expiresAt: 1_700_000_000,
  savedAt: 1_699_999_000,
};

describe('SessionStore', () => {
  it('round-trips a session through encryption + storage', () => {
    const store = new SessionStore(fakeSafe(), fakeIO());
    expect(store.save(sample)).toBe(true);
    expect(store.load()).toEqual(sample);
  });

  it('routes persistence through the keyring (never writes raw JSON)', () => {
    // The real at-rest encryption is safeStorage's (DPAPI) job; here we assert
    // SessionStore DELEGATES to encryptString rather than writing the plaintext
    // envelope itself (the fake keyring prefixes 'enc:' to mark the round-trip).
    const io = fakeIO();
    const store = new SessionStore(fakeSafe(), io);
    store.save(sample);
    const stored = io.read()!.toString('utf-8');
    expect(stored.startsWith('enc:')).toBe(true);
    expect(stored).not.toBe(JSON.stringify({ v: 1, session: sample }));
  });

  it('does NOT persist when the OS keyring is unavailable', () => {
    const io = fakeIO();
    const store = new SessionStore(fakeSafe(false), io);
    expect(store.save(sample)).toBe(false);
    expect(io.read()).toBeNull();
    expect(store.load()).toBeNull();
  });

  it('returns null for an empty store', () => {
    expect(new SessionStore(fakeSafe(), fakeIO()).load()).toBeNull();
  });

  it('returns null for a corrupt / foreign blob', () => {
    const io = fakeIO();
    io.write(Buffer.from('garbage-not-ours', 'utf-8'));
    expect(new SessionStore(fakeSafe(), io).load()).toBeNull();
  });

  it('clears the stored session', () => {
    const io = fakeIO();
    const store = new SessionStore(fakeSafe(), io);
    store.save(sample);
    store.clear();
    expect(io.read()).toBeNull();
    expect(store.load()).toBeNull();
  });

  it('normalizes a session missing optional fields', () => {
    const io = fakeIO();
    const safe = fakeSafe();
    // Hand-craft an envelope with only the required accessToken.
    io.write(safe.encryptString(JSON.stringify({ v: 1, session: { accessToken: 'only-access' } })));
    const loaded = new SessionStore(safe, io).load();
    expect(loaded).toEqual({
      accessToken: 'only-access',
      refreshToken: null,
      email: null,
      expiresAt: null,
      savedAt: 0,
    });
  });

  it('rejects an envelope with no usable access token', () => {
    const io = fakeIO();
    const safe = fakeSafe();
    io.write(safe.encryptString(JSON.stringify({ v: 1, session: { accessToken: '' } })));
    expect(new SessionStore(safe, io).load()).toBeNull();
  });
});

describe('isAccessTokenFresh', () => {
  it('is fresh well before expiry', () => {
    expect(isAccessTokenFresh({ expiresAt: 1000 }, 800)).toBe(true);
  });
  it('is stale within the skew window', () => {
    expect(isAccessTokenFresh({ expiresAt: 1000 }, 970, 60)).toBe(false);
  });
  it('is stale after expiry', () => {
    expect(isAccessTokenFresh({ expiresAt: 1000 }, 1200)).toBe(false);
  });
  it('treats unknown expiry as stale', () => {
    expect(isAccessTokenFresh({ expiresAt: null }, 0)).toBe(false);
  });
});
