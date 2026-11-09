import { EventHqService } from './events/event-hq.service';
import { onScrollTick } from '../core/scroll-tick';
import { ChangeDetectionStrategy, Component, DestroyRef, NgZone, afterNextRender, inject, signal } from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';
import { BetaService } from '../core/beta.service';
import { HQ_PAGE_ICONS, HqPageNavService } from './hq-page-nav.service';

/** Scroll distance (px) in one direction before the bar follows it. */
export const PAGE_BAR_SLACK_PX = 12;

/**
 * Phone / tablet bottom bar of the HQ pages (concept D4, below 1024px where the rail would
 * squeeze the content): five icon + short label anchors in a `.sc-dock-phone` bar that keeps
 * clear of the safe area and the feedback launcher's lane. It hides on scroll down and
 * shows again on scroll up. Pure anchors, like the rail.
 */
@Component({
  selector: 'sc-hq-page-bar',
  standalone: true,
  imports: [TranslatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '[class.hidden]': 'hidden()', '[class.above-bar]': 'shellOn()' },
  template: `
    <nav class="bar sc-dock-phone" [attr.aria-label]="'hq.rail.label' | translate">
      @for (p of nav.pages; track p) {
        <a class="tab" [href]="nav.href(p)" (click)="nav.go($event, p)"
           [attr.aria-label]="'hq.pages.' + p | translate"
           [attr.aria-current]="nav.active() === p ? 'page' : null">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path [attr.d]="icons[p]" /></svg>
          @if (p === 'planen' && events.hasOpen()) { <i class="evdot" [attr.aria-label]="'hq.events.dot' | translate" role="img"></i> }
          <span>{{ 'hq.pages.' + p | translate }}</span>
        </a>
      }
    </nav>
  `,
  styles: [
    `
      .evdot { position: absolute; top: 6px; right: 8px; width: 9px; height: 9px; border-radius: 50%; background: var(--sc-accent); box-shadow: 0 0 0 2px var(--sc-bg-1); }
      .tab { position: relative; }
      :host { display: none; }
      @media (max-width: 1023px) {
        :host {
          display: block;
          position: sticky;
          bottom: calc(12px + var(--sc-safe-bottom, 0px));
          z-index: 4;
          margin-inline-end: var(--sc-fab-clear-inline, 0px);
          pointer-events: none;
          transition: translate 0.25s ease;
        }
        :host(.hidden) { translate: 0 calc(100% + var(--sc-float-bottom, 12px) + 12px); }
      }
      .bar {
        position: static;
        pointer-events: auto;
        display: grid;
        grid-template-columns: repeat(5, 1fr);
        gap: var(--sc-space-1, 4px);
        padding: var(--sc-space-1, 4px);
        border: 1px solid var(--sc-border);
        border-radius: 14px;
        background: color-mix(in srgb, var(--sc-bg-1) 96%, transparent);
      }
      .tab {
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        gap: 2px;
        min-height: 48px;
        padding: 4px 2px;
        border-radius: 10px;
        color: var(--sc-fg-2);
        text-decoration: none;
        font-size: max(0.7rem, var(--sc-fs-floor));
      }
      .tab svg { width: 20px; height: 20px; fill: none; stroke: currentColor; stroke-width: 1.8; stroke-linecap: round; stroke-linejoin: round; }
      .tab[aria-current='page'] { color: var(--sc-accent); background: color-mix(in srgb, var(--sc-accent) 12%, transparent); }
      .tab:focus-visible { outline: 2px solid var(--sc-accent); outline-offset: -2px; }
      /* Beta shell on a phone: the docked fusion bar stands at the bottom edge too (and under this
         bar's left end it showed through, seen in a real phone viewport), so this bar sits on top of it. */
      @media (max-width: 720px) {
        /* One row above the launcher's row, so its lane is not needed: the full width, every label. */
        :host(.above-bar) {
          bottom: calc(var(--sc-float-bottom, 12px) + var(--sc-bar-h, 56px) + var(--sc-space-2, 8px));
          margin-inline-end: 0;
        }
        /* Hidden: it must travel its own raise as well, else it peeks out under the fusion bar. */
        :host(.above-bar.hidden) {
          translate: 0 calc(100% + var(--sc-float-bottom, 12px) + var(--sc-bar-h, 56px) + var(--sc-space-2, 8px) + 12px);
        }
      }
      /* Narrow phones: the bar shares its row with the feedback launcher's lane, so five labels
         no longer fit and "Statistik" hung out of the panel (seen in a real phone viewport).
         Only the current page keeps its name, the others are icons (the aria-label names them).
         Legacy shell only: with the beta shell the bar stacks above the fusion bar at full width. */
      @media (max-width: 480px) {
        :host(:not(.above-bar)) .bar { display: flex; }
        :host(:not(.above-bar)) .tab { flex: 1 1 0; min-width: 0; padding-inline: 2px; }
        :host(:not(.above-bar)) .tab span { display: none; }
        :host(:not(.above-bar)) .tab[aria-current='page'] { flex: 2.4 1 0; }
        :host(:not(.above-bar)) .tab[aria-current='page'] span { display: inline; }
      }
      @media (prefers-reduced-motion: reduce) { :host { transition: none; } }
    `,
  ],
})
export class HqPageBarComponent {
  protected readonly events = inject(EventHqService);
  protected readonly nav = inject(HqPageNavService);
  protected readonly icons = HQ_PAGE_ICONS;
  readonly hidden = signal(false);
  /** Beta shell: the fusion bar docks at the phone's bottom edge, this bar stacks above it. */
  protected readonly shellOn = inject(BetaService).isEnabled('shell');

  constructor() {
    const zone = inject(NgZone);
    const destroyRef = inject(DestroyRef);
    afterNextRender(() => {
      let last = window.scrollY;
      let run = 0;
      const onScroll = () => {
        const y = window.scrollY;
        const dy = y - last;
        last = y;
        // Direction changes restart the run; the bar follows a run longer than the slack.
        run = Math.sign(dy) === Math.sign(run) ? run + dy : dy;
        if (y < PAGE_BAR_SLACK_PX) {
          if (this.hidden()) zone.run(() => this.hidden.set(false));
        } else if (run > PAGE_BAR_SLACK_PX && !this.hidden()) {
          zone.run(() => this.hidden.set(true));
        } else if (run < -PAGE_BAR_SLACK_PX && this.hidden()) {
          zone.run(() => this.hidden.set(false));
        }
      };
      destroyRef.onDestroy(onScrollTick({ read: onScroll }));
    });
  }
}
