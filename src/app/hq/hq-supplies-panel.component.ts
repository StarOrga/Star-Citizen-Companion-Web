import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';
import { ScDialogDirective } from '../shared/dialog/sc-dialog.directive';
import { ScTooltipDirective } from '../shared/tooltip/sc-tooltip.directive';

/**
 * "Nachschub" (supplies) — the cross-area list of what ships, sets and ops
 * still need. Shell stage (concept 2026-10-08): no data source yet, so it only
 * renders the empty state. A side panel on wide screens, a bottom sheet on
 * phones (dvh-sized, clear of the feedback launcher lane).
 */
@Component({
  selector: 'sc-hq-supplies-panel',
  standalone: true,
  imports: [TranslatePipe, ScDialogDirective, ScTooltipDirective],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="backdrop" aria-hidden="true" (click)="closed.emit()"></div>
    <aside
      class="panel sc-card"
      role="dialog"
      aria-modal="true"
      aria-labelledby="hq-supplies-title"
      scDialog
      [scDialogReturnFocus]="returnFocus()"
      (scDialogEscape)="closed.emit()">
      <header class="panel-head">
        <h2 id="hq-supplies-title">{{ 'hq.supplies.title' | translate }}</h2>
        <button
          type="button"
          class="sc-btn tiny ghost close"
          [attr.aria-label]="'hq.supplies.close' | translate"
          [scTooltip]="'hq.supplies.close' | translate"
          (click)="closed.emit()">
          <span aria-hidden="true">✕</span>
        </button>
      </header>
      <div class="empty">
        <p class="empty-title">{{ 'hq.supplies.empty' | translate }}</p>
        <p class="hint">{{ 'hq.supplies.emptyHint' | translate }}</p>
      </div>
    </aside>
  `,
  styles: [
    `
      :host { position: fixed; inset: 0; z-index: 60; }
      .backdrop { position: absolute; inset: 0; background: rgb(0 0 0 / 0.45); }
      .panel {
        position: absolute;
        top: 0;
        right: 0;
        bottom: 0;
        width: min(380px, 100%);
        display: flex;
        flex-direction: column;
        gap: 16px;
        padding: 16px;
        border-radius: 0;
        overflow-y: auto;
      }
      .panel-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
      .panel-head h2 { margin: 0; font-size: 1.1rem; }
      .empty { display: flex; flex-direction: column; gap: 6px; }
      .empty-title { margin: 0; color: var(--sc-fg); }
      .hint { margin: 0; color: var(--sc-fg-2); }
      @media (max-width: 640px) {
        .panel {
          top: auto;
          left: 0;
          width: 100%;
          max-height: 70vh;
          max-height: 70dvh;
          border-radius: var(--sc-radius, 8px) var(--sc-radius, 8px) 0 0;
          padding-bottom: calc(16px + var(--sc-float-bottom, env(safe-area-inset-bottom)));
        }
      }
      @media (pointer: coarse) {
        .close { min-width: 48px; min-height: 48px; }
      }
    `,
  ],
})
export class HqSuppliesPanelComponent {
  /** The control focus goes back to on close. */
  readonly returnFocus = input<HTMLElement | null>(null);
  readonly closed = output<void>();
}
