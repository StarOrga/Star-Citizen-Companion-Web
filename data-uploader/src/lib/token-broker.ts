/**
 * Hands out a valid access token from the persisted session, refreshing it via
 * the rotating refresh token when it has expired.
 *
 * Two rules keep an operator signed in across restarts and app updates:
 *
 *  1. ONE refresh at a time. After an update (or any longer pause) the stored
 *     access token is stale, and the first seconds of a launch ask for a token
 *     from several places at once: the connection pill, the catalog sync, the
 *     role lookup, the unattended auto-run. Each of them refreshing on its own
 *     presents the same refresh token several times — and since refresh tokens
 *     rotate, every one but the first is a spent token. Concurrent callers now
 *     share the one in-flight refresh.
 *  2. Never sign out on a stale read. A rejected refresh only clears the
 *     session when the rejected token is still the one on disk; if the store
 *     already holds a newer one (another caller rotated it in between), that
 *     newer one is used instead.
 *
 * A refresh that fails for a transient reason (offline, timeout, 5xx) keeps the
 * session: the caller gets `retry: true` and may try again later.
 *
 * Pure logic with injected I/O, so it is unit-testable without Electron.
 */

import { isAccessTokenFresh, type PersistedSession } from './session-store.js';
import type { RefreshResult } from './token-refresh.js';

export interface TokenResult {
  token: string | null;
  email: string | null;
  /** The refresh lineage is dead — the operator must connect again. */
  reconnect: boolean;
  /** A stored session exists but could not be refreshed right now (offline, timeout, 5xx). */
  retry: boolean;
}

export interface TokenBrokerDeps {
  load(): PersistedSession | null;
  save(session: PersistedSession): void;
  clear(): void;
  refresh(refreshToken: string): Promise<RefreshResult>;
  nowSeconds(): number;
  warn?(message: string): void;
}

export interface TokenBroker {
  ensureAccessToken(): Promise<TokenResult>;
}

export function createTokenBroker(deps: TokenBrokerDeps): TokenBroker {
  let inflight: Promise<TokenResult> | null = null;

  async function resolve(): Promise<TokenResult> {
    const session = deps.load();
    if (!session) return { token: null, email: null, reconnect: false, retry: false };

    if (isAccessTokenFresh(session, deps.nowSeconds())) {
      return { token: session.accessToken, email: session.email, reconnect: false, retry: false };
    }
    if (!session.refreshToken) {
      deps.warn?.('[session] stored session has no refresh token — reconnect needed');
      return { token: null, email: session.email, reconnect: true, retry: false };
    }

    const refreshed = await deps.refresh(session.refreshToken);
    if (refreshed.ok && refreshed.accessToken) {
      const updated: PersistedSession = {
        accessToken: refreshed.accessToken,
        refreshToken: refreshed.refreshToken ?? session.refreshToken,
        email: refreshed.email ?? session.email,
        expiresAt: refreshed.expiresAt ?? null,
        savedAt: deps.nowSeconds(),
      };
      deps.save(updated);
      return { token: updated.accessToken, email: updated.email, reconnect: false, retry: false };
    }

    if (refreshed.invalid) {
      // Rejected — but only sign out if nobody stored a newer session meanwhile.
      const current = deps.load();
      if (current && current.refreshToken !== session.refreshToken) {
        if (isAccessTokenFresh(current, deps.nowSeconds())) {
          return { token: current.accessToken, email: current.email, reconnect: false, retry: false };
        }
        deps.warn?.('[session] refresh token was rotated meanwhile — retry with the stored one');
        return { token: null, email: current.email, reconnect: false, retry: true };
      }
      deps.warn?.(`[session] refresh rejected (${refreshed.error ?? 'invalid'}) — session cleared`);
      deps.clear();
      return { token: null, email: session.email, reconnect: true, retry: false };
    }

    deps.warn?.(`[session] refresh failed transiently (${refreshed.error ?? 'unknown'}) — session kept`);
    return { token: null, email: session.email, reconnect: false, retry: true };
  }

  return {
    ensureAccessToken(): Promise<TokenResult> {
      if (!inflight) {
        inflight = resolve().finally(() => {
          inflight = null;
        });
      }
      return inflight;
    },
  };
}
