import { ChangeDetectionStrategy, Component } from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';

/**
 * The one marker for "weicht vom Werk ab" (C19): a filled diamond in the app
 * accent, never red or copper. Identical on the hull tag/pin, the Bauteile
 * list, the inspector and the "Bauteile im Detail" list; the words stay as
 * screen-reader text.
 */
@Component({
  selector: 'sc-holo-diff-marker',
  standalone: true,
  imports: [TranslatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<i class="mk" aria-hidden="true"></i><span class="sc-sr-only">{{ 'codex.holo.diffMarker' | translate }}</span>`,
  styles: [`
    :host { display: inline-flex; align-items: center; flex: none; line-height: 1; }
    .mk { display: block; width: 7px; height: 7px; background: var(--sc-accent); transform: rotate(45deg);
      box-shadow: 0 0 6px color-mix(in srgb, var(--sc-accent) 60%, transparent); }
  `],
})
export class HoloDiffMarkerComponent {}
