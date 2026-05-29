import { ChangeDetectionStrategy, Component, OnInit, inject, signal } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { TranslateModule } from '@ngx-translate/core';
import { AuthService } from '../auth/auth.service';
import { RoleService } from '../auth/role.service';
import { SupabaseClientProvider } from '../core/supabase.client';

type AuthStatus = 'authorizing' | 'login_required' | 'redirecting' | 'unauthorized' | 'error';

/**
 * Desktop-Tool OAuth callback endpoint.
 *
 * The Electron app's loopback OAuth flow opens
 * `${apiBase}/desktop/auth?cb=http://127.0.0.1:4682X/cb&state=<csrf>`
 * in the user's default browser. This component:
 *
 *  1. Validates the callback URL is a 127.0.0.1 loopback in the expected port range.
 *  2. Ensures the user is signed in (else routes to /login with redirect=this).
 *  3. Ensures the user is collaborator+ (else surfaces the rejection).
 *  4. Reads the Supabase session access_token and POSTs it to the loopback as
 *     `{state, token, email}` JSON body — NEVER as URL parameters. After the
 *     POST acknowledges, navigates the browser tab to `<cb>?state=<csrf>&ack=1`
 *     (no token in URL → no JWT in browser history). Hardening for Codex
 *     review 2026-05-24 MED-6.
 *
 * The Electron OAuth handler in `desktop-tool/src/lib/oauth.ts` matches `state`,
 * captures `token` from the POST body, closes the loopback server, and resolves.
 */
@Component({
  selector: 'sc-desktop-auth',
  standalone: true,
  imports: [RouterLink, TranslateModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="page">
      <div class="sc-card">
        <h1>{{ 'desktopAuth.title' | translate }}</h1>

        @switch (status()) {
          @case ('authorizing') {
            <p>{{ 'desktopAuth.authorizing' | translate }}</p>
            <div class="dots"><span></span><span></span><span></span></div>
          }
          @case ('login_required') {
            <p>{{ 'desktopAuth.loginRequired' | translate }}</p>
            <a class="sc-btn sc-btn-primary"
               [routerLink]="['/login']"
               [queryParams]="{ redirect: returnUrl }">
              {{ 'auth.signIn' | translate }}
            </a>
          }
          @case ('redirecting') {
            <p class="ok">{{ 'desktopAuth.redirecting' | translate }}</p>
            <p class="hint">{{ 'desktopAuth.redirectingHint' | translate }}</p>
            <div class="dots"><span></span><span></span><span></span></div>
          }
          @case ('unauthorized') {
            <p class="err">{{ 'desktopAuth.unauthorized' | translate }}</p>
            <p class="hint">{{ 'desktopAuth.unauthorizedHint' | translate }}</p>
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
export class DesktopAuthComponent implements OnInit {
  private readonly auth = inject(AuthService);
  private readonly roles = inject(RoleService);
  private readonly route = inject(ActivatedRoute);
  private readonly sb = inject(SupabaseClientProvider);

  readonly status = signal<AuthStatus>('authorizing');
  readonly errorMsg = signal<string | null>(null);

  cb = '';
  state = '';
  returnUrl = '';

  async ngOnInit() {
    const q = this.route.snapshot.queryParamMap;
    this.cb = q.get('cb') ?? '';
    this.state = q.get('state') ?? '';

    // Fallback for the Google-OAuth round-trip: login.component stashes the
    // query string before kicking off the provider redirect because
    // Supabase's allowlist rejects query strings on the callback URL.
    if (!this.cb || !this.state) {
      try {
        const stash = sessionStorage.getItem('sc.oauth-redirect-qs');
        if (stash) {
          const parsed = JSON.parse(stash) as { path?: string; qs?: string };
          if (parsed.path === '/desktop/auth' && parsed.qs) {
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
      this.errorMsg.set('Missing `cb` or `state` query parameter.');
      return;
    }
    if (!isLoopback(this.cb)) {
      this.status.set('error');
      this.errorMsg.set('Callback URL is not a 127.0.0.1 loopback in the expected port range.');
      return;
    }

    this.returnUrl = `/desktop/auth?cb=${encodeURIComponent(this.cb)}&state=${encodeURIComponent(this.state)}`;

    this.auth.init();
    await waitFor(() => this.auth.ready());

    if (!this.auth.isAuthenticated()) {
      this.status.set('login_required');
      return;
    }

    await this.roles.waitReady();
    if (!this.roles.isCollaborator()) {
      this.status.set('unauthorized');
      return;
    }

    const { data, error } = await this.sb.client.auth.getSession();
    const token = data.session?.access_token;
    if (error || !token) {
      this.status.set('error');
      this.errorMsg.set(error?.message ?? 'No access token in session.');
      return;
    }

    this.status.set('redirecting');
    const email = this.auth.user()?.email ?? '';

    // Hand the JWT to the loopback via a TOP-LEVEL form-POST navigation —
    // NOT a background fetch(). Chrome's Private/Local Network Access blocks
    // subresource requests (fetch/XHR) from a public HTTPS origin to a
    // private address (127.0.0.1), even when the loopback answers the CORS
    // preflight with `Access-Control-Allow-Private-Network: true`. The
    // earlier fetch() approach (Desktop-Tool ≤ 0.4.5) died silently as
    // "Failed to fetch" on modern Chrome for exactly this reason.
    //
    // A top-level navigation is exempt from PNA/LNA, so a form-POST gets
    // through. The token rides in the request BODY (not the URL), so it
    // never lands in browser history. The loopback renders its
    // "you can close this window" page directly from the POST response.
    // Requires Desktop-Tool v0.4.6+ (older loopbacks only parse a JSON
    // fetch body); CSP `form-action` must also list the loopback (see
    // vercel.json).
    const form = document.createElement('form');
    form.method = 'POST';
    form.action = this.cb;
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
    document.body.appendChild(form);
    form.submit();
  }
}

function isLoopback(url: string): boolean {
  try {
    const u = new URL(url);
    if (u.protocol !== 'http:') return false;
    if (u.hostname !== '127.0.0.1') return false;
    const p = parseInt(u.port, 10);
    return p >= 46800 && p <= 46899;
  } catch {
    return false;
  }
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
