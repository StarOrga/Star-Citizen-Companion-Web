import { ChangeDetectionStrategy, Component, computed, effect, inject, signal, untracked } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { TranslatePipe } from '@ngx-translate/core';
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
 *
 * Auto-resume: the guard's 5 s `waitReady()` timeout can fire while the
 * `profiles` read is merely slow (a throttled phone CPU, a bad network) — the
 * read then lands a moment later with the user approved. The page watches for
 * exactly that and resumes the original navigation on its own, replacing this
 * entry in the history so Back does not return here. While the read is still
 * pending it says "checking" instead of claiming a failure it cannot know yet.
 */
@Component({
  selector: 'sc-access-unavailable',
  standalone: true,
  imports: [TranslatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="page">
      <div class="sc-card">
        @if (checking()) {
          <p class="checking" role="status">{{ 'auth.unavailable.checking' | translate }}</p>
        } @else {
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
        }
      </div>
    </section>
  `,
  styles: [`
    .page { display: grid; place-items: center; min-height: 60vh; }
    .sc-card { max-width: 480px; padding: 32px 36px; text-align: center; }
    @media (max-width: 480px) { .sc-card { padding: 24px var(--sc-pad-1); } }
    h1 { font-size: 1.3rem; margin-bottom: 16px; }
    p { color: var(--sc-fg-1); margin: 0 0 20px; }
    .checking { margin: 0; color: var(--sc-fg-2); }
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
  /** Set once a navigation away has been started (auto-resume or retry). */
  private resumed = false;

  /**
   * The profile read has not settled yet (and no manual retry is running,
   * which keeps its own "retrying" label on the error card).
   */
  readonly checking = computed(() => !this.roles.loaded() && !this.busy());

  constructor() {
    effect(() => {
      const ready = this.roles.loaded() && !this.roles.identityUnknown() && this.roles.approved();
      if (!ready || untracked(this.busy) || this.resumed) return;
      this.resumed = true;
      void this.router.navigateByUrl(this.redirectTarget(), { replaceUrl: true });
    });
  }

  private redirectTarget(): string {
    return safeRedirectTarget(this.route.snapshot.queryParamMap.get('redirect'));
  }

  async retry(): Promise<void> {
    if (this.busy()) return;
    this.busy.set(true);
    // The guard decides on RoleService's already-settled signals, so
    // navigating without re-reading the profile first would bounce straight
    // back here. `refresh()` carries its own first-load backoff.
    await this.roles.refresh();
    this.busy.set(false);
    if (this.resumed) return;
    // Claimed while the retry's own navigation runs, so the effect does not
    // start a second one; released afterwards, because a guard that bounces
    // straight back here reuses this instance and auto-resume must still work.
    this.resumed = true;
    try {
      await this.router.navigateByUrl(this.redirectTarget());
    } finally {
      this.resumed = false;
    }
  }

  async signOut(): Promise<void> {
    if (this.busy()) return;
    this.busy.set(true);
    await this.auth.signOut();
  }
}
