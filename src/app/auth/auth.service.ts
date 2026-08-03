import { Injectable, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { Session, User } from '@supabase/supabase-js';
import { AnalyticsService } from '../core/analytics.service';
import { SupabaseClientProvider } from '../core/supabase.client';
import { ImpersonationService } from './impersonation.service';

@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly sb = inject(SupabaseClientProvider);
  private readonly router = inject(Router);
  private readonly analytics = inject(AnalyticsService);
  private readonly imp = inject(ImpersonationService);

  private readonly _session = signal<Session | null>(null);
  private readonly _ready = signal(false);

  /** The real, untouched auth state — always reflects the actual Supabase session. */
  readonly realSession = this._session.asReadonly();
  readonly realUser = computed<User | null>(() => this._session()?.user ?? null);
  readonly ready = this._ready.asReadonly();

  /**
   * Public projections, shadowed by the active role preview. While
   * previewing as a signed-out visitor, these report signed-out — a strict
   * reduction of the real state, never an elevation. Every existing
   * consumer (guards, shell, FABs, ProfileService) reads these and needs no
   * call-site change.
   */
  readonly session = computed(() => (this.imp.viewAs() === 'anon' ? null : this._session()));
  readonly user = computed<User | null>(() =>
    this.imp.viewAs() === 'anon' ? null : this.realUser(),
  );
  readonly isAuthenticated = computed(() => this.session() !== null);

  private initialized = false;

  init(): void {
    if (this.initialized) return;
    this.initialized = true;

    // Analytics stays anonymous by design (#139): we never identify the user,
    // so auth state only drives the session signals — no identify()/reset().
    // Auth operations always run against the real client — never the anon
    // preview client — so sign-in/out/refresh works even mid-preview.
    this.sb.realClient.auth.getSession().then(({ data }) => {
      this._session.set(data.session);
      this._ready.set(true);
    });

    this.sb.realClient.auth.onAuthStateChange((_event, session) => {
      this._session.set(session);
      this._ready.set(true);
    });
  }

  async signInWithPassword(email: string, password: string) {
    return this.sb.realClient.auth.signInWithPassword({ email, password });
  }

  async signInWithGoogle(returnPath = '/news') {
    // returnPath must be a same-origin absolute path; the caller is
    // responsible for sanitizing it (see LoginComponent.safeRedirectTarget).
    return this.sb.realClient.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo:
          typeof window !== 'undefined' ? `${window.location.origin}${returnPath}` : undefined,
      },
    });
  }

  async signOut(navigate = true) {
    // Anonymous product event — no-op without statistics consent (#139).
    this.analytics.capture('user_signed_out');
    await this.sb.realClient.auth.signOut();
    if (navigate) await this.router.navigate(['/login']);
  }
}
