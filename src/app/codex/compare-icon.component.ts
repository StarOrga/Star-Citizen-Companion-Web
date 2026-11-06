import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { PATH_ICONS } from '../shared/item-path/path-icons';

/** The compare mark (a balance scale, concept gegenstand-weg E4); `on` fills it while the item is in the tray. */
@Component({
  selector: 'sc-compare-icon',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<svg class="sc-action-icon" [class.is-filled]="on()" viewBox="0 0 24 24" aria-hidden="true">@for (d of paths; track $index) { <path [attr.d]="d" /> }</svg>`,
  // Self-contained stroke style: the icon also sits in plain `.act` buttons outside `.sc-action`.
  styles: [`
    :host { display: inline-flex; align-items: center; }
    svg { width: 18px; height: 18px; flex: none; fill: none; stroke: currentColor; stroke-width: 1.8; stroke-linecap: round; stroke-linejoin: round; }
    svg.is-filled { fill: color-mix(in srgb, currentColor 28%, transparent); }
  `],
})
export class CompareIconComponent {
  readonly on = input(false);
  protected readonly paths = PATH_ICONS.compare;
}
