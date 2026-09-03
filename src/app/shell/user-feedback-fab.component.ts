import {
  ChangeDetectionStrategy,
  Component,
  HostListener,
  computed,
  effect,
  inject,
  signal,
} from '@angular/core';
import { TranslateModule } from '@ngx-translate/core';
import { AuthService } from '../auth/auth.service';
import { ImpersonationService } from '../auth/impersonation.service';
import { RoleService } from '../auth/role.service';
import { UserFeedbackService } from '../feedback/user-feedback.service';
import { UserFeedbackPanelComponent } from '../feedback/user-feedback-panel.component';
import { unreadBadgeText } from '../feedback/user-feedback.types';

/**
 * Feedback launcher for everyone who is NOT an admin (feedback 5920cf8c).
 *
 * Viewers and collaborators deliberately never see the admin panel, which until
 * now also meant they had no way to send feedback at all. This is their own,
 * separate FAB — it opens the slim compose + "mein Feedback" panel, never the
 * admin board.
 *
 * The two FABs are mutually exclusive by construction: `sc-feedback-fab` renders
 * only for `roles.isAdmin()`, this one only for a signed-in non-admin, so they
 * can share the bottom-right anchor without ever overlapping. Non-admins must
 * keep seeing nothing of the admin board, so this component imports none of it.
 */
