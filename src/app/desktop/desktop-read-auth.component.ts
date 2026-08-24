import { ChangeDetectionStrategy, Component, OnInit, inject, signal } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { AuthService } from '../auth/auth.service';
import { ImpersonationService } from '../auth/impersonation.service';
import { SupabaseClientProvider } from '../core/supabase.client';
import { DesktopConnectionService } from './desktop-connection.service';
import { isLoopbackCallback } from './loopback.util';

type AuthStatus = 'authorizing' | 'login_required' | 'redirecting' | 'error';

/**
 * Desktop read-auth handoff — open to ANY signed-in user (no role gate).
 *
 * The SCC Electron app opens
 * `${webOrigin}/desktop/connect?cb=http://127.0.0.1:4682X/scc/callback&state=<csrf>`
 * in the user's default browser.  This component:
 *
 *  1. Validates the callback URL is a 127.0.0.1 HTTP loopback (any port — the
 *     app binds an OS-assigned ephemeral port; see loopback.util.ts).
 *  2. Ensures the user is signed in (else routes to /login with redirect=this).
 *  3. Reads the Supabase session and POSTs
 *     { state, token, refresh_token, expires_at, email }
 *     to the loopback `/scc/callback` path via a top-level form-POST (exempt
 *     from Chrome's Private/Local Network Access block on subresource fetches).
 *     expires_at is the Supabase session.expires_at in UNIX SECONDS as a string;
 *     the app calls Number() on it.
 *
 * Distinct from /uploader/auth (collaborator-gated).  No RoleService import.
 */
