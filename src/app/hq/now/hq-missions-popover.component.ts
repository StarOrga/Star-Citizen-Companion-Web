import { ChangeDetectionStrategy, Component, input, signal } from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';
import { ScDialogDirective } from '../../shared/dialog/sc-dialog.directive';
import { ScTooltipDirective } from '../../shared/tooltip/sc-tooltip.directive';
import { LiveContract } from './hq-live.util';

/** Active in-game missions as an icon with a count (top right); opens a small list. */
@Component({
  selector: 'sc-hq-missions-popover',
  standalone: true,
  imports: [TranslatePipe, ScTooltipDirective, ScDialogDirective],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <button
      type="button"
      class="icon"
      [scTooltip]="'hq.now.missions.tooltip' | translate"
      [attr.aria-label]="'hq.now.missions.tooltip' | translate"
      [attr.aria-expanded]="open()"
      aria-haspopup="dialog"
      (click)="open.set(!open())"
    >
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <polygon points="12,2.2 14.8,8.9 22,9.5 16.5,14.2 18.2,21.3 12,17.5 5.8,21.3 7.5,14.2 2,9.5 9.2,8.9" />
      </svg>
      <span class="count mono">{{ contracts().length }}</span>
    </button>
    @if (open()) {
      <div
        class="panel"
        role="dialog"
        scDialog
        [scDialogModal]="false"
        [attr.aria-label]="'hq.now.missions.title' | translate"
        (scDialogEscape)="open.set(false)"
      >
        <h3>{{ 'hq.now.missions.title' | translate }}</h3>
        @if (contracts().length === 0) {
          <p class="none">{{ 'hq.now.missions.none' | translate }}</p>
        } @else {
          <ul>
            @for (c of contracts(); track c.missionId || c.name) {
              <li>
                <b>{{ c.name }}</b>
                @if (c.objective) { <span>{{ c.objective }}</span> }
              </li>
            }
          </ul>
        }
      </div>
    }
  `,
  styles: [
    `
      :host { position: relative; display: inline-block; }
      .icon {
        display: inline-flex; align-items: center; gap: 6px; min-height: 44px; min-width: 44px; padding: 0 var(--sc-space-3, 12px);
        justify-content: center; border-radius: var(--sc-radius, 10px); border: 1px solid var(--sc-border); background: var(--sc-surface-2, transparent);
        color: var(--sc-fg); cursor: pointer;
      }
      .icon:hover { border-color: var(--sc-accent); }
      .icon svg { width: 20px; height: 20px; fill: none; stroke: var(--sc-accent); stroke-width: 1.8; stroke-linejoin: round; }
      .count { font-weight: 700; }
      .panel {
        position: absolute; right: 0; top: calc(100% + 6px); z-index: 20; width: min(320px, calc(100vw - 2 * var(--sc-page-gutter, 16px)));
        padding: var(--sc-space-3, 12px); border: 1px solid var(--sc-border); border-radius: var(--sc-radius, 10px); background: var(--sc-surface, #111);
        box-shadow: 0 8px 28px rgb(0 0 0 / 0.4);
      }
      h3 { margin: 0 0 var(--sc-space-2, 8px); font-size: 0.95rem; }
      ul { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: var(--sc-space-2, 8px); }
      li { display: flex; flex-direction: column; }
      li span, .none { color: var(--sc-fg-2); font-size: max(0.85rem, var(--sc-fs-floor)); }
      .none { margin: 0; }
    `,
  ],
})
export class HqMissionsPopoverComponent {
  readonly contracts = input.required<readonly LiveContract[]>();
  readonly open = signal(false);
}
