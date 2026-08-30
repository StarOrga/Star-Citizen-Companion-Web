import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { TranslateModule } from '@ngx-translate/core';
import { safeRedirectTarget } from '../core/safe-redirect.util';
import { AuthService } from './auth.service';
import { RoleService } from './role.service';

/**
 * The visible end of `approvedGuard`'s fail-closed path.
 *
 * The guard blocks whenever it cannot establish who the signed-in user is
 * (`identityUnknown()` — a `profiles` read that failed with no known-good
 * data behind it — or `waitReady()` timing out). It used to express that as
 * `return false`, which makes the router abandon the navigation: on the
 * first navigation of a page load that leaves an empty window with no route,
 * no message and no recovery short of a manual reload. This page is where
 * that denial goes instead.
 *
 * It renders under `PublicLayoutComponent`, OUTSIDE the gated shell routes,
 * so reaching it can never re-trigger the guard that sent the user here.
 * The session is deliberately left intact (see the guard): the user IS
 * signed in, we just could not read their approval — so "retry" re-reads the
 * profile and resumes the original navigation, and signing out is offered
 * only as the manual way out.
 */
@Component({
  selector: 'sc-access-unavailable',
  standalone: true,
  imports: [TranslateModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="page">
      <div class="sc-card">
        <h1>{{ 'auth.unavailable.title' | translate }}</h1>
        <p>{{ 'auth.unavailable.body' | translate }}</p>
        <div class="actions">
          <button type="button" class="sc-btn sc-btn-primary" [disabled]="busy()" (click)="retry()">
            {{ (busy() ? 'auth.unavailable.retrying' : 'auth.unavailable.retry') | translate }}
          </button>
          <button type="button" class="link" [disabled]="busy()" (click)="signOut()">
            {{ 'nav.signOut' | translate }}
          </button>
        </div>
      </div>
    </section>
  `,
  styles: [`
    .page { display: grid; place-items: center; min-height: 60vh; }
    .sc-card { max-width: 480px; padding: 32px 36px; text-align: center; }
    h1 { font-size: 1.3rem; margin-bottom: 16px; }
    p { color: var(--sc-fg-1); margin: 0 0 20px; }
    .actions { display: flex; flex-direction: column; align-items: center; gap: 12px; }
    .link {
      background: transparent;
      border: 0;
      color: var(--sc-fg-2);
      font-size: 0.85rem;
    }
    .link:hover:not(:disabled) { color: var(--sc-fg-0); text-decoration: underline; }
  `],
})
export class AccessUnavailableComponent {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly roles = inject(RoleService);
  private readonly auth = inject(AuthService);

  readonly busy = signal(false);

  async retry(): Promise<void> {
    if (this.busy()) return;
    this.busy.set(true);
    // The guard decides on RoleService's already-settled signals, so
    // navigating without re-reading the profile first would bounce straight
    // back here. `refresh()` carries its own first-load backoff.
    await this.roles.refresh();
    this.busy.set(false);
    await this.router.navigateByUrl(
      safeRedirectTarget(this.route.snapshot.queryParamMap.get('redirect')),
    );
  }

  async signOut(): Promise<void> {
    if (this.busy()) return;
    this.busy.set(true);
    await this.auth.signOut();
  }
}
