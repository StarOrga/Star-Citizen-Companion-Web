/**
 * Main-process session + sync orchestration.
 *
 * Wires the pure `SessionStore` / `VersionStore` to real Electron `safeStorage`
 * (encrypted at rest) and `node:fs` under `app.getPath('userData')`, and exposes
 * the connect / refresh / sync verbs the IPC layer calls. The operator signs in
 * ONCE; subsequent launches auto-connect (refreshing the access token silently)
 * and auto-sync the server catalog.
 */

import { app, safeStorage } from 'electron';
import log from 'electron-log';
import { existsSync, readFileSync, writeFileSync, renameSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { SessionStore, type PersistedSession, type BlobIO } from '../lib/session-store.js';
import { createTokenBroker, type TokenBroker, type TokenResult } from '../lib/token-broker.js';
import { VersionStore, type TextIO } from '../lib/version-store.js';
import { refreshSession } from '../lib/token-refresh.js';
import { fetchWithTimeout } from '../lib/fetch-timeout.js';
import { API_BASE, SUPABASE_ANON_KEY } from '../lib/release-token.js';
import {
  syncServerCatalog,
  type CatalogSnapshot,
  type SyncProgress,
  type SyncResult,
} from '../lib/sync.js';
import type { AuthResult } from '../lib/oauth.js';

const SESSION_FILE = 'session.bin';
const SYNC_FILE = 'sync-state.json';

let _sessionStore: SessionStore | null = null;
let _versionStore: VersionStore | null = null;
let _tokenBroker: TokenBroker | null = null;

function nowSec(): number {
  return Math.floor(Date.now() / 1000);
}

function sessionStore(): SessionStore {
  if (_sessionStore) return _sessionStore;
  const path = join(app.getPath('userData'), SESSION_FILE);
  const io: BlobIO = {
    read: () => (existsSync(path) ? readFileSync(path) : null),
    // Write-then-rename: the installer force-kills the app during an update,
    // and a half-written session.bin would read as "signed out" next launch.
    write: (data) => {
      const tmp = `${path}.tmp`;
      writeFileSync(tmp, data, { mode: 0o600 });
      renameSync(tmp, path);
    },
    remove: () => {
      try {
        rmSync(path, { force: true });
      } catch {
        /* best-effort */
      }
    },
  };
  _sessionStore = new SessionStore(safeStorage, io, (m) => log.warn(m));
  return _sessionStore;
}

function versionStore(): VersionStore {
  if (_versionStore) return _versionStore;
  const path = join(app.getPath('userData'), SYNC_FILE);
  const io: TextIO = {
    read: () => (existsSync(path) ? readFileSync(path, 'utf-8') : null),
    write: (text) => writeFileSync(path, text, 'utf-8'),
    remove: () => {
      try {
        rmSync(path, { force: true });
      } catch {
        /* best-effort */
      }
    },
  };
  _versionStore = new VersionStore(io);
  return _versionStore;
}

function tokenBroker(): TokenBroker {
  if (_tokenBroker) return _tokenBroker;
  const store = sessionStore();
  _tokenBroker = createTokenBroker({
    load: () => store.load(),
    save: (s) => {
      store.save(s);
    },
    clear: () => store.clear(),
    refresh: (rt) => refreshSession(API_BASE, SUPABASE_ANON_KEY, rt),
    nowSeconds: nowSec,
    warn: (m) => log.warn(m),
  });
  return _tokenBroker;
}

export interface SessionStatus {
  connected: boolean;
  email: string | null;
  /** Unix seconds. */
  expiresAt: number | null;
  /** Persistence possible on this OS (keyring available). */
  canPersist: boolean;
  /** A stored session is dead → user must reconnect with one click. */
  needsReconnect: boolean;
  /**
   * A stored session exists but could not be refreshed just now (offline,
   * timeout, server hiccup). Still signed in — the UI retries on its own
   * instead of asking for a new login.
   */
  retrying: boolean;
}

export type { TokenResult };

/** Persist a fresh OAuth result. Returns whether it was written to disk. */
export function persistAuthResult(auth: AuthResult): boolean {
  if (!auth.ok || !auth.accessToken) return false;
  const session: PersistedSession = {
    accessToken: auth.accessToken,
    refreshToken: auth.refreshToken ?? null,
    email: auth.userEmail ?? null,
    expiresAt: auth.expiresAt ?? null,
    savedAt: nowSec(),
  };
  tokenBroker().forget();
  return sessionStore().save(session);
}

/**
 * Return a valid access token, refreshing silently if the stored one expired.
 * `token: null` = no usable session; `reconnect: true` = the refresh lineage is
 * dead and the UI should prompt for a fresh login; `retry: true` = transient
 * failure, the session is kept. Concurrent callers share one refresh.
 */
export function ensureAccessToken(): Promise<TokenResult> {
  return tokenBroker().ensureAccessToken();
}

export async function getSessionStatus(): Promise<SessionStatus> {
  const store = sessionStore();
  const canPersist = store.canPersist();
  const session = store.load();
  if (!session) {
    return { connected: false, email: null, expiresAt: null, canPersist, needsReconnect: false, retrying: false };
  }
  const tokenRes = await ensureAccessToken();
  if (!tokenRes.token) {
    return {
      connected: false,
      email: session.email,
      expiresAt: session.expiresAt,
      canPersist,
      needsReconnect: tokenRes.reconnect,
      retrying: tokenRes.retry,
    };
  }
  const fresh = store.load();
  return {
    connected: true,
    email: tokenRes.email,
    expiresAt: fresh?.expiresAt ?? null,
    canPersist,
    needsReconnect: false,
    retrying: false,
  };
}

export function clearSession(): void {
  tokenBroker().forget();
  sessionStore().clear();
}

export function getCachedSnapshot(): CatalogSnapshot | null {
  return versionStore().load().snapshot;
}

export async function runSync(onProgress: (p: SyncProgress) => void): Promise<SyncResult> {
  const tokenRes = await ensureAccessToken();
  if (!tokenRes.token) {
    const error = tokenRes.reconnect ? 'reconnect' : 'not_connected';
    onProgress({ phase: 'error', pct: 100, message: error });
    return { ok: false, error };
  }
  const vstore = versionStore();
  const result = await syncServerCatalog({
    apiBase: API_BASE,
    anonKey: SUPABASE_ANON_KEY,
    accessToken: tokenRes.token,
    onProgress: (p) => {
      // Remember progress so an interrupted sync resumes its tile next launch.
      vstore.saveCheckpoint({ phase: p.phase, pct: p.pct, updatedAt: nowSec() });
      onProgress(p);
    },
  });
  if (result.ok && result.snapshot) vstore.saveSnapshot(result.snapshot);
  return result;
}

/**
 * Resolve the signed-in user's role via the `current_user_role` RPC so the
 * renderer can gate the channel picker. Best-effort: any failure (offline, no
 * session, unexpected shape) yields 'viewer' — the safe, no-picker default.
 */
export async function fetchUserRole(): Promise<'admin' | 'collaborator' | 'viewer'> {
  const { token } = await ensureAccessToken();
  if (!token) return 'viewer';
  try {
    const res = await fetchWithTimeout(`${API_BASE}/rest/v1/rpc/current_user_role`, {
      method: 'POST',
      headers: {
        apikey: SUPABASE_ANON_KEY,
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
      },
      body: '{}',
    }, 15_000);
    if (!res.ok) return 'viewer';
    const role: unknown = await res.json();
    return role === 'admin' || role === 'collaborator' ? role : 'viewer';
  } catch {
    return 'viewer';
  }
}
