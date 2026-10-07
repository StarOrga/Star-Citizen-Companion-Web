import { Injectable, effect, inject, signal } from '@angular/core';
import { AuthService } from '../auth/auth.service';
import { logWarn } from './log';
import { SupabaseClientProvider } from './supabase.client';

/**
 * Account-wide view preferences — `profiles.ui_prefs`, a small key → JSON map.
 *
 * For choices a user expects to follow them from browser to browser (the
 * Holodeck comparison group is the first). The caller keeps its own
 * localStorage copy as the instant, signed-out source; this service is the
 * account layer on top of it:
 *
 * - `prefs()` is `null` until the signed-in account's map has loaded (and
 *   while signed out), so a consumer can tell "account has no value" from
 *   "not known yet" and never overwrites a local choice with an empty map.
 * - `set()` updates the signal at once and writes one key through the
 *   `set_ui_pref` RPC — a merge, so two tabs setting different keys cannot
 *   clobber each other. Signed out it is a no-op; a failed write is logged
 *   and the local copy still holds.
 */
@Injectable({ providedIn: 'root' })
export class AccountPrefsService {
  private readonly sb = inject(SupabaseClientProvider);
  private readonly auth = inject(AuthService);

  private readonly state = signal<Readonly<Record<string, unknown>> | null>(null);
  private loadedFor: string | null = null;

  readonly prefs = this.state.asReadonly();

  constructor() {
    effect(() => {
      const user = this.auth.user();
      if (!user) {
        this.loadedFor = null;
        this.state.set(null);
        return;
      }
      if (this.loadedFor === user.id) return;
      this.loadedFor = user.id;
      void this.load(user.id);
    });
  }

  private async load(uid: string): Promise<void> {
    const { data, error } = await this.sb.client
      .from('profiles')
      .select('ui_prefs')
      .eq('id', uid)
      .maybeSingle();
    // A late answer for account A must not land after a switch to B.
    if (this.loadedFor !== uid) return;
    if (error) logWarn('account-prefs', 'ui_prefs read failed', error);
    const raw = data?.['ui_prefs'];
    this.state.set(raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {});
  }

  set(key: string, value: string | number | boolean | null): void {
    if (!this.auth.user()) return;
    const next = { ...(this.state() ?? {}) };
    if (value === null) delete next[key];
    else next[key] = value;
    this.state.set(next);
    this.sb.client
      .rpc('set_ui_pref', { pref_key: key, pref_value: value })
      .then(({ error }) => {
        if (error) logWarn('account-prefs', 'set_ui_pref failed', error);
      });
  }
}
