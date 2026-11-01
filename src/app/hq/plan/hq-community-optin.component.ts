import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';
import { HqCommunityService } from '../data/hq-community.service';
import { ScTristateComponent } from '../../shared/tristate/sc-tristate.component';

/**
 * The "Community-Daten teilen" toggle (D43): an app tri-state checkbox plus its
 * label and a one-line consequence. Default off; the plan page embeds it.
 */
@Component({
  selector: 'sc-hq-community-optin',
  standalone: true,
  imports: [TranslatePipe, ScTristateComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="row">
      <sc-tristate variant="checkbox" [value]="on() ? 1 : 0" [label]="'hq.community.share' | translate" (toggled)="svc.setShare($event >= 1)" />
      <span class="text">
        <span class="name" aria-hidden="true">{{ 'hq.community.share' | translate }}</span>
        <span class="hint">{{ (on() ? 'hq.community.shareOn' : 'hq.community.shareOff') | translate }}</span>
      </span>
    </div>
  `,
  styles: [
    `
      :host { display: block; }
      .row { display: flex; align-items: flex-start; gap: var(--sc-space-2, 8px); }
      .text { display: flex; flex-direction: column; min-width: 0; }
      .name { color: var(--sc-fg-0); }
      .hint { font-size: max(0.8rem, var(--sc-fs-floor)); color: var(--sc-fg-2); }
    `,
  ],
})
export class HqCommunityOptinComponent {
  protected readonly svc = inject(HqCommunityService);
  protected readonly on = this.svc.shareEnabled;
}