@Component({
  selector: 'sc-desktop-read-auth',
  standalone: true,
  imports: [RouterLink, TranslateModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="page">
      <div class="sc-card">
        <h1>{{ 'desktopConnect.title' | translate }}</h1>

        @switch (status()) {
          @case ('authorizing') {
            <p>{{ 'desktopConnect.authorizing' | translate }}</p>
            <div class="dots"><span></span><span></span><span></span></div>
          }
          @case ('login_required') {
            <p>{{ 'desktopConnect.loginRequired' | translate }}</p>
            <a class="sc-btn sc-btn-primary"
               [routerLink]="['/login']"
               [queryParams]="{ redirect: returnUrl }">
              {{ 'auth.signIn' | translate }}
            </a>
          }
          @case ('redirecting') {
            <p class="ok">{{ 'desktopConnect.redirecting' | translate }}</p>
            <p class="hint">{{ 'desktopConnect.redirectingHint' | translate }}</p>
            <div class="dots"><span></span><span></span><span></span></div>
          }
          @case ('error') {
            <p class="err">{{ errorMsg() }}</p>
          }
        }
      </div>
    </section>
  `,
  styles: [`
    .page { display: grid; place-items: center; min-height: 60vh; }
    .sc-card { max-width: 480px; padding: 32px 36px; text-align: center; }
    h1 { font-size: 1.3rem; margin-bottom: 16px; }
    p { color: var(--sc-fg-1); margin: 0 0 12px; }
    .ok { color: var(--sc-success); }
    .err { color: var(--sc-danger); }
    .hint { color: var(--sc-fg-2); font-size: 0.85rem; }
    .dots { display: flex; gap: 6px; justify-content: center; margin-top: 12px; }
    .dots span {
      width: 8px; height: 8px; border-radius: 50%;
      background: var(--sc-accent);
      animation: pulse 1.2s infinite ease-in-out;
    }
    .dots span:nth-child(2) { animation-delay: 0.2s; }
    .dots span:nth-child(3) { animation-delay: 0.4s; }
    @keyframes pulse {
      0%, 80%, 100% { transform: scale(0.5); opacity: 0.4; }
      40% { transform: scale(1); opacity: 1; }
    }
    .sc-btn { margin-top: 8px; }
  `],
})
export class DesktopReadAuthComponent implements OnInit {
  private readonly auth = inject(AuthService);
  private readonly route = inject(ActivatedRoute);
  private readonly sb = inject(SupabaseClientProvider);
  private readonly conn = inject(DesktopConnectionService);
  private readonly translate = inject(TranslateService);
  private readonly imp = inject(ImpersonationService);

  readonly status = signal<AuthStatus>('authorizing');
  readonly errorMsg = signal<string | null>(null);

  cb = '';
  state = '';
  returnUrl = '';

  async ngOnInit() {
    // A token handoff must never run under a presentation overlay — see the
    // identical guard in DesktopAuthComponent for the full rationale.
    if (this.imp.activeOrPending()) {
      this.imp.exit();
      return;
    }

    const q = this.route.snapshot.queryParamMap;
    this.cb = q.get('cb') ?? '';
    this.state = q.get('state') ?? '';

    // Fallback for the Google-OAuth round-trip: login.component stashes the
    // query string before kicking off the provider redirect because Supabase's
    // allowlist rejects query strings on the callback URL.
    if (!this.cb || !this.state) {
      try {
        const stash = sessionStorage.getItem('sc.oauth-redirect-qs');
        if (stash) {
          const parsed = JSON.parse(stash) as { path?: string; qs?: string };
          if (parsed.path === '/desktop/connect' && parsed.qs) {
            const params = new URLSearchParams(parsed.qs);
            this.cb = this.cb || params.get('cb') || '';
            this.state = this.state || params.get('state') || '';
          }
        }
      } catch { /* ignore — stash optional */ }
    }
    try { sessionStorage.removeItem('sc.oauth-redirect-qs'); } catch { /* ignore */ }

    if (!this.cb || !this.state) {
      this.status.set('error');
      this.errorMsg.set(this.translate.instant('desktopConnect.errorMissingParams'));
      return;
    }
    if (!isLoopbackCallback(this.cb)) {
      this.status.set('error');
      this.errorMsg.set(this.translate.instant('desktopConnect.errorBadCallback'));
      return;
    }

    this.returnUrl = `/desktop/connect?cb=${encodeURIComponent(this.cb)}&state=${encodeURIComponent(this.state)}`;

    this.auth.init();
    await waitFor(() => this.auth.ready());

    if (!this.auth.isAuthenticated()) {
      this.status.set('login_required');
      return;
    }

    const { data, error } = await this.sb.client.auth.getSession();
    const token = data.session?.access_token;
    if (error || !token) {
      this.status.set('error');
      this.errorMsg.set(error?.message ?? this.translate.instant('desktopConnect.errorNoToken'));
      return;
    }

    // expires_at is already UNIX seconds from Supabase — pass as string so the
    // app can Number()-parse it.  refresh_token lets the app persist the session
    // across the ~1h access-token TTL without a new browser login.
    const refreshToken = data.session?.refresh_token ?? '';
    const expiresAt = data.session?.expires_at != null ? String(data.session.expires_at) : '';

    this.status.set('redirecting');
    const email = this.auth.user()?.email ?? '';

    // Record the check-in BEFORE the form navigates away — this handoff is the
    // moment the Starscape app becomes connected to this account, and it is the
    // only such event the website can observe itself. Never throws; a failed
    // bookkeeping write must not cost the user the handoff (924bf1d8).
    await this.conn.touch('starscape');

    // Top-level form-POST to the loopback /scc/callback path — exempt from
    // Chrome's Private/Local Network Access block on HTTPS→loopback subresource
    // fetches.  Token rides in the request BODY, never in the URL.
    const callbackUrl = buildCallbackUrl(this.cb);
    const form = document.createElement('form');
    form.method = 'POST';
    form.action = callbackUrl;
    form.acceptCharset = 'utf-8';
    const addField = (name: string, value: string): void => {
      const input = document.createElement('input');
      input.type = 'hidden';
      input.name = name;
      input.value = value;
      form.appendChild(input);
    };
    addField('state', this.state);
    addField('token', token);
    addField('email', email);
    if (refreshToken) addField('refresh_token', refreshToken);
    if (expiresAt) addField('expires_at', expiresAt);
    document.body.appendChild(form);
    form.submit();
  }
}

/**
 * Build the canonical POST target: origin of the loopback URL + /scc/callback.
 * The app's loopback handler listens on this fixed path (POST /scc/callback).
 * Any path supplied by the caller's `cb` param is discarded — only origin is
 * trusted — so path-injection cannot redirect the token elsewhere.
 */
function buildCallbackUrl(cb: string): string {
  const u = new URL(cb);
  return `${u.protocol}//${u.host}/scc/callback`;
}

function waitFor(predicate: () => boolean, intervalMs = 30): Promise<void> {
  if (predicate()) return Promise.resolve();
  return new Promise((resolve) => {
    const id = setInterval(() => {
      if (predicate()) {
        clearInterval(id);
        resolve();
      }
    }, intervalMs);
  });
}
