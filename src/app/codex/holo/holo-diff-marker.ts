import { ChangeDetectionStrategy, Component } from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';
import { ScTooltipDirective } from '../../shared/tooltip/sc-tooltip.directive';

/**
 * The one marker "◆ weicht vom Werk ab" (holotisch-feinschliff C19): a filled
 * diamond in the app accent — never red, never copper (those mark elevated
 * access). The same element sits on the hull tag and pin, in the Bauteile list,
 * in the inspector and in the lower "Bauteile im Detail" list. The words are
 * screen-reader text and the tooltip; nothing visible besides the diamond.
 */
@Component({
  selector: 'sc-holo-diff-marker',
  standalone: true,
  imports: [TranslatePipe, ScTooltipDirective],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'holo-diff-marker', '[scTooltip]': "'codex.holo.diffMarker' | translate", scTooltipTier: 'label' },
  template: `<svg viewBox="0 0 10 10" aria-hidden="true"><path d="M5 0.5 9.5 5 5 9.5 0.5 5z" /></svg><span class="sc-sr-only">{{ 'codex.holo.diffMarker' | translate }}</span>`,
  styles: [`
    :host { display: inline-flex; align-items: center; vertical-align: middle; flex: none; color: var(--sc-accent); line-height: 1; }
    svg { width: 0.7em; height: 0.7em; min-width: 7px; min-height: 7px; fill: currentColor; display: block; }
  `],
})
export class HoloDiffMarkerComponent {}
