import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { TranslatePipe } from '@ngx-translate/core';
import { BetaService } from '../../../core/beta.service';
import { AREA_ENTRIES } from '../../../shell/fusion-bar/fusion-bar.model';

/**
 * TEST ELEMENT (admin feedback 20af7dd2): the Verse / Codex / HQ links once more
 * at the very bottom of /verse, centred under the Patches, so a reader who
 * scrolled down does not have to go back up. Easy to remove: delete this
 * component and its tag in verse-briefing.component.html.
 * Same entries and HQ gating as the header's area menu; Verse is the current area.
 */
@Component({
  selector: 'sc-verse-area-foot',
  standalone: true,
  imports: [RouterLink, TranslatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <nav class="foot" [attr.aria-label]="'verse.areaFoot.aria' | translate">
      @for (a of areas(); track a.id) {
        <a [routerLink]="a.link" [attr.aria-current]="a.id === 'verse' ? 'page' : null">{{ a.labelKey | translate }}</a>
      }
    </nav>
  `,
  styles: `
    :host { display: block; }
    .foot {
      display: flex; flex-wrap: wrap; justify-content: center;
      gap: var(--sc-space-2);
      padding: var(--sc-space-6) 0 var(--sc-float-bottom, var(--sc-space-6));
    }
    a {
      display: inline-flex; align-items: center; justify-content: center;
      min-height: 48px; padding: 0 var(--sc-space-4);
      border: 1px solid var(--sc-border); border-radius: var(--sc-radius-pill, 999px);
      color: var(--sc-text-muted, inherit); text-decoration: none;
    }
    a:hover, a:focus-visible, a[aria-current] { color: var(--sc-accent); border-color: var(--sc-accent); }
    a:focus-visible { outline: 2px solid var(--sc-accent); outline-offset: 2px; }
  `,
})
export class VerseAreaFootComponent {
  private readonly codexBeta = inject(BetaService).isEnabled('codex');
  readonly areas = computed(() =>
    AREA_ENTRIES.filter((a) => a.id === 'verse' || a.id === 'codex' || (a.id === 'hq' && this.codexBeta())),
  );
}
