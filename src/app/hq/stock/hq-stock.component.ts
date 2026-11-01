import { ChangeDetectionStrategy, Component } from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';

/**
 * HQ page "Bestand" — host of the holdings page (Schiffe, Sets, Erspieltes, Lager per Ort).
 * Placeholder of the web-frame package: the section frame belongs to `HqPagesComponent`.
 * Wave 4 (web-stats) replaces the body of this file — selector and file name stay.
 */
@Component({
  selector: 'sc-hq-stock',
  standalone: true,
  imports: [TranslatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <h2 class="page-title" id="hq-stock-title">{{ 'hq.pages.bestand' | translate }}</h2>
    <p class="empty" role="status">{{ 'hq.pages.empty' | translate: { page: ('hq.pages.bestand' | translate) } }}</p>
  `,
  styles: [
    `
      :host { display: block; }
      .page-title { margin: 0 0 var(--sc-space-3, 12px); font: 600 1.6rem / 1.2 var(--sc-font-display); }
      .empty { margin: 0; color: var(--sc-fg-2); }
    `,
  ],
})
export class HqStockComponent {}
