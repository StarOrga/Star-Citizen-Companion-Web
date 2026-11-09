import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';
import { ScActionDirective } from '../../shared/action/sc-action.directive';
import { ScTooltipDirective } from '../../shared/tooltip/sc-tooltip.directive';
import type { CalloutValue } from '../asset-package/asset-package-viewer.component';
import { HoloDiffMarkerComponent } from './holo-diff-marker';

/**
 * The one callout of the Holotisch (holotisch-feinschliff C9): the same card in
 * the 3D view and in every schema view. Header = the component TYPE (the port
 * category, e.g. "Waffen", "Kühler"), the name below, three values, and the
 * swap icon button that opens the same swap flow the inspector uses.
 *
 * Purely presentational and sized by `--co-u` (the host sets it, 1 = 188 px
 * wide); the host positions it and draws the leader line.
 */
@Component({
  selector: 'sc-holo-callout',
  standalone: true,
  imports: [TranslatePipe, ScActionDirective, ScTooltipDirective, HoloDiffMarkerComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="co" role="group" [attr.aria-label]="'codex.holo.callout.aria' | translate: { type: type() ?? '', name: name() }">
      <span class="k">
        <span class="k-t">{{ type() }}</span>
        @if (diff()) { <sc-holo-diff-marker /> }
      </span>
      <b class="nm" [scTooltip]="name()" scTooltipTier="label">{{ name() }}</b>
      <div class="v">
        @for (v of values().slice(0, 3); track v.label) {
          <span [scTooltip]="v.label + ': ' + v.value" scTooltipTier="label"><small>{{ v.label }}</small>{{ v.value }}</span>
        }
        @if (swappable()) {
          <button type="button" scAction tier="tertiary" class="sw" (click)="swap.emit()"
                  [attr.aria-label]="'codex.holo.callout.swap' | translate"
                  [scTooltip]="'codex.holo.callout.swap' | translate" scTooltipTier="label">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 4L3 8l4 4M3 8h14M17 12l4 4-4 4M21 16H7" /></svg>
          </button>
        }
      </div>
    </div>
  `,
  styles: [`
    :host { --co-u: 1px; display: block; width: calc(188 * var(--co-u)); pointer-events: auto; }
    .co { box-sizing: border-box; display: flex; flex-direction: column; gap: calc(4 * var(--co-u));
      padding: calc(7 * var(--co-u)) calc(9 * var(--co-u)) calc(8 * var(--co-u));
      border: 1px solid rgb(from var(--sc-accent) r g b / 0.55); border-radius: calc(10 * var(--co-u));
      background: rgb(from var(--sc-bg-1) r g b / 0.9); }
    .k { display: flex; align-items: center; gap: calc(5 * var(--co-u)); color: var(--sc-accent); text-transform: uppercase;
      letter-spacing: 0.13em; font: 400 max(9px, calc(9.5 * var(--co-u))) / 1.1 var(--sc-font-display); }
    .k-t { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .nm { font-size: calc(12.5 * var(--co-u)); line-height: 1.2; font-weight: 600; color: var(--sc-fg-0);
      white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .v { display: grid; align-items: end; gap: calc(3 * var(--co-u));
      grid-template-columns: repeat(3, minmax(0, 1fr)) auto; }
    .v span { min-width: 0; color: var(--sc-fg-0); white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
      font: 600 calc(12.5 * var(--co-u)) / 1.05 var(--font-monospace, monospace); }
    .v small { display: block; color: var(--sc-fg-2); white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
      margin-bottom: calc(1 * var(--co-u)); font: 400 max(8px, calc(8.5 * var(--co-u))) / 1.15 var(--sc-font-body); }
    .sw svg { width: 1.15em; height: 1.15em; fill: none; stroke: currentColor; stroke-width: 1.8; stroke-linecap: round; stroke-linejoin: round; }
  `],
})
export class CodexHoloCalloutComponent {
  /** The component type: the port category's label. */
  readonly type = input<string | null>(null);
  readonly name = input.required<string>();
  /** Up to three values, already translated. */
  readonly values = input<readonly CalloutValue[]>([]);
  readonly swappable = input(false);
  /** The part differs from the stock loadout (C19). */
  readonly diff = input(false);
  /** The swap button was pressed. */
  readonly swap = output<void>();
}
