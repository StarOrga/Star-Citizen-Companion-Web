import { Injectable, inject } from '@angular/core';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { environment } from '../../environments/environment';
import { ImpersonationService } from '../auth/impersonation.service';

/**
 * In-memory, no-op storage for the anon preview client. It deliberately
 * never touches `sessionStorage`/`localStorage`, so the preview client can
 * never read or write the real `sc.auth` session key.
 */
class InMemoryNoopStorage {
  private readonly store = new Map<string, string>();

  getItem(key: string): string | null {
    return this.store.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.store.set(key, value);
  }

  removeItem(key: string): void {
    this.store.delete(key);
  }
}

// Single-flight lock passthrough shared by both clients — see the comment
// on `realClient` below for why Navigator-Lock is disabled entirely.
function lockPassthrough<R>(_name: string, _acquireTimeout: number, fn: () => Promise<R>): Promise<R> {
  return fn();
}

@Injectable({ providedIn: 'root' })
export class SupabaseClientProvider {
  private readonly imp = inject(ImpersonationService);

  /** The real, session-bearing client. All auth operations MUST use this one. */
  readonly realClient: SupabaseClient = createClient(
    environment.supabase.url,
    environment.supabase.publishableKey,
    {
      auth: {
        persistSession: true,
        detectSessionInUrl: true,
        autoRefreshToken: true,
        storageKey: 'sc.auth',
        flowType: 'pkce',
        // Disable Navigator-Lock — the iframe-style dev preview (and any
        // duplicate-tab scenario on the same origin) triggers
        // `NavigatorLockAcquireTimeoutError: lock:sc.auth` because two
        // Supabase clients fight over the same lock. PKCE with single-flight
        // token rotation makes the lock redundant here.
        lock: lockPassthrough,
      },
    },
  );

  private _anonClient: SupabaseClient | null = null;

  /**
   * Lazily-created anon preview client: same project, but no session is
   * ever persisted/read/refreshed. Used only while previewing as a
   * signed-out visitor, so RLS genuinely evaluates as `anon`.
   */
  private get anonClient(): SupabaseClient {
    if (!this._anonClient) {
      this._anonClient = createClient(environment.supabase.url, environment.supabase.publishableKey, {
        auth: {
          persistSession: false,
          detectSessionInUrl: false,
          autoRefreshToken: false,
          storageKey: 'sc.anon-preview',
          storage: new InMemoryNoopStorage(),
          lock: lockPassthrough,
        },
      });
    }
    return this._anonClient;
  }

  /** The client every call site should read (inline, never cached in a field). */
  get client(): SupabaseClient {
    return this.imp.viewAs() === 'anon' ? this.anonClient : this.realClient;
  }
}
