import { AppLinkStageComponent, AppLinkPhase } from './app-link-stage.component';
import { ScActionDirective } from '../shared/action/sc-action.directive';
import { toErrorKey } from '../core/describe-error';
import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { TranslatePipe } from '@ngx-translate/core';
import { AuthService } from '../auth/auth.service';
import { ImpersonationService } from '../auth/impersonation.service';
import { RoleService } from '../auth/role.service';
import { SupabaseClientProvider } from '../core/supabase.client';
import { DesktopConnectionService } from './desktop-connection.service';
import { isLoopbackCallback, sendOriginOnLoopbackPost } from './loopback.util';
import { mintDesktopSession } from './desktop-session.util';

const HANDED_OVER_MS = 2500;

type AuthStatus =
  | 'authorizing'
  | 'login_required'
  | 'confirm'
  | 'cancelled'
  | 'redirecting'
  | 'unauthorized'
  | 'error';

/**
 * Desktop-Tool OAuth callback endpoint.
 *
 * The Electron app's loopback OAuth flow opens
 * `${apiBase}/apps/uploader/auth?cb=http://127.0.0.1:4682X/cb&state=<csrf>`
 * in the user's default browser. This component:
 *
 *  1. Validates the callback URL is a 127.0.0.1 loopback in the expected port range.
 *  2. Ensures the user is signed in (else routes to /login with redirect=this).
 *  3. Ensures the user is collaborator+ (else surfaces the rejection).
 *  4. Waits for an explicit "Connect" click (AUD-170). Without it, any page
 *     that opened this URL with its own loopback listener would receive the
 *     user's tokens silently. "Cancel" sends nothing, and no desktop session
 *     is minted before the click.
 *  5. Reads the Supabase session access_token and POSTs it to the loopback as
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
  imports: [AppLinkStageComponent, RouterLink, TranslatePipe, ScActionDirective],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <sc-app-link-stage app="uploader" [phase]="phase()">
      <h1>{{ 'desktopAuth.title' | translate }}</h1>
      @switch (status()) {
        @case ('authorizing') {
          <p>{{ 'desktopAuth.authorizing' | translate }}</p>
        }
        @case ('confirm') {
          <p>{{ 'desktopAuth.confirmPrompt' | translate: { port: port() } }}</p>
          <p class="hint">{{ 'desktopAuth.confirmHint' | translate }}</p>
          <div class="actions">
            <button type="button" scAction tier="primary" [busy]="busy()" (click)="confirm()">
              {{ 'desktopAuth.confirm' | translate }}
            </button>
            <button type="button" scAction tier="secondary" [disabled]="busy()" (click)="cancel()">
              {{ 'desktopAuth.cancel' | translate }}
            </button>
          </div>
        }
        @case ('cancelled') {
          <p>{{ 'desktopAuth.cancelled' | translate }}</p>
        }
        @case ('login_required') {
          <p>{{ 'desktopAuth.loginRequired' | translate }}</p>
          <div class="actions">
            <a scAction tier="primary" [routerLink]="['/login']" [queryParams]="{ redirect: returnUrl }">
              {{ 'auth.signIn' | translate }}
            </a>
          </div>
        }
        @case ('redirecting') {
          @if (handedOver()) {
            <p class="ok">{{ 'desktopAuth.handedOver' | translate }}</p>
            <p class="hint">{{ 'desktopAuth.handedOverHint' | translate }}</p>
          } @else {
            <p class="ok">{{ 'desktopAuth.redirecting' | translate }}</p>
            <p class="hint">{{ 'desktopAuth.redirectingHint' | translate }}</p>
          }
        }
        @case ('unauthorized') {
          <p class="err">{{ 'desktopAuth.unauthorized' | translate }}</p>
          <p class="hint">{{ 'desktopAuth.unauthorizedHint' | translate }}</p>
        }
        @case ('error') {
          <p class="err">{{ errorMsg()! | translate }}</p>
          <div class="actions">
            <a scAction tier="secondary" [href]="returnUrl || '/'">{{ 'desktopAuth.retry' | translate }}</a>
          </div>
        }
      }
    </sc-app-link-stage>
  `,
})
export class DesktopAuthComponent implements OnInit {
  private readonly auth = inject(AuthService);
  private readonly roles = inject(RoleService);
  private readonly route = inject(ActivatedRoute);
  private readonly sb = inject(SupabaseClientProvider);
  private readonly conn = inject(DesktopConnectionService);
  private readonly imp = inject(ImpersonationService);

  readonly status = signal<AuthStatus>('authorizing');
  /** The form is posted and this tab is still here: the app has the session, show the end state. */
  readonly handedOver = signal(false);
  /** What the stage shows: the link animates while connecting and settles once handed over. */
  protected readonly phase = computed<AppLinkPhase>(() => {
    switch (this.status()) {
      case 'authorizing': return 'checking';
      case 'redirecting': return this.handedOver() ? 'done' : 'linking';
      case 'cancelled':
      case 'unauthorized': return 'halt';
      case 'error': return 'error';
      default: return 'ready';
    }
  });
  /** i18n key, never raw text. */
  readonly errorMsg = signal<string | null>(null);
  /** Loopback port of the tool asking for the hand-off, shown in the prompt. */
  readonly port = signal('');
  /** A Connect click is being processed — guards against a double submit. */
  readonly busy = signal(false);

  cb = '';
  state = '';
  returnUrl = '';

  async ngOnInit() {
    // A token handoff must never run under a presentation overlay: under an
    // anon preview `isAuthenticated()` reports false (dead-ends this flow at
    // `login_required`, forcing a pointless re-login loop for a user who is
    // actually signed in), and under any preview `sb.client` may not be the
    // real session-bearing client. Bail out first — `exit()` reloads, which
    // lands the user back on this exact URL with the real session restored.
    if (this.imp.activeOrPending()) {
      this.imp.exit();
      return;
    }

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
          if ((parsed.path === '/apps/uploader/auth' || parsed.path === '/uploader/auth') && parsed.qs) {
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
      this.errorMsg.set('desktopAuth.errorMissingParams');
      return;
    }
    if (!isLoopbackCallback(this.cb)) {
      this.status.set('error');
      this.errorMsg.set('desktopAuth.errorBadCallback');
      return;
    }

    this.returnUrl = `/apps/uploader/auth?cb=${encodeURIComponent(this.cb)}&state=${encodeURIComponent(this.state)}`;

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

    // AUD-170: nothing leaves the browser before the user says so.
    this.port.set(new URL(this.cb).port);
    this.status.set('confirm');
  }

  /** "Connect" — hand the tokens to the loopback (once). */
  async confirm(): Promise<void> {
    if (this.busy() || this.status() !== 'confirm') return;
    this.busy.set(true);
    await this.handOff();
  }

  /** "Cancel" — nothing is minted, nothing is sent. */
  cancel(): void {
    if (this.busy()) return;
    this.status.set('cancelled');
  }

  private async handOff(): Promise<void> {
    const { data, error } = await this.sb.client.auth.getSession();
    const token = data.session?.access_token;
    if (error || !token) {
      this.status.set('error');
      this.errorMsg.set(error ? toErrorKey('desktop', 'auth', error) : 'desktopAuth.errorNoToken');
      return;
    }
    // Hand over a session that belongs to the TOOL, not the browser's own, so it
    // can persist it (encrypted) and stay connected past the ~1h access-token TTL
    // without a new browser login — and so the two do not share one rotation
    // chain. See `mintDesktopSession` for what that hardens against, and why a
    // failed mint falls back to the old behaviour instead of breaking the
    // hand-off. Older tool builds simply ignore the extra body fields. Still
    // NEVER in the URL — these ride in the form-POST body.
    const handoff = (await mintDesktopSession(this.sb.realClient)) ?? {
      access_token: token,
      refresh_token: data.session?.refresh_token ?? '',
      expires_at: data.session?.expires_at != null ? String(data.session.expires_at) : '',
    };

    this.status.set('redirecting');
    const email = this.auth.user()?.email ?? '';

    // Record the check-in BEFORE the form navigates away — this handoff is the
    // moment the Data Uploader becomes connected to this account, and it is the
    // only such event the website can observe itself. Never throws; a failed
    // bookkeeping write must not cost the user the handoff (924bf1d8).
    await this.conn.touch('uploader');

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
    addField('token', handoff.access_token);
    addField('email', email);
    if (handoff.refresh_token) addField('refresh_token', handoff.refresh_token);
    if (handoff.expires_at) addField('expires_at', handoff.expires_at);
    sendOriginOnLoopbackPost();
    document.body.appendChild(form);
    form.submit();
    // A normal hand-over leaves this page for the app's own "done" page within moments; if the tab
    // is still here, say so plainly.
    setTimeout(() => this.handedOver.set(true), HANDED_OVER_MS);
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
