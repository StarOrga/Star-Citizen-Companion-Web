import { ChangeDetectionStrategy, Component, input, output, signal } from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';
import { ScDialogDirective } from './sc-dialog.directive';
import type { ScConfirmTone } from './sc-confirm.service';

let uid = 0;

/**
 * The confirm/prompt dialog ScConfirmService renders in a CDK overlay. A real
 * form: Enter in the prompt field submits, Enter on a focused button presses
 * it. Initial focus is the safe choice — Cancel for a destructive (danger)
 * question, Confirm for a harmless one, the field in prompt mode.
 */
@Component({
  selector: 'sc-confirm-dialog',
  standalone: true,
  imports: [TranslatePipe, ScDialogDirective],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <form
      class="sc-confirm sc-card"
      scDialog
      role="alertdialog"
      aria-modal="true"
      [attr.aria-labelledby]="titleId"
      [attr.aria-describedby]="messageKey() ? messageId : null"
      (scDialogEscape)="closed.emit(null)"
      (submit)="onSubmit($event)"
    >
      <h2 [id]="titleId">{{ titleKey() | translate: params() }}</h2>
      @if (messageKey(); as m) {
        <p [id]="messageId" class="msg">{{ m | translate: params() }}</p>
      }
      @if (mode() === 'prompt') {
        <label class="field">
          @if (inputLabelKey(); as l) {
            <span class="label">{{ l | translate }}</span>
          }
          <input
            class="sc-input"
            type="text"
            cdkFocusInitial
            [attr.maxlength]="inputMaxLength() ?? null"
            [value]="text()"
            (input)="text.set($any($event.target).value)"
          />
        </label>
      }
      <div class="actions">
        <button
          type="button"
          class="sc-btn cancel"
          [attr.cdkFocusInitial]="mode() === 'confirm' && tone() === 'danger' ? '' : null"
          (click)="closed.emit(null)"
        >
          {{ cancelKey() | translate }}
        </button>
        <button
          type="submit"
          class="sc-btn sc-btn-primary confirm"
          [class.danger]="tone() === 'danger'"
          [attr.cdkFocusInitial]="mode() === 'confirm' && tone() !== 'danger' ? '' : null"
        >
          {{ confirmKey() | translate }}
        </button>
      </div>
    </form>
  `,
  styles: [
    `
      :host { display: block; }
      .sc-confirm {
        inline-size: min(440px, calc(100vw - 32px));
        max-block-size: calc(100dvh - 32px);
        overflow: auto;
        display: flex;
        flex-direction: column;
        gap: 12px;
        margin: 0;
      }
      h2 {
        margin: 0;
        font-family: var(--sc-font-display);
        font-size: 1.05rem;
        color: var(--sc-fg-0);
        overflow-wrap: anywhere;
      }
      .msg {
        margin: 0;
        color: var(--sc-fg-1);
        white-space: pre-line;
        overflow-wrap: anywhere;
      }
      .field { display: flex; flex-direction: column; gap: 6px; }
      .label { color: var(--sc-fg-1); font-size: 0.85rem; }
      .actions {
        display: flex;
        flex-wrap: wrap;
        justify-content: flex-end;
        gap: 8px;
        margin-top: 4px;
      }
      .sc-btn { justify-content: center; }
      .sc-btn.sc-btn-primary.danger {
        background: var(--sc-danger);
        border-color: var(--sc-danger);
        color: var(--sc-bg-0);
      }
      .sc-btn.sc-btn-primary.danger:hover:not(:disabled) {
        background: color-mix(in srgb, var(--sc-danger) 85%, var(--sc-fg-0));
        box-shadow: none;
      }
      @media (max-width: 480px) {
        .actions .sc-btn { flex: 1 1 100%; }
      }
    `,
  ],
})
export class ScConfirmDialogComponent {
  readonly titleKey = input.required<string>();
  readonly messageKey = input<string | undefined>();
  readonly params = input<Record<string, unknown> | undefined>();
  readonly confirmKey = input<string>('common.dialog.confirm');
  readonly cancelKey = input<string>('common.dialog.cancel');
  readonly tone = input<ScConfirmTone>('default');
  readonly mode = input<'confirm' | 'prompt'>('confirm');
  readonly inputLabelKey = input<string | undefined>();
  readonly inputMaxLength = input<number | undefined>();

  /** '' / the typed text = confirmed, null = cancelled. */
  readonly closed = output<string | null>();

  readonly titleId = `sc-confirm-title-${++uid}`;
  readonly messageId = `sc-confirm-message-${uid}`;
  readonly text = signal('');

  onSubmit(ev: Event): void {
    ev.preventDefault();
    this.closed.emit(this.mode() === 'prompt' ? this.text() : '');
  }
}
