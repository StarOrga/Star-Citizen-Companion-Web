import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';
import { SET_LENSES, SetLensId } from './set-rating';
import { ScTooltipDirective } from '../../shared/tooltip/sc-tooltip.directive';

/**
 * "Einsatz" for the on-foot set page — mirrors `CodexMissionBarComponent`'s
 * one-row chip strip (never wraps or clips, scrolls instead) for the set's
 * fixed lens list (`SET_LENSES`, set-rating.ts). Purely presentational: the
 * page owns the chosen lens and persists it (`setLensStorageKey`); this only
 * renders the strip and emits a change. A disabled lens (no signature data,
 * no data at all yet) shows its reason through the app's own tooltip
 * component instead of the native `title` — ui-defaults.md R0.
 */
@Component({
  selector: 'sc-codex-set-mission-bar',
  standalone: true,
  imports: [TranslatePipe, ScTooltipDirective],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="mission-bar">
      <span class="mission-label">{{ 'codex.mission.label' | translate }}</span>
      <div class="mission-chips" role="radiogroup" [attr.aria-label]="'codex.mission.label' | translate">
        @for (l of lenses; track l.id) {
          <span
            class="chip-wrap"
            [scTooltip]="l.tipKey | translate"
            [scTooltipTier]="l.disabled ? 'label' : 'info'"
          >
            <button
              type="button"
              role="radio"
              class="mission-chip"
              [class.active]="lens() === l.id"
              [disabled]="l.disabled"
              [attr.aria-checked]="lens() === l.id"
              [attr.aria-disabled]="l.disabled ? 'true' : null"
              [attr.aria-describedby]="l.disabled ? ('set-mission-reason-' + l.id) : null"
              (click)="select(l.id)"
            >
              <span class="chip-icon" aria-hidden="true">{{ l.iconGlyph }}</span>
              <span class="chip-label">{{ l.labelKey | translate }}</span>
            </button>
          </span>
          @if (l.disabled && l.disabledReasonKey) {
            <span [id]="'set-mission-reason-' + l.id" class="sr-only">{{ l.disabledReasonKey | translate }}</span>
          }
        }
      </div>
      @if (lens() !== 'all') {
        <span class="idle-draft">
          <button type="button" class="btn" (click)="lensChange.emit('all')">
            {{ 'codex.mission.lensReset' | translate }}
          </button>
        </span>
      }
    </div>
  `,
  styles: [`
    :host { display: block; }
    .sr-only { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); }

    .mission-bar {
      display: flex;
      align-items: center;
      gap: 5px;
      overflow-x: auto;
      white-space: nowrap;
      border: 1px solid var(--sc-border);
      border-radius: 4px;
      padding: 5px 8px;
    }
    .mission-label {
      font-family: var(--sc-font-display);
      font-size: max(9.5px, var(--sc-fs-floor));
      letter-spacing: 0.14em;
      text-transform: uppercase;
      color: var(--sc-fg-2);
      flex: none;
      margin-right: 4px;
    }
    .mission-chips { display: flex; gap: 5px; flex: none; }
    /* Wrapper carries the tooltip: a disabled button gets no pointer events,
       so the "why disabled" hover must land on the span around it — same
       pattern as the ship rank card's profile chips. */
    .chip-wrap { display: inline-flex; }
    .mission-chip {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      min-height: 48px;
      padding: 8px 14px;
      background: color-mix(in srgb, var(--sc-bg-0) 72%, transparent);
      border: 1px solid var(--sc-border);
      border-radius: 3px;
      color: var(--sc-fg-2);
      cursor: pointer;
      flex: none;
      font-family: var(--sc-font-body);
      font-size: max(10px, var(--sc-fs-floor));
      letter-spacing: 0.12em;
      text-transform: uppercase;
    }
    .mission-chip.active {
      border-color: color-mix(in srgb, var(--sc-accent) 62%, var(--sc-bg-0));
      color: var(--sc-accent);
      background: color-mix(in srgb, var(--sc-accent) 14%, var(--sc-bg-0));
    }
    .mission-chip:disabled { opacity: 0.38; cursor: not-allowed; }
    .chip-icon { font-size: inherit; }
    .idle-draft { display: flex; align-items: center; gap: 5px; flex: none; margin-left: auto; }
    .idle-draft .btn {
      padding: 8px 14px; border-radius: 3px; cursor: pointer;
      background: color-mix(in srgb, var(--sc-bg-0) 72%, transparent);
      border: 1px solid var(--sc-border); color: var(--sc-fg-2);
      font-family: var(--sc-font-body);
      font-size: max(10px, var(--sc-fs-floor));
      letter-spacing: 0.12em;
      text-transform: uppercase;
    }

    @media (pointer: fine) {
      .mission-chip, .idle-draft .btn { min-height: 24px; padding: 4px 8px; }
    }
  `],
})
export class CodexSetMissionBarComponent {
  readonly lens = input<SetLensId>('all');
  readonly lensChange = output<SetLensId>();

  readonly lenses = SET_LENSES;

  select(id: SetLensId): void {
    const def = this.lenses.find((l) => l.id === id);
    if (!def || def.disabled) return;
    this.lensChange.emit(id);
  }
}
