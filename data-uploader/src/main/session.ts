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
import { existsSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import {
  SessionStore,
  isAccessTokenFresh,
  type PersistedSession,
  type BlobIO,
} from '../lib/session-store.js';
import { VersionStore, type TextIO } from '../lib/version-store.js';
import { refreshSession } from '../lib/token-refresh.js';
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

function nowSec(): number {
  return Math.floor(Date.now() / 1000);
}

function sessionStore(): SessionStore {
  if (_sessionStore) return _sessionStore;
  const path = join(app.getPath('userData'), SESSION_FILE);
  const io: BlobIO = {
    read: () => (existsSync(path) ? readFileSync(path) : null),
    write: (data) => writeFileSync(path, data, { mode: 0o600 }),
    remove: () => {
      try {
        rmSync(path, { force: true });
      } catch {
        /* best-effort */
      }
    },
  };
  _sessionStore = new SessionStore(safeStorage, io);
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

export interface SessionStatus {
  connected: boolean;
  email: string | null;
  /** Unix seconds. */
  expiresAt: number | null;
  /** Persistence possible on this OS (keyring available). */
  canPersist: boolean;
  /** A stored session is dead → user must reconnect with one click. */
  needsReconnect: boolean;
}

export interface TokenResult {
  token: string | null;
  email: string | null;
  reconnect: boolean;
}

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
  return sessionStore().save(session);
}

/**
 * Return a valid access token, refreshing silently if the stored one expired.
 * `token: null` = no usable session; `reconnect: true` = the refresh lineage is
 * dead and the UI should prompt for a fresh login.
 */
export async function ensureAccessToken(): Promise<TokenResult> {
  const store = sessionStore();
  const session = store.load();
  if (!session) return { token: null, email: null, reconnect: false };

  if (isAccessTokenFresh(session, nowSec())) {
    return { token: session.accessToken, email: session.email, reconnect: false };
  }
  if (!session.refreshToken) {
    return { token: null, email: session.email, reconnect: true };
  }

  const refreshed = await refreshSession(API_BASE, SUPABASE_ANON_KEY, session.refreshToken);
  if (!refreshed.ok || !refreshed.accessToken) {
    if (refreshed.invalid) store.clear();
    return { token: null, email: session.email, reconnect: refreshed.invalid ?? false };
  }

  const updated: PersistedSession = {
    accessToken: refreshed.accessToken,
    refreshToken: refreshed.refreshToken ?? session.refreshToken,
    email: refreshed.email ?? session.email,
    expiresAt: refreshed.expiresAt ?? null,
    savedAt: nowSec(),
  };
  store.save(updated);
  return { token: updated.accessToken, email: updated.email, reconnect: false };
}

export async function getSessionStatus(): Promise<SessionStatus> {
  const store = sessionStore();
  const canPersist = store.canPersist();
  const session = store.load();
  if (!session) {
    return { connected: false, email: null, expiresAt: null, canPersist, needsReconnect: false };
  }
  const tokenRes = await ensureAccessToken();
  if (!tokenRes.token) {
    return {
      connected: false,
      email: session.email,
      expiresAt: session.expiresAt,
      canPersist,
      needsReconnect: tokenRes.reconnect,
    };
  }
  const fresh = store.load();
  return {
    connected: true,
    email: tokenRes.email,
    expiresAt: fresh?.expiresAt ?? null,
    canPersist,
    needsReconnect: false,
  };
}

export function clearSession(): void {
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
    const res = await fetch(`${API_BASE}/rest/v1/rpc/current_user_role`, {
      method: 'POST',
      headers: {
        apikey: SUPABASE_ANON_KEY,
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
      },
      body: '{}',
    });
    if (!res.ok) return 'viewer';
    const role: unknown = await res.json();
    return role === 'admin' || role === 'collaborator' ? role : 'viewer';
  } catch {
    return 'viewer';
  }
}
