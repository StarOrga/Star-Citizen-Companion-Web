import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  HostListener,
  inject,
  signal,
} from '@angular/core';
import { TranslateModule } from '@ngx-translate/core';
import { RoleService } from '../auth/role.service';
import { AdminFeedbackComponent } from '../admin/feedback/admin-feedback.component';

/**
 * Admin-only feedback launcher. Replaces the former `/admin/feedback` nav item
 * with a floating action button that opens the feedback board as a chat-style
 * overlay panel — reachable from every page. The board is created only while
 * the panel is open, so it reloads fresh data on each open.
 */
@Component({
  selector: 'sc-feedback-fab',
  standalone: true,
  imports: [TranslateModule, AdminFeedbackComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (roles.isAdmin()) {
      <div class="fab-root">
        @if (open()) {
          <div
            class="panel"
            role="dialog"
            [attr.aria-label]="'feedbackFab.title' | translate">
            <header class="panel-head">
              <span class="panel-title">{{ 'feedbackFab.title' | translate }}</span>
              <button
                type="button"
                class="panel-close"
                (click)="close()"
                [attr.aria-label]="'feedbackFab.close' | translate">
                ✕
              </button>
            </header>
            <div class="panel-body">
              <sc-admin-feedback [embedded]="true" />
            </div>
          </div>
        }

        <button
          type="button"
          class="fab"
          [class.is-open]="open()"
          (click)="toggle($event)"
          [attr.aria-label]="(open() ? 'feedbackFab.close' : 'feedbackFab.open') | translate"
          aria-haspopup="dialog"
          [attr.aria-expanded]="open()">
          @if (open()) {
            <svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true">
              <path
                d="M6 6l12 12M18 6L6 18"
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
      width: min(420px, calc(100vw - 32px));
      height: min(560px, calc(100vh - 140px));
      display: flex;
      flex-direction: column;
      background: linear-gradient(180deg, var(--sc-bg-2), var(--sc-bg-1));
      border: 1px solid var(--sc-border);
      border-radius: 12px;
      box-shadow: 0 18px 48px rgba(0, 0, 0, 0.55), var(--sc-glow);
      overflow: hidden;
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
    .panel-close {
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
    .panel-close:hover { color: var(--sc-fg-0); background: rgba(255, 255, 255, 0.06); }
    .panel-close:focus-visible {
      outline: none;
      color: var(--sc-fg-0);
      box-shadow: 0 0 0 2px rgba(0, 212, 255, 0.35);
    }

    .panel-body {
      flex: 1;
      overflow-y: auto;
      padding: 14px;
    }

    @media (max-width: 640px) {
      .fab-root { right: 16px; bottom: 16px; gap: 10px; }
      .panel { height: min(70vh, calc(100vh - 120px)); }
    }
  `],
})
export class FeedbackFabComponent {
  readonly roles = inject(RoleService);
  private readonly host = inject(ElementRef<HTMLElement>);

  readonly open = signal(false);

  toggle(event: Event) {
    event.stopPropagation();
    this.open.update((o) => !o);
  }

  close() {
    this.open.set(false);
  }

  @HostListener('document:keydown.escape')
  onEscape() {
    if (this.open()) this.close();
  }

  // Close on any click outside the FAB subtree (button + panel).
  @HostListener('document:click', ['$event'])
  onDocumentClick(event: MouseEvent) {
    if (!this.open()) return;
    const root = (this.host.nativeElement as HTMLElement).querySelector('.fab-root');
    if (root && !root.contains(event.target as Node)) this.close();
  }
}
