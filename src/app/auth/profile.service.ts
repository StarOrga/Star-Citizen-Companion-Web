import { Injectable, effect, inject, signal } from '@angular/core';
import { SupabaseClientProvider } from '../core/supabase.client';
import { AuthService } from './auth.service';

/**
 * Single source of truth for the caller's own `profiles.username`.
 *
 * The handle is stored in `public.profiles` (written via the `set_username`
 * RPC), NOT in the auth `user_metadata`. Both the shell (avatar initial +
 * account menu) and the settings page need it, so it is loaded once here —
 * reactively on auth-user change, mirroring RoleService — and shared as a
 * signal instead of each consumer re-querying.
 */
@Injectable({ providedIn: 'root' })
export class ProfileService {
  private readonly sb = inject(SupabaseClientProvider);
  private readonly auth = inject(AuthService);

  private readonly _username = signal<string | null>(null);
  private readonly _loaded = signal(false);

  /** The caller's chosen handle, or null until set. */
  readonly username = this._username.asReadonly();
  readonly loaded = this._loaded.asReadonly();

  constructor() {
    effect(() => {
      const user = this.auth.user();
      if (!user) {
        this._username.set(null);
        this._loaded.set(false);
        return;
      }
      this.refresh().catch(() => null);
    });
  }

  async refresh(): Promise<void> {
    const user = this.auth.user();
    if (!user) {
      this._username.set(null);
      this._loaded.set(false);
      return;
    }
    const { data } = await this.sb.client
      .from('profiles')
      .select('username')
      .eq('id', user.id)
      .maybeSingle();
    this._username.set((data?.['username'] as string | null) ?? null);
    this._loaded.set(true);
  }

  /**
   * Persist a new handle via the `set_username` RPC. On success the shared
   * signal is updated so every consumer (avatar, menu) reflects it at once.
   * Returns the RPC error (or null when saved).
   */
  async setUsername(next: string): Promise<{ error: { message?: string } | null }> {
    const { error } = await this.sb.client.rpc('set_username', { new_name: next });
    if (!error) this._username.set(next);
    return { error };
  }
}
