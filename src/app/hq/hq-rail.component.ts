import { EventHqService } from './events/event-hq.service';
import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';
import { ScTooltipDirective } from '../shared/tooltip/sc-tooltip.directive';
import { HQ_PAGE_ICONS, HqPageNavService, hqPageHotkey } from './hq-page-nav.service';

/**
 * The left-edge quick-scroll rail (concept D4): the five HQ pages as slim vertical real
 * anchors at the page edge, outside the content column; the label shows as plain text on hover and focus, the
 * page in view carries `aria-current`. Desktop only (≥ 1024px) — narrower viewports get the
 * bottom bar ({@link HqPageBarComponent}). The page's hotkey never shows at rest: a long hover says
 * it (info tier), the label stays as it is.
 */
@Component({
  selector: 'sc-hq-rail',
  standalone: true,
  imports: [TranslatePipe, ScTooltipDirective],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <nav class="rail" [attr.aria-label]="'hq.rail.label' | translate">
      @for (p of nav.pages; track p) {
        @let key = hotkey(p);
        <a class="stop" [href]="nav.href(p)" (click)="nav.go($event, p)"
           [attr.aria-keyshortcuts]="key"
           [scTooltip]="key ? ('hq.hotkey' | translate: { key }) : null"
           [scTooltipDisabled]="nav.noHover"
           [attr.aria-current]="nav.active() === p ? 'page' : null"
           [attr.aria-label]="'hq.rail.goto' | translate: { page: ('hq.pages.' + p | translate) }">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path [attr.d]="icons[p]" /></svg>
          @if (p === 'planen' && events.hasOpen()) { <i class="evdot" [attr.aria-label]="'hq.events.dot' | translate" role="img"></i> }
          <span class="label" aria-hidden="true">{{ 'hq.pages.' + p | translate }}</span>
        </a>
      }
    </nav>
  `,
  styles: [
    `
      .evdot { position: absolute; top: 6px; right: 8px; width: 9px; height: 9px; border-radius: 50%; background: var(--sc-accent); box-shadow: 0 0 0 2px var(--sc-bg-1); }
      .stop { position: relative; }
      :host { display: none; }
      @media (min-width: 1024px) {
        :host {
          display: block;
          position: fixed;
          z-index: 5;
          top: 50%;
          left: max(var(--sc-fab-inset, 16px), env(safe-area-inset-left));
          translate: 0 -50%;
        }
      }
      .rail { display: flex; flex-direction: column; gap: var(--sc-space-1, 4px); }
      .stop {
        position: relative;
        display: flex;
        align-items: center;
        gap: var(--sc-space-2, 8px);
        width: 36px;
        height: 36px;
        padding: 0 7px;
        box-sizing: border-box;
        border: 1px solid transparent;
        border-radius: 999px;
        color: var(--sc-fg-2);
        text-decoration: none;
        white-space: nowrap;
        transition: width 0.2s ease, color 0.2s;
      }
      .stop svg { flex: none; width: 20px; height: 20px; fill: none; stroke: currentColor; stroke-width: 1.8; stroke-linecap: round; stroke-linejoin: round; }
      .label { font-size: max(0.8rem, var(--sc-fs-floor)); letter-spacing: 0.06em; opacity: 0; transition: opacity 0.15s; }
      /* Hover and focus name the page as plain text beside the icon, no pill around it: the bar on the left already
         marks where the reader is. The shadow keeps the label legible where it crosses the page behind it. */
      .stop:hover, .stop:focus-visible {
        width: 128px;
        color: var(--sc-fg);
      }
      .label { text-shadow: 0 0 6px var(--sc-bg-0), 0 0 2px var(--sc-bg-0); }
      .stop:hover .label, .stop:focus-visible .label { opacity: 1; }
      .stop:focus-visible { outline: 2px solid var(--sc-accent); outline-offset: 2px; }
      .stop[aria-current='page'] { color: var(--sc-accent); }
      .stop[aria-current='page']::before {
        content: '';
        position: absolute;
        left: -8px;
        top: 8px;
        bottom: 8px;
        width: 2px;
        border-radius: 2px;
        background: var(--sc-accent);
        box-shadow: 0 0 8px var(--sc-accent);
      }
      @media (prefers-reduced-motion: reduce) {
        .stop, .label { transition: none; }
      }
    `,
  ],
})
export class HqRailComponent {
  protected readonly events = inject(EventHqService);
  private readonly warm = this.events.ensure();
  protected readonly nav = inject(HqPageNavService);
  protected readonly icons = HQ_PAGE_ICONS;
  protected readonly hotkey = hqPageHotkey;
}
