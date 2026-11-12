import { AppLinkStageComponent, AppLinkPhase } from './app-link-stage.component';
import { ScActionDirective } from '../shared/action/sc-action.directive';
import { toErrorKey } from '../core/describe-error';
import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { TranslatePipe } from '@ngx-translate/core';
import { AuthService } from '../auth/auth.service';
import { ImpersonationService } from '../auth/impersonation.service';
import { SupabaseClientProvider } from '../core/supabase.client';
import { DesktopConnectionService } from './desktop-connection.service';
import { isLoopbackCallback, sendOriginOnLoopbackPost } from './loopback.util';
import { mintDesktopSession } from './desktop-session.util';

const HANDED_OVER_MS = 2500;

type AuthStatus = 'authorizing' | 'login_required' | 'redirecting' | 'error';

/**
 * Desktop read-auth handoff — open to ANY signed-in user (no role gate).
 *
 * The SCC Electron app opens
 * `${webOrigin}/apps/starscape/connect?cb=http://127.0.0.1:4682X/scc/callback&state=<csrf>`
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
  imports: [AppLinkStageComponent, RouterLink, TranslatePipe, ScActionDirective],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <sc-app-link-stage app="starscape" [phase]="phase()">
      <h1>{{ 'desktopConnect.title' | translate }}</h1>
      @switch (status()) {
        @case ('authorizing') {
          <p>{{ 'desktopConnect.authorizing' | translate }}</p>
        }
        @case ('login_required') {
          <p>{{ 'desktopConnect.loginRequired' | translate }}</p>
          <div class="actions">
            <a scAction tier="primary" [routerLink]="['/login']" [queryParams]="{ redirect: returnUrl }">
              {{ 'auth.signIn' | translate }}
            </a>
          </div>
        }
        @case ('redirecting') {
          @if (handedOver()) {
            <p class="ok">{{ 'desktopConnect.handedOver' | translate }}</p>
            <p class="hint">{{ 'desktopConnect.handedOverHint' | translate }}</p>
          } @else {
            <p class="ok">{{ 'desktopConnect.redirecting' | translate }}</p>
            <p class="hint">{{ 'desktopConnect.redirectingHint' | translate }}</p>
          }
        }
        @case ('error') {
          <p class="err">{{ errorMsg()! | translate }}</p>
          <div class="actions">
            <a scAction tier="secondary" [href]="returnUrl || '/'">{{ 'desktopConnect.retry' | translate }}</a>
          </div>
        }
      }
    </sc-app-link-stage>
  `,
})
export class DesktopReadAuthComponent implements OnInit {
  private readonly auth = inject(AuthService);
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
      case 'error': return 'error';
      default: return 'ready';
    }
  });
  /** i18n key, never raw text. */
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
          if ((parsed.path === '/apps/starscape/connect' || parsed.path === '/desktop/connect') && parsed.qs) {
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
      this.errorMsg.set('desktopConnect.errorMissingParams');
      return;
    }
    if (!isLoopbackCallback(this.cb)) {
      this.status.set('error');
      this.errorMsg.set('desktopConnect.errorBadCallback');
      return;
    }

    this.returnUrl = `/apps/starscape/connect?cb=${encodeURIComponent(this.cb)}&state=${encodeURIComponent(this.state)}`;

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
      this.errorMsg.set(error ? toErrorKey('desktop', 'read auth', error) : 'desktopConnect.errorNoToken');
      return;
    }

    // Hand over a session that belongs to the APP, never the browser's own, so
    // the two do not share one rotation chain. `mintDesktopSession` documents
    // what that does and does NOT fix (it is hardening — the reported daily
    // sign-out was the Rust app discarding its store on transport failures) and
    // why a failed mint falls back to the browser session rather than failing
    // the hand-off outright. expires_at stays UNIX seconds as a string; the app
    // Number()-parses it. Older app builds ignore extra fields.
    const handoff = (await mintDesktopSession(this.sb.realClient)) ?? {
      access_token: token,
      refresh_token: data.session?.refresh_token ?? '',
      expires_at: data.session?.expires_at != null ? String(data.session.expires_at) : '',
    };

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
