import { ChangeDetectionStrategy, Component, DestroyRef, NgZone, afterNextRender, inject, signal } from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';
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
  host: { '[class.hidden]': 'hidden()' },
  template: `
    <nav class="bar sc-dock-phone" [attr.aria-label]="'hq.rail.label' | translate">
      @for (p of nav.pages; track p) {
        <a class="tab" [href]="nav.href(p)" (click)="nav.go($event, p)"
           [attr.aria-current]="nav.active() === p ? 'page' : null">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path [attr.d]="icons[p]" /></svg>
          <span>{{ 'hq.pages.' + p | translate }}</span>
        </a>
      }
    </nav>
  `,
  styles: [
    `
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
        background: color-mix(in srgb, var(--sc-bg-1) 92%, transparent);
        backdrop-filter: blur(10px);
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
      .tab svg { width: 20px; height: 20px; fill: none; stroke: currentColor; stroke-width: 1.7; stroke-linecap: round; stroke-linejoin: round; }
      .tab[aria-current='page'] { color: var(--sc-accent); background: color-mix(in srgb, var(--sc-accent) 12%, transparent); }
      .tab:focus-visible { outline: 2px solid var(--sc-accent); outline-offset: -2px; }
      @media (prefers-reduced-motion: reduce) { :host { transition: none; } }
    `,
  ],
})
export class HqPageBarComponent {
  protected readonly nav = inject(HqPageNavService);
  protected readonly icons = HQ_PAGE_ICONS;
  readonly hidden = signal(false);

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
      zone.runOutsideAngular(() => window.addEventListener('scroll', onScroll, { passive: true }));
      destroyRef.onDestroy(() => window.removeEventListener('scroll', onScroll));
    });
  }
}
