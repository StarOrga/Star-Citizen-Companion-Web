import { ChangeDetectionStrategy, Component } from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';
import { PageHeaderComponent } from '../shared/page-header/page-header.component';

/** HQ "Einsätze" (ops) — planning lands in a later stage; until then an honest "coming soon" state. */
@Component({
  selector: 'sc-hq-ops',
  standalone: true,
  imports: [TranslatePipe, PageHeaderComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <sc-page-header
      [eyebrow]="'hq.title' | translate"
      [title]="'hq.ops.title' | translate"
      [subtitle]="'hq.ops.subtitle' | translate" />
    <div class="sc-card empty" role="status">
      <span class="soon">{{ 'hq.ops.soon' | translate }}</span>
      <p>{{ 'hq.ops.empty' | translate }}</p>
    </div>
  `,
  styles: [
    `
      :host { display: block; }
      .empty { display: flex; flex-direction: column; gap: 8px; padding: 24px; max-width: var(--sc-measure, 68ch); }
      .empty p { margin: 0; color: var(--sc-fg-2); }
      .soon {
        align-self: flex-start;
        padding: 2px 8px;
        border: 1px solid var(--sc-accent);
        border-radius: 999px;
        color: var(--sc-accent);
        font-size: max(0.8rem, var(--sc-fs-floor));
        text-transform: uppercase;
        letter-spacing: 0.06em;
      }
    `,
  ],
})
export class HqOpsComponent {}