@Component({
  selector: 'sc-user-feedback-fab',
  standalone: true,
  imports: [TranslateModule, UserFeedbackPanelComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (visible()) {
      <div class="fab-root">
        @if (mounted()) {
          <!-- “sc-sheet” (styles.scss): docked window on a desktop, full-bleed
               sheet below 720px — same treatment as the admin board's panel
               (admin feedback 3bc01a3d). -->
          <div
            class="panel sc-sheet"
            [class.minimized]="minimized()"
            role="dialog"
            [attr.aria-hidden]="minimized()"
            [attr.aria-label]="'userFeedback.title' | translate">
            <header class="panel-head">
              <span class="panel-title">{{ 'userFeedback.title' | translate }}</span>
              <button
                type="button"
                class="panel-min"
                (click)="minimize()"
                [attr.aria-label]="'feedbackFab.minimize' | translate">
                <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
                  <path d="M6 17h12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" />
                </svg>
              </button>
            </header>
            <div class="panel-body">
              <!-- The FAB stays visible while previewing viewer/collaborator
                   (that IS the point of the preview — feedback c.f. #4 of the
                   impersonation spec), but a submit here would write real
                   feedback under the admin's own real identity, straight into
                   the admin inbox. The panel itself stays fully interactive
                   (browsing drafts and past topics is part of what the
                   preview shows) — only sending is blocked, one level down in
                   blockSubmitCapture(), plus this notice explaining why. -->
              @if (blocked()) {
                <div class="imp-notice" role="note">
                  {{ 'userFeedback.impersonationBlocked' | translate }}
                </div>
              }
              <sc-user-feedback-panel />
            </div>
          </div>
        }

        <button
          type="button"
          class="fab"
          [class.is-open]="isOpen()"
          (click)="toggle($event)"
          [attr.aria-label]="labelKey() | translate: { count: unread() }"
          aria-haspopup="dialog"
          [attr.aria-expanded]="isOpen()">
          @if (isOpen()) {
            <svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true">
              <path d="M6 17h12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" />
            </svg>
          } @else {
            <svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true">
              <path
                d="M4 5a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H9l-4 4V5z"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
                stroke-linejoin="round" />
            </svg>
          }
          <!-- News on this user's own topics that they have not looked at yet:
               a reply from the team, a question, or a topic that shipped or was
               declined (admin feedback e684c946). Hidden while the panel is
               open — the badge exists to get it opened. -->
          @if (!isOpen() && unread() > 0) {
            <!-- aria-hidden: a button with an aria-label ignores its own
                 content, so the count would be silently dropped. It rides in
                 the button's label instead (labelKey below). -->
            <span class="badge" aria-hidden="true">{{ badgeText() }}</span>
          }
        </button>
      </div>
    }
  `,
  styles: [`
    .fab-root {
      position: fixed;
      right: 24px;
      bottom: 24px;
      z-index: 40;
      display: flex;
      flex-direction: column;
      align-items: flex-end;
      gap: 14px;
    }

    .fab {
      position: relative;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 56px;
      height: 56px;
      border-radius: 50%;
      border: 1px solid var(--sc-border);
      background: linear-gradient(180deg, var(--sc-bg-2), var(--sc-bg-1));
      color: var(--sc-accent);
      cursor: pointer;
      box-shadow: 0 8px 24px rgba(0, 0, 0, 0.45);
      transition: all 0.18s ease;
    }
    .fab:hover {
      border-color: var(--sc-accent);
      box-shadow: 0 8px 28px rgba(0, 212, 255, 0.25);
      transform: translateY(-1px);
    }
    .fab:focus-visible {
      outline: none;
      border-color: var(--sc-accent);
      box-shadow: 0 0 0 2px rgba(0, 212, 255, 0.4);
    }
    .fab.is-open { color: var(--sc-fg-1); }

    .badge {
      position: absolute;
      top: -2px;
      right: -2px;
      min-width: 18px;
      height: 18px;
      padding: 0 4px;
      box-sizing: border-box;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      border-radius: 999px;
      /* The normal accent, never the hot one: this FAB renders ONLY for
         non-admins (see visible() below), and red is reserved for surfaces a
         plain viewer never reaches (admin feedback b8b31f24). Unread news is
         not an error either, so --sc-danger is out — a solid accent pill on the
         dark FAB carries far enough on its own. */
      background: var(--sc-accent);
      color: #041016;
      font-size: max(0.66rem, var(--sc-fs-floor));
      font-weight: 700;
      /* Lifts the pill off the FAB's own cyan ring on hover/focus. */
      box-shadow: 0 0 0 2px var(--sc-bg-1);
    }

    .panel {
      width: min(420px, calc(100vw - 32px));
      height: min(600px, calc(100vh - 120px));
      resize: both;
      min-width: 300px;
      min-height: 300px;
      max-width: calc(100vw - 32px);
      max-height: calc(100vh - 120px);
      display: flex;
      flex-direction: column;
      background: linear-gradient(180deg, var(--sc-bg-2), var(--sc-bg-1));
      border: 1px solid var(--sc-border);
      border-radius: 12px;
      box-shadow: 0 18px 48px rgba(0, 0, 0, 0.55), var(--sc-glow);
      overflow: hidden;
    }
    .panel.minimized { display: none; }

    .panel-head {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 10px;
      padding: 12px 14px;
      border-bottom: 1px solid var(--sc-border);
    }
    .panel-title {
      font-family: var(--sc-font-display);
      letter-spacing: 0.08em;
      text-transform: uppercase;
      font-size: 0.82rem;
      font-weight: 600;
      color: var(--sc-fg-0);
    }
    .panel-min {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 28px;
      height: 28px;
      border-radius: 6px;
      border: 0;
      background: transparent;
      color: var(--sc-fg-2);
      cursor: pointer;
      transition: all 0.16s ease;
    }
    .panel-min:hover { color: var(--sc-fg-0); background: rgba(255, 255, 255, 0.06); }
    .panel-min:focus-visible {
      outline: none;
      color: var(--sc-fg-0);
      box-shadow: 0 0 0 2px rgba(0, 212, 255, 0.35);
    }

    .panel-body {
      flex: 1;
      min-height: 0;
      display: flex;
      flex-direction: column;
      overflow: hidden;
    }
    .panel-body sc-user-feedback-panel {
      display: flex;
      flex-direction: column;
      flex: 1 1 auto;
      min-height: 0;
    }

    .imp-notice {
      flex: 0 0 auto;
      padding: 8px 14px;
      border-bottom: 1px solid var(--sc-border);
      background: rgba(255, 87, 34, 0.1);
      color: var(--sc-accent-hot);
      font-size: max(0.76rem, var(--sc-fs-floor));
      line-height: 1.4;
    }

    @media (max-width: 720px) {
      .fab-root {
        right: 16px;
        bottom: calc(16px + env(safe-area-inset-bottom, 0px));
        gap: 10px;
      }
      .panel-head { padding: 10px 14px; }
      /* The launcher must not float on top of its own full-screen sheet; the
         sheet's minimize button is the way out and brings it back. */
      .panel:not(.minimized) ~ .fab { display: none; }
    }
  `],
})
export class UserFeedbackFabComponent {
  private readonly auth = inject(AuthService);
  private readonly roles = inject(RoleService);
  private readonly imp = inject(ImpersonationService);
  private readonly feedback = inject(UserFeedbackService);

  /**
   * Signed in, role resolved, and not an admin. Waiting for `loaded()` avoids
   * the flash where the role defaults to `viewer` and an admin briefly sees the
   * wrong FAB next to their own.
   *
   * Deliberately unchanged for the preview: an admin previewing as
   * viewer/collaborator is exactly the case this is meant to show them, so it
   * stays visible — see `blocked()` below for what changes instead.
   */
  readonly visible = computed(
    () => !!this.auth.user() && this.roles.loaded() && !this.roles.isAdmin(),
  );

  /**
   * A preview is active: the panel stays open and readable, but sending would
   * write real feedback under the admin's own real identity (the Supabase JWT
   * is untouched by a viewer/collaborator/anon preview — see
   * `ImpersonationService`), straight into the admin inbox. The refusal itself
   * lives in `UserFeedbackService.submit()/reply()`; this only explains it up
   * front instead of letting the user type a message and then bounce.
   */
  readonly blocked = computed(() => this.imp.activeOrPending());

  /**
   * Topics with news this user has not seen: a reply from the team, a question,
   * or a status they have not been shown yet. Zero means no badge at all.
   */
  readonly unread = this.feedback.unreadTopics;

  /** The count as rendered — capped, see `unreadBadgeText`. */
  readonly badgeText = computed(() => unreadBadgeText(this.unread()));

  /**
   * The button's own label carries the count, because a screen reader announces
   * the aria-label and never the badge inside it. The `{count}` parameter is
   * simply unused by the other two strings.
   */
  readonly labelKey = computed(() => {
    if (this.isOpen()) return 'feedbackFab.minimize';
    return this.unread() > 0 ? 'userFeedback.openWithNews' : 'userFeedback.open';
  });

  readonly mounted = signal(false);
  readonly minimized = signal(false);
  readonly isOpen = computed(() => this.mounted() && !this.minimized());

  constructor() {
    // Load the user's topics once the role is known, so the badge can announce
    // news before the panel has ever been opened.
    effect(() => {
      if (this.visible() && !this.feedback.loaded()) void this.feedback.refresh();
    });
  }

  toggle(event: Event) {
    event.stopPropagation();
    if (!this.mounted()) {
      this.mounted.set(true);
      this.minimized.set(false);
      this.markRead();
      return;
    }
    const nowMinimized = !this.minimized();
    this.minimized.set(nowMinimized);
    if (!nowMinimized) this.markRead();
  }

  /**
   * Opening the panel IS the read receipt (admin feedback e684c946): the user
   * asked to see their topics, so the badge has done its job and must not still
   * be there on the next page. Fire-and-forget — the panel opens either way, and
   * a failed write just leaves the badge up for the next open.
   */
  private markRead(): void {
    void this.feedback.markAllRead();
  }

  /** Hide the panel without unmounting it — the draft and scroll survive. */
  minimize() {
    this.minimized.set(true);
  }

  @HostListener('document:keydown.escape')
  onEscape() {
    if (this.isOpen()) this.minimize();
  }
}
