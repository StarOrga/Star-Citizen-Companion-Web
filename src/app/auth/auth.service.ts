import { Injectable, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { Session, User } from '@supabase/supabase-js';
import { AnalyticsService } from '../core/analytics.service';
import { SupabaseClientProvider } from '../core/supabase.client';

@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly sb = inject(SupabaseClientProvider);
  private readonly router = inject(Router);
  private readonly analytics = inject(AnalyticsService);

  private readonly _session = signal<Session | null>(null);
  private readonly _ready = signal(false);

  readonly session = this._session.asReadonly();
  readonly user = computed<User | null>(() => this._session()?.user ?? null);
  readonly ready = this._ready.asReadonly();
  readonly isAuthenticated = computed(() => this._session() !== null);
  private initialized = false;

  init(): void {
    if (this.initialized) return;
    this.initialized = true;

    // Analytics stays anonymous by design (#139): we never identify the user,
    // so auth state only drives the session signals — no identify()/reset().
    this.sb.client.auth.getSession().then(({ data }) => {
      this._session.set(data.session);
      this._ready.set(true);
    });

    this.sb.client.auth.onAuthStateChange((_event, session) => {
      this._session.set(session);
      this._ready.set(true);
    });
  }

  async signInWithPassword(email: string, password: string) {
    return this.sb.client.auth.signInWithPassword({ email, password });
  }

  async signInWithGoogle(returnPath = '/news') {
    // returnPath must be a same-origin absolute path; the caller is
    // responsible for sanitizing it (see LoginComponent.safeRedirectTarget).
    return this.sb.client.auth.signInWithOAuth({
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
    await this.sb.client.auth.signOut();
    if (navigate) await this.router.navigate(['/login']);
  }
}
