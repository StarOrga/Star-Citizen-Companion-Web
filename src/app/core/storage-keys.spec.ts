import { LEGACY_STORAGE_PREFIX, STORAGE_PREFIX, legacyStorageKey, readMigrated, removeWithLegacy } from './storage-keys';

describe('storage-keys', () => {
  const key = `${STORAGE_PREFIX}spec.value`;
  const legacy = `${LEGACY_STORAGE_PREFIX}spec.value`;

  beforeEach(() => {
    localStorage.removeItem(key);
    localStorage.removeItem(legacy);
  });
  afterEach(() => {
    localStorage.removeItem(key);
    localStorage.removeItem(legacy);
  });

  it('maps a new key to its legacy twin and ignores foreign keys', () => {
    expect(legacyStorageKey(key)).toBe(legacy);
    expect(legacyStorageKey('sc.auth')).toBeNull();
  });

  it('reads the new key and leaves a stale legacy key alone', () => {
    localStorage.setItem(key, 'new');
    localStorage.setItem(legacy, 'old');
    expect(readMigrated(key)).toBe('new');
    expect(localStorage.getItem(legacy)).toBe('old');
  });

  it('migrates a legacy-only value: new key written, old key removed', () => {
    localStorage.setItem(legacy, '["a"]');
    expect(readMigrated(key)).toBe('["a"]');
    expect(localStorage.getItem(key)).toBe('["a"]');
    expect(localStorage.getItem(legacy)).toBeNull();
  });

  it('returns null and writes nothing when neither exists', () => {
    expect(readMigrated(key)).toBeNull();
    expect(localStorage.getItem(key)).toBeNull();
    expect(localStorage.getItem(legacy)).toBeNull();
  });

  it('keeps the legacy key when the new key cannot be written', () => {
    localStorage.setItem(legacy, 'old');
    const storage = {
      getItem: (k: string) => localStorage.getItem(k),
      setItem: () => {
        throw new Error('quota');
      },
      removeItem: (k: string) => localStorage.removeItem(k),
    } as unknown as Storage;
    expect(readMigrated(key, storage)).toBeNull();
    expect(localStorage.getItem(legacy)).toBe('old');
  });

  it('removeWithLegacy clears both names', () => {
    localStorage.setItem(key, 'a');
    localStorage.setItem(legacy, 'b');
    removeWithLegacy(key);
    expect(localStorage.getItem(key)).toBeNull();
    expect(localStorage.getItem(legacy)).toBeNull();
  });
});
