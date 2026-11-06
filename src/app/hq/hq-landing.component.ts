import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { BetaService } from '../core/beta.service';
import { HqPatchService } from './data/hq-patch.service';
import { HqOverviewComponent } from './hq-overview.component';
import { HqPagesComponent } from './hq-pages.component';

/**
 * `/hq` — the beta shell shows the five-page landing ({@link HqPagesComponent}); with the β off
 * today's overview stays exactly as it is ({@link HqOverviewComponent}).
 */
@Component({
  selector: 'sc-hq-landing',
  standalone: true,
  imports: [HqPagesComponent, HqOverviewComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (shell()) {
      <sc-hq-pages />
    } @else {
      <sc-hq-overview />
    }
  `,
  styles: [':host { display: block; }'],
})
export class HqLandingComponent {
  readonly shell = inject(BetaService).isEnabled('shell');
  /** Loads the newest patch vs the reader's ships/sets and feeds the Start hero's patch hit (P8). */
  private readonly patch = inject(HqPatchService);
}
