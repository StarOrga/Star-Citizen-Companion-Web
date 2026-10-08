import { Injectable, inject } from '@angular/core';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { environment } from '../../environments/environment';
import { ImpersonationService } from '../auth/impersonation.service';
import { createReadDeadlineFetch } from './deadline';

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

// PostgREST base of the project, with the trailing slash the deadline wrapper
// matches against (`<url>/rest/v1/<table>` and `<url>/rest/v1/rpc/<name>`).
const REST_BASE = `${environment.supabase.url.replace(/\/+$/, '')}/rest/v1/`;

@Injectable({ providedIn: 'root' })
export class SupabaseClientProvider {
  private readonly imp = inject(ImpersonationService);

  /**
   * The real, session-bearing client. All auth operations MUST use this one.
   *
   * Read deadline: `global.fetch` gives every PostgREST read (GET/HEAD and the
   * read-only RPCs in `READ_RPCS`) a 20 s deadline, so a hanging read ends in
   * the reader's error card instead of an endless skeleton. 20 s sits above the
   * `authenticated` statement timeout (8 s) plus transfer. Writes, auth,
   * storage and functions pass through untouched. See `./deadline.ts`.
   */
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
        // No `lock` option: since auth-js 2.107 the default IS lockless (no
        // Navigator-Lock — which once threw `NavigatorLockAcquireTimeoutError:
        // lock:sc.auth` in the dev preview and duplicate tabs), with in-tab
        // refreshes single-flighted. The pass-through lock that used to sit
        // here bought the same and logged a deprecation warning on every page
        // load since 2.112.4; the option goes away in v3.
      },
      global: { fetch: createReadDeadlineFetch(REST_BASE) },
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
        },
        global: { fetch: createReadDeadlineFetch(REST_BASE) },
      });
    }
    return this._anonClient;
  }

  /**
   * The client every call site should read (inline, never cached in a field).
   *
   * This getter reads `imp.viewAs()`, a signal — which registers `viewAs()`
   * as a reactive dependency of any effect that reads `client` (e.g.
   * `profile.service.ts`). That is safe ONLY because every "View as" toggle
   * (`ImpersonationService.enter()` / `exit()`) is immediately followed by a
   * full page reload: nothing in this app relies on an in-place, no-reload
   * transition from `realClient` to `anonClient` (or back) actually being
   * observed by those effects mid-session. If a future change ever made the
   * overlay toggle without reloading, every effect depending on `client`
   * would need to be re-audited for correct re-run behavior.
   */
  get client(): SupabaseClient {
    return this.imp.viewAs() === 'anon' ? this.anonClient : this.realClient;
  }
}
