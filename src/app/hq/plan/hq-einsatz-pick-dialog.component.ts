import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';
import { ScDialogDirective } from '../../shared/dialog/sc-dialog.directive';

/** One choosable Einsatz in the picker. */
export interface EinsatzPickOption {
  id: string;
  title: string;
  steps: number;
}

/** What the reader chose: an existing Einsatz, a new one, or nothing (null). */
export type EinsatzPick = { kind: 'existing'; id: string } | { kind: 'new' };

let uid = 0;

/**
 * "Zum Einsatz" (search CTA on a mission row): which planned / active Einsatz
 * the mission joins as a step, or "Neuer Einsatz". A list of real buttons in
 * an app dialog (`[scDialog]`: focus in, Tab trap, Escape, focus return) —
 * never a native dialog. Opened by HqEinsatzPickService.
 */
@Component({
  selector: 'sc-hq-einsatz-pick-dialog',
  standalone: true,
  imports: [TranslatePipe, ScDialogDirective],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="pick sc-card" scDialog role="dialog" aria-modal="true" [attr.aria-labelledby]="titleId"
         (scDialogEscape)="closed.emit(null)">
      <h2 [id]="titleId">{{ 'hq.einsatz.pick.title' | translate }}</h2>
      <p class="msg">{{ 'hq.einsatz.pick.message' | translate: { name: missionTitle() } }}</p>
      @if (options().length) {
        <ul class="list" (keydown)="onListKey($event)">
          @for (o of options(); track o.id; let first = $first) {
            <li>
              <button type="button" class="opt" [attr.cdkFocusInitial]="first ? '' : null" (click)="closed.emit({ kind: 'existing', id: o.id })">
                <span class="name">{{ o.title }}</span>
                <span class="n">{{ 'hq.einsatz.stepsTooltip' | translate: { n: o.steps } }}</span>
              </button>
            </li>
          }
        </ul>
      } @else {
        <p class="msg muted">{{ 'hq.einsatz.pick.none' | translate }}</p>
      }
      <div class="actions">
        <button type="button" class="sc-btn" (click)="closed.emit(null)">{{ 'common.dialog.cancel' | translate }}</button>
        <button type="button" class="sc-btn sc-btn-primary" [attr.cdkFocusInitial]="options().length ? null : ''"
                (click)="closed.emit({ kind: 'new' })">{{ 'hq.einsatz.pick.new' | translate }}</button>
      </div>
    </div>
  `,
  styles: [
    `
      :host { display: block; }
      .pick {
        inline-size: min(var(--sc-ov-s), calc(100vw - 32px));
        max-block-size: calc(100vh - 32px);
        max-block-size: calc(100dvh - 32px);
        overflow: auto;
        display: flex;
        flex-direction: column;
        gap: 12px;
        margin: 0;
      }
      h2 { margin: 0; font-family: var(--sc-font-display); font-size: 1.05rem; color: var(--sc-fg-0); overflow-wrap: anywhere; }
      .msg { margin: 0; color: var(--sc-fg-1); overflow-wrap: anywhere; }
      .muted { color: var(--sc-fg-2); }
      .list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 6px; }
      .opt {
        inline-size: 100%;
        min-block-size: 44px;
        display: flex;
        align-items: center;
        gap: 10px;
        padding: 8px 12px;
        border: 1px solid var(--sc-border);
        border-radius: var(--sc-radius, 6px);
        background: var(--sc-bg-1);
        color: var(--sc-fg-0);
        font: inherit;
        text-align: start;
        cursor: pointer;
      }
      .opt:hover { border-color: var(--sc-accent); }
      .opt:focus-visible { outline: 2px solid var(--sc-accent); outline-offset: 2px; }
      .name { flex: 1; min-inline-size: 0; overflow-wrap: anywhere; }
      .n { color: var(--sc-fg-2); font-size: 0.85rem; flex-shrink: 0; }
      .actions { display: flex; flex-wrap: wrap; justify-content: flex-end; gap: 8px; margin-top: 4px; }
      .sc-btn { justify-content: center; }
      @media (max-width: 480px) { .actions .sc-btn { flex: 1 1 100%; } }
    `,
  ],
})
export class HqEinsatzPickDialogComponent {
  readonly missionTitle = input('');
  readonly options = input<readonly EinsatzPickOption[]>([]);
  readonly closed = output<EinsatzPick | null>();
  readonly titleId = `sc-einsatz-pick-${++uid}`;

  /** Arrow keys move between the Einsatz buttons (Home / End to the ends). */
  onListKey(ev: KeyboardEvent): void {
    const list = ev.currentTarget as HTMLElement;
    const items = Array.from(list.querySelectorAll<HTMLButtonElement>('button.opt'));
    const at = items.indexOf(document.activeElement as HTMLButtonElement);
    const next =
      ev.key === 'ArrowDown' ? Math.min(items.length - 1, at + 1)
      : ev.key === 'ArrowUp' ? Math.max(0, at - 1)
      : ev.key === 'Home' ? 0
      : ev.key === 'End' ? items.length - 1
      : -1;
    if (next < 0 || at < 0) return;
    ev.preventDefault();
    items[next]?.focus();
  }
}
