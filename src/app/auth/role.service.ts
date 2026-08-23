import { Injectable, computed, effect, inject, signal } from '@angular/core';
import { SupabaseClientProvider } from '../core/supabase.client';
import { AuthService } from './auth.service';
import { ImpersonationService } from './impersonation.service';

export type Role = 'admin' | 'collaborator' | 'viewer';

@Injectable({ providedIn: 'root' })
export class RoleService {
  private readonly sb = inject(SupabaseClientProvider);
  private readonly auth = inject(AuthService);
  private readonly imp = inject(ImpersonationService);

  private readonly _actualRole = signal<Role | null>(null);
  private readonly _approved = signal(false);
  private readonly _loaded = signal(false);

  /** The live, DB-derived real role — never shadowed by the preview overlay. */
  readonly realRole = this._actualRole.asReadonly();
  readonly loaded = this._loaded.asReadonly();

  /**
   * Effective role: the clamped preview target while one is active, else the
   * real role. `viewAs()` is already clamped against `realRole()`, so this
   * can never outrank it.
   */
  readonly role = computed<Role | null>(() => {
    const v = this.imp.viewAs();
    if (v === 'anon') return null;
    return v ?? this._actualRole();
  });

  /** True only when the account was invited by an admin (or is the bootstrap admin). */
  readonly approved = computed(() => (this.imp.viewAs() === 'anon' ? false : this._approved()));
  readonly isAdmin = computed(() => this.role() === 'admin');
  readonly isCollaborator = computed(() => this.role() === 'admin' || this.role() === 'collaborator');

  constructor() {
    // Watches the REAL user (not the shadowed `auth.user()`), so the real
    // role stays loaded during an anon preview and exiting the preview
    // needs no round trip to the DB.
    effect(() => {
      // `auth.ready()` is the discriminator between "not signed in" and
      // "haven't found out yet". This effect fires the instant RoleService
      // is constructed — which is BEFORE `AuthService.init()`'s
      // `getSession()` promise resolves — so on that very first run
      // `realUser()` is `null` regardless of whether a session is about to
      // be restored. Reporting that as `setActualRole(null, true)` used to
      // make `ImpersonationService`'s self-heal treat "not loaded yet" as a
      // genuine sign-out and wipe a just-written `sc.viewAs` before the
      // reload that set it even got a chance to apply — "View as" then
      // silently never took effect. Deferring here only postpones the
      // self-heal decision; it can never widen `impersonationTargets()`,
      // since `viewAs()` itself stays clamped against `_actual()`/`anon`'s
      // pre-load exception in the meantime (see impersonation.service.ts).
      if (!this.auth.ready()) return;
      const user = this.auth.realUser();
      if (!user) {
        this._actualRole.set(null);
        this._approved.set(false);
        this._loaded.set(false);
        this.imp.setActualRole(null, true);
        return;
      }
      this.refresh().catch(() => null);
    });
  }

  async refresh(): Promise<void> {
    const user = this.auth.realUser();
    if (!user) {
      this._actualRole.set(null);
      this._approved.set(false);
      this._loaded.set(false);
      this.imp.setActualRole(null, true);
      return;
    }
    // Auth is preview-shadowed, but the profile lookup itself always uses
    // whichever client `sb.client` currently resolves to for reads; the
    // real user id is passed explicitly so this always targets the real
    // account's row regardless of preview state.
    const { data, error } = await this.sb.realClient
      .from('profiles')
      .select('role, is_approved')
      .eq('id', user.id)
      .maybeSingle();
    let role: Role;
    if (error) {
      // Fail closed on approval (deny), but keep a sane role default.
      role = 'viewer';
      this._approved.set(false);
    } else {
      role = (data?.['role'] as Role) ?? 'viewer';
      this._approved.set(data?.['is_approved'] === true);
    }
    this._actualRole.set(role);
    this._loaded.set(true);
    this.imp.setActualRole(role, true);
  }

  waitReady(): Promise<void> {
    if (this._loaded()) return Promise.resolve();
    return new Promise((resolve) => {
      const interval = setInterval(() => {
        if (this._loaded()) {
          clearInterval(interval);
          resolve();
        }
      }, 30);
    });
  }
}
