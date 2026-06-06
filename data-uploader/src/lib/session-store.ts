/**
 * Persistent session store for the desktop tool.
 *
 * Holds the Supabase session (access + refresh token) ENCRYPTED AT REST so the
 * operator signs in ONCE instead of on every launch. Encryption is delegated to
 * Electron `safeStorage` (DPAPI on Windows / Keychain / libsecret). If the OS
 * keyring is unavailable we DO NOT persist — tokens never touch disk in
 * plaintext; the tool falls back to the in-memory, re-auth-per-launch behavior.
 *
 * Pure logic + injected I/O so it is unit-testable without Electron.
 */

export interface PersistedSession {
  accessToken: string;
  refreshToken: string | null;
  email: string | null;
  /** Unix seconds when the access token expires (Supabase `expires_at`). */
  expiresAt: number | null;
  /** Unix seconds when this record was written (audit only). */
  savedAt: number;
}

/** Subset of Electron's `safeStorage` we depend on — injectable for tests. */
export interface SafeStorageLike {
  isEncryptionAvailable(): boolean;
  encryptString(plainText: string): Buffer;
  decryptString(encrypted: Buffer): string;
}

/** Injectable blob persistence (file-backed in production). */
export interface BlobIO {
  read(): Buffer | null;
  write(data: Buffer): void;
  remove(): void;
}

const SCHEMA_VERSION = 1;

interface Envelope {
  v: number;
  session: PersistedSession;
}

export class SessionStore {
  constructor(
    private readonly safe: SafeStorageLike,
    private readonly io: BlobIO,
  ) {}

  /** True when persistence is possible (OS keyring available). */
  canPersist(): boolean {
    return this.safe.isEncryptionAvailable();
  }

  /**
   * Persist the session encrypted. Returns false (and writes nothing) when the
   * OS keyring is unavailable — caller keeps the session in memory only.
   */
  save(session: PersistedSession): boolean {
    if (!this.safe.isEncryptionAvailable()) return false;
    const envelope: Envelope = { v: SCHEMA_VERSION, session };
    const encrypted = this.safe.encryptString(JSON.stringify(envelope));
    this.io.write(encrypted);
    return true;
  }

  /** Load + decrypt the session, or null if absent/unreadable/incompatible. */
  load(): PersistedSession | null {
    if (!this.safe.isEncryptionAvailable()) return null;
    const blob = this.io.read();
    if (!blob || blob.length === 0) return null;
    try {
      const json = this.safe.decryptString(blob);
      const parsed = JSON.parse(json) as Partial<Envelope>;
      if (parsed.v !== SCHEMA_VERSION || !parsed.session) return null;
      const s = parsed.session;
      if (typeof s.accessToken !== 'string' || s.accessToken.length === 0) return null;
      return {
        accessToken: s.accessToken,
        refreshToken: typeof s.refreshToken === 'string' ? s.refreshToken : null,
        email: typeof s.email === 'string' ? s.email : null,
        expiresAt: typeof s.expiresAt === 'number' ? s.expiresAt : null,
        savedAt: typeof s.savedAt === 'number' ? s.savedAt : 0,
      };
    } catch {
      return null;
    }
  }

  clear(): void {
    this.io.remove();
  }
}

/**
 * True when the access token is still valid `skewSeconds` into the future.
 * `expiresAt` of null = unknown → treat as expired (force a refresh / reauth).
 */
export function isAccessTokenFresh(
  session: Pick<PersistedSession, 'expiresAt'>,
  nowSeconds: number,
  skewSeconds = 60,
): boolean {
  if (session.expiresAt === null) return false;
  return session.expiresAt - skewSeconds > nowSeconds;
}
