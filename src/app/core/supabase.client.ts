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
      },
    });
  }
}
