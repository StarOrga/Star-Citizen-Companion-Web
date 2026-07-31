import {
  ChangeDetectionStrategy,
  Component,
  HostListener,
  computed,
  inject,
  signal,
} from '@angular/core';
import { TranslateModule } from '@ngx-translate/core';
import { RoleService } from '../auth/role.service';
import { AdminFeedbackComponent } from '../admin/feedback/admin-feedback.component';
import { RoutineStatusDirective } from '../admin/feedback/routine-status.directive';

/**
 * Admin-only feedback launcher. Replaces the former `/admin/feedback` nav item
 * with a floating action button that opens the feedback board as a chat-style
 * overlay panel — reachable from every page.
 *
 * The panel minimizes rather than closes: once opened it stays mounted and is
 * hidden via CSS while minimized, so the embedded board keeps all of its state
 * (draft notes, pending attachments, scroll position). A click elsewhere on the
 * page never dismisses it, and Escape / the header button only minimize — so an
 * admin jotting notes can freely click around the app without losing them.
 */
@Component({
  selector: 'sc-feedback-fab',
  standalone: true,
  imports: [TranslateModule, AdminFeedbackComponent, RoutineStatusDirective],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (roles.isAdmin()) {
      <div class="fab-root">
        @if (mounted()) {
          <div
            class="panel"
            [class.minimized]="minimized()"
            [class.maximized]="maximized()"
            role="dialog"
            [attr.aria-hidden]="minimized()"
            [attr.aria-label]="'feedbackFab.title' | translate">
            <header class="panel-head">
              <!-- The title doubles as the dev-PC liveness light: tinted green
                   / red / left grey by scRoutineStatus (feedback a7573f0e). It
                   stays the word and nothing else — the state reaches assistive
                   tech through aria-label, never as text on screen. The
                   attribute's value is the title's own i18n key, so that
                   accessible name can keep saying "Feedback" too. -->
              <span class="panel-title" scRoutineStatus="feedbackFab.title">{{ 'feedbackFab.title' | translate }}</span>
              <div class="panel-actions">
                <button
                  type="button"
                  class="panel-min"
                  (click)="toggleMaximize()"
                  [attr.aria-pressed]="maximized()"
                  [attr.aria-label]="(maximized() ? 'feedbackFab.restore' : 'feedbackFab.maximize') | translate">
                  @if (maximized()) {
                    <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
                      <path
                        d="M9 5H5v4M15 5h4v4M9 19H5v-4M15 19h4v-4"
                        fill="none"
                        stroke="currentColor"
                        stroke-width="2"
                        stroke-linecap="round"
                        stroke-linejoin="round" />
                    </svg>
                  } @else {
                    <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
                      <rect
                        x="5"
                        y="5"
                        width="14"
                        height="14"
                        rx="1"
                        fill="none"
                        stroke="currentColor"
                        stroke-width="2" />
                    </svg>
                  }
                </button>
                <button
                  type="button"
                  class="panel-min"
                  (click)="minimize()"
                  [attr.aria-label]="'feedbackFab.minimize' | translate">
                  <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
                    <path
                      d="M6 17h12"
                      fill="none"
                      stroke="currentColor"
                      stroke-width="2"
                      stroke-linecap="round" />
                  </svg>
                </button>
              </div>
            </header>
            <div class="panel-body">
              <sc-admin-feedback [embedded]="true" />
            </div>
          </div>
        }

        <button
          type="button"
          class="fab"
          [class.is-open]="isOpen()"
          (click)="toggle($event)"
          [attr.aria-label]="(isOpen() ? 'feedbackFab.minimize' : 'feedbackFab.open') | translate"
          aria-haspopup="dialog"
          [attr.aria-expanded]="isOpen()">
          @if (isOpen()) {
            <svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true">
              <path
                d="M6 17h12"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
                stroke-linecap="round" />
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
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 56px;
      height: 56px;
      border-radius: 50%;
      border: 1px solid var(--sc-border);
      background: linear-gradient(180deg, var(--sc-bg-2), var(--sc-bg-1));
      color: var(--sc-accent-hot);
      cursor: pointer;
      box-shadow: 0 8px 24px rgba(0, 0, 0, 0.45);
      transition: all 0.18s ease;
    }
    .fab:hover {
      border-color: var(--sc-accent-hot);
      box-shadow: 0 8px 28px rgba(255, 87, 34, 0.28);
      transform: translateY(-1px);
    }
    .fab:focus-visible {
      outline: none;
      border-color: var(--sc-accent-hot);
      box-shadow: 0 0 0 2px rgba(255, 87, 34, 0.4);
    }
    .fab.is-open { color: var(--sc-fg-1); }

    .panel {
      /* Docked size — kept roomy so several expanded threads stay visible at
         once without needing near-fullscreen (feedback fc5373d5). */
      width: min(480px, calc(100vw - 32px));
      height: min(680px, calc(100vh - 120px));
      /* User-resizable: drag the corner grip to enlarge the chat window. */
      resize: both;
      min-width: 320px;
      min-height: 320px;
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
    /* Minimized: kept in the DOM (state preserved) but hidden. */
    .panel.minimized { display: none; }
    /* Maximized: one-click near-fullscreen. Breaks out of the bottom-right
       anchor to fill the viewport (leaving a small inset margin). */
    .panel.maximized {
      position: fixed;
      inset: 16px;
      width: auto;
      height: auto;
      max-width: none;
      max-height: none;
      resize: none;
    }
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
    .panel-actions { display: inline-flex; align-items: center; gap: 4px; }
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
      font-size: 0.9rem;
      cursor: pointer;
      transition: all 0.16s ease;
    }
    .panel-min:hover { color: var(--sc-fg-0); background: rgba(255, 255, 255, 0.06); }
    .panel-min:focus-visible {
      outline: none;
      color: var(--sc-fg-0);
      box-shadow: 0 0 0 2px rgba(0, 212, 255, 0.35);
    }

    /* The embedded board fills the body and manages its own scroll, so the
       composer stays pinned below the history instead of overlapping it. */
    .panel-body {
      flex: 1;
      min-height: 0;
      display: flex;
      flex-direction: column;
      overflow: hidden;
    }
    .panel-body sc-admin-feedback {
      display: flex;
      flex-direction: column;
      flex: 1 1 auto;
      min-height: 0;
    }

    @media (max-width: 640px) {
      .fab-root { right: 16px; bottom: 16px; gap: 10px; }
      .panel { height: min(70vh, calc(100vh - 120px)); }
    }
  `],
})
export class FeedbackFabComponent {
  readonly roles = inject(RoleService);

  /** Whether the panel is in the DOM. Stays true once first opened so the
   *  embedded board keeps its state while minimized. */
  readonly mounted = signal(false);
  /** Whether the mounted panel is collapsed (hidden) rather than dismissed. */
  readonly minimized = signal(false);
  /** Whether the panel is expanded to near-fullscreen. Preserved while minimized. */
  readonly maximized = signal(false);
  /** Panel is visible when mounted and not minimized. */
  readonly isOpen = computed(() => this.mounted() && !this.minimized());

  /** One-click enlarge/restore between the docked size and near-fullscreen. */
  toggleMaximize() {
    this.maximized.update((m) => !m);
  }

  toggle(event: Event) {
    event.stopPropagation();
    if (!this.mounted()) {
      this.mounted.set(true);
      this.minimized.set(false);
      return;
    }
    this.minimized.update((m) => !m);
  }

  /** Hide the panel without unmounting it — all board state is preserved. */
  minimize() {
    this.minimized.set(true);
  }

  @HostListener('document:keydown.escape')
  onEscape() {
    if (!this.isOpen()) return;
    // Escape steps down: near-fullscreen → docked → minimized.
    if (this.maximized()) this.maximized.set(false);
    else this.minimize();
  }
}
