import { ChangeDetectionStrategy, Component, effect, inject } from '@angular/core';
import { Router } from '@angular/router';
import { TranslateModule } from '@ngx-translate/core';
import { AuthService } from '../auth/auth.service';
import { ScDatePipe } from '../core/locale/sc-date.pipe';
import { AccountStatusService } from './account-status.service';

/**
 * The moderation banner in the shell (feedback cf0ddf7d phase 2).
 *
 * Two jobs, both of which have to happen where the app actually lives rather
 * than on a route the user may never visit:
 *
 *   1. WARNING — the "grace period with info to the user" branch. An admin
 *      warned this account; it must be told, and the notice stays until it is
 *      acknowledged, across reloads (the acknowledgement is a DB write, not
 *      local state).
 *   2. SUSPENSION mid-session. `approvedGuard` catches it on the next
 *      navigation, but a user sitting on one page navigates nowhere — so the
 *      three-minute poll in AccountStatusService is what notices, and this is
 *      what acts on it. Without this the session would linger, visibly signed
 *      in but reading nothing, until the user clicked something.
 */
@Component({
  selector: 'sc-account-notice',
  standalone: true,
  imports: [TranslateModule, ScDatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (account.warning(); as w) {
      <div class="notice warn" role="alert">
        <div class="notice__body">
          <p class="notice__title">{{ 'moderation.warning.title' | translate }}</p>
          @if (w.reason) {
            <p class="notice__reason">{{ w.reason }}</p>
          }
          @if (w.at) {
            <p class="notice__meta">{{ w.at | scDate: 'datetime' }}</p>
          }
        </div>
        <button
          type="button"
          class="sc-btn notice__ack"
          (click)="acknowledge()">
          {{ 'moderation.warning.acknowledge' | translate }}
        </button>
      </div>
    }
  `,
  styles: [`
    :host { display: block; }
    .notice {
      display: flex;
      align-items: flex-start;
      gap: 14px;
      flex-wrap: wrap;
      margin: 0 auto;
      padding: 12px 16px;
      max-width: 1280px;
      border-radius: 4px;
      font-size: 0.9rem;
      line-height: 1.45;
    }
    /* A warning is a caution, not a destructive action and not an
       elevated-access surface: --sc-warning, never --sc-danger/--sc-accent-hot. */
    .notice.warn {
      background: rgba(251, 191, 36, 0.1);
      border: 1px solid var(--sc-warning);
      color: var(--sc-fg-0);
    }
    .notice__body { flex: 1 1 260px; min-width: 0; }
    .notice__title { margin: 0 0 4px; font-weight: 600; color: var(--sc-warning); }
    .notice__reason { margin: 0 0 4px; overflow-wrap: anywhere; }
    .notice__meta { margin: 0; color: var(--sc-fg-2); font-size: max(0.74rem, var(--sc-fs-floor)); }
    .notice__ack { flex: 0 0 auto; }

    /* 48px, not 44: two overlapping scale(0.994) shell animations shave a
       hair off every measured box, so a 44px target measures 43. */
    @media (pointer: coarse) {
      .notice__ack { min-height: 48px; }
    }
    @media (max-width: 560px) {
      .notice { margin: 0 16px; }
      .notice__ack { width: 100%; min-height: 48px; }
    }
  `],
})
export class AccountNoticeComponent {
  readonly account = inject(AccountStatusService);
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);

  private ejecting = false;

  constructor() {
    effect(() => {
      // Only a CONFIRMED suspension ejects. `suspended()` is false both for
      // "not suspended" and for "we could not find out" (see
      // AccountStatusService.unavailable), and the latter must never cost a
      // real user their session.
      if (!this.account.suspended()) return;
      if (this.ejecting) return;
      this.ejecting = true;
      this.account.rememberNotice();
      void this.auth.signOut(false).then(() =>
        this.router.navigate(['/login'], { queryParams: { denied: 'suspended' } }),
      );
    });
  }

  acknowledge(): void {
    void this.account.acknowledgeWarning();
  }
}
