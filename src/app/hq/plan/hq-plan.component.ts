import { ChangeDetectionStrategy, Component } from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';

/**
 * HQ page "Planen" — host of the planning page (Was ⇄ Wie, selection, map, route list).
 * Placeholder of the web-frame package: the section frame (`<section id="planen">`, the page
 * column at subheader width) belongs to `HqPagesComponent`; this component only fills it.
 * Wave 2 (web-ops) replaces the body of this file — selector and file name stay.
 */
@Component({
  selector: 'sc-hq-plan',
  standalone: true,
  imports: [TranslatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <h2 class="page-title" id="hq-plan-title">{{ 'hq.pages.planen' | translate }}</h2>
    <p class="empty" role="status">{{ 'hq.pages.empty' | translate: { page: ('hq.pages.planen' | translate) } }}</p>
  `,
  styles: [
    `
      :host { display: block; }
      .page-title { margin: 0 0 var(--sc-space-3, 12px); font: 600 1.6rem / 1.2 var(--sc-font-display); }
      .empty { margin: 0; color: var(--sc-fg-2); }
    `,
  ],
})
export class HqPlanComponent {}
