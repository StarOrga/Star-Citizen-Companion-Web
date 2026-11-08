/**
 * Product-prefixed localStorage keys (Verse Companion rename, stage 2).
 *
 * Keys used to be `sc-companion.<name>`; they are now `verse-companion.<name>`. Nobody loses data: a
 * read looks at the new key first, then at the legacy one, and a legacy hit is moved over (new key
 * written, old key removed). Writes only ever go to the new key.
 *
 * Out of scope on purpose: the short `sc.*` keys (`sc.auth`, `sc.lang`, `sc.consent`, ...) are an
 * app-wide prefix, not the product name; `sc.auth` in particular must never change (it would sign
 * everyone out).
 */

export const STORAGE_PREFIX = 'verse-companion.';
/** The pre-rename prefix. Only the migration and the consent purge may name it. */
export const LEGACY_STORAGE_PREFIX = 'sc-companion.';

/** The legacy twin of a `verse-companion.*` key (`null` for a key outside the prefix). */
export function legacyStorageKey(key: string): string | null {
  return key.startsWith(STORAGE_PREFIX) ? LEGACY_STORAGE_PREFIX + key.slice(STORAGE_PREFIX.length) : null;
}

function defaultStorage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

/**
 * The value under `key`, falling back to its legacy twin. A legacy hit is migrated: the new key is
 * written and the old one removed (a failed write keeps the old key, so the next read tries again).
 * Never throws; storage that is missing or blocked reads as `null`.
 */
export function readMigrated(key: string, storage: Storage | null = defaultStorage()): string | null {
  if (!storage) return null;
  try {
    const current = storage.getItem(key);
    if (current !== null) return current;
    const legacyKey = legacyStorageKey(key);
    if (!legacyKey) return null;
    const legacy = storage.getItem(legacyKey);
    if (legacy === null) return null;
    storage.setItem(key, legacy);
    storage.removeItem(legacyKey);
    return legacy;
  } catch {
    return null;
  }
}

/** Removes the key and its legacy twin. */
export function removeWithLegacy(key: string, storage: Storage | null = defaultStorage()): void {
  if (!storage) return;
  const legacyKey = legacyStorageKey(key);
  for (const k of legacyKey ? [key, legacyKey] : [key]) {
    try {
      storage.removeItem(k);
    } catch {
      /* private mode */
    }
  }
}
