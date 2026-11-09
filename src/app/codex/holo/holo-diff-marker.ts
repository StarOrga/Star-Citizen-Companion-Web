import { ChangeDetectionStrategy, Component } from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';

/**
 * The one marker for "weicht vom Werk ab" (concept holotisch-feinschliff C19): a filled diamond in the app
 * accent, never red or copper, with the words for assistive tech. Hull tag, pin, Bauteile list, inspector,
 * the lower part list and the hangar menu all use this component, so the code looks the same everywhere.
 */
@Component({
  selector: 'sc-holo-diff-marker',
  standalone: true,
  imports: [TranslatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<i class="mk" aria-hidden="true"></i><span class="sc-sr-only">{{ 'codex.holo.diffMarker' | translate }}</span>`,
  styles: [`
    :host { display: inline-flex; align-items: center; flex: none; }
    .mk { display: block; width: 7px; height: 7px; background: var(--sc-accent); transform: rotate(45deg); border-radius: 1px; }
  `],
})
export class HoloDiffMarkerComponent {}
