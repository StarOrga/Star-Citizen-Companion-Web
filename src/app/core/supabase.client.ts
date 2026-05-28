import { Injectable } from '@angular/core';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { environment } from '../../environments/environment';

@Injectable({ providedIn: 'root' })
export class SupabaseClientProvider {
  readonly client: SupabaseClient;

  constructor() {
    this.client = createClient(environment.supabase.url, environment.supabase.publishableKey, {
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
        lock: (_name, _acquireTimeout, fn) => fn(),
      },
    });
  }
}
