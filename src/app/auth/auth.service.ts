import { Injectable, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { Session, User } from '@supabase/supabase-js';
import { AnalyticsService } from '../core/analytics.service';
import { SupabaseClientProvider } from '../core/supabase.client';
import { capturedAuthLinkType } from './auth-link';
import { ImpersonationService } from './impersonation.service';

/** Where an invite / password-reset link is funnelled once it has a session. */
export const SET_PASSWORD_PATH = '/set-password';

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

    const linkType = capturedAuthLinkType();
    let linkHandled = false;

    this.sb.realClient.auth.onAuthStateChange((event, session) => {
      this._session.set(session);
      this._ready.set(true);

      // An invite or a password-reset mail is the ONE entry point where the
      // visitor has a session but (possibly) no password they know. Send them
      // to the page that fixes that instead of dropping them on the feed.
      //
      // Two triggers, because Supabase only re-announces one of the two:
      // `PASSWORD_RECOVERY` is emitted for recovery links, while an invite
      // arrives as a bare `SIGNED_IN` — `linkType` is the URL snapshot taken
      // in main.ts and is null on every ordinary visit, so a normal sign-in
      // or a page reload can never route here.
      const fromLink = event === 'PASSWORD_RECOVERY' || linkType !== null;
      if (session && !linkHandled && fromLink) {
        linkHandled = true;
        void this.router.navigateByUrl(
          `${SET_PASSWORD_PATH}?via=${event === 'PASSWORD_RECOVERY' ? 'recovery' : linkType ?? 'recovery'}`,
        );
      }
    });
  }

  async signInWithPassword(email: string, password: string) {
    return this.sb.realClient.auth.signInWithPassword({ email, password });
  }

  /**
   * Set (or replace) the password of the CURRENT session's user. Works from a
   * normal session and from the short-lived one an invite / recovery link
   * hands over — which is exactly what makes an invited account reachable a
   * second time.
   */
  async updatePassword(password: string) {
    return this.sb.realClient.auth.updateUser({ password });
  }

  /**
   * Ask Supabase to mail a password-reset link. Deliberately fire-and-forget
   * from the caller's point of view: Supabase answers the same way whether or
   * not the address has an account, and the UI must not turn that into an
   * "is X a member?" oracle.
   */
  async sendPasswordReset(email: string) {
    const redirectTo =
      typeof window === 'undefined'
        ? undefined
        : `${window.location.origin}${SET_PASSWORD_PATH}`;
    return this.sb.realClient.auth.resetPasswordForEmail(email.trim().toLowerCase(), {
      redirectTo,
    });
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
