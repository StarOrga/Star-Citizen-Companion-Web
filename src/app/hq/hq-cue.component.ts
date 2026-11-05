import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';
import { HqPageNavService } from './hq-page-nav.service';
import { HqPageId } from './hq-routes';

/**
 * The page cue — the Verse page-transition cue ("Mehr im Verse": uppercase label, one drawn
 * chevron pointing down; `verse-briefing-planet.scss` `.more-cue` + the `chevron` mixin of
 * `_briefing-worlds.scss`), as a real anchor to the next HQ page (concept D5). No page numbers.
 * Positioned by its host (fixed at the viewport's bottom edge on every page but the last).
 */
@Component({
  selector: 'sc-hq-cue',
  standalone: true,
  imports: [TranslatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <a class="more-cue" [href]="href()" (click)="nav.go($event, target())"
       [attr.aria-label]="'hq.rail.goto' | translate: { page: ('hq.pages.' + target() | translate) }">
      {{ 'hq.pages.' + target() | translate }}<span class="chev d" aria-hidden="true"></span>
    </a>
  `,
  styles: [
    `
      :host { display: flex; justify-content: center; }
      /* It floats over page content, so it brings its own quiet ground. */
      .more-cue {
        --cs: max(9px, 0.7vw);
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 4px;
        min-height: 44px;
        padding: 6px 14px;
        pointer-events: auto;
        border-radius: 10px;
        background: color-mix(in srgb, var(--sc-bg-0) 72%, transparent);
        backdrop-filter: blur(6px);
        font: 500 max(11px, 0.66vw) / 1.3 var(--sc-font-body);
        letter-spacing: 0.24em;
        text-transform: uppercase;
        text-decoration: none;
        color: var(--sc-fg-1);
      }
      .chev {
        display: inline-block;
        flex: none;
        width: var(--cs, 9px);
        height: var(--cs, 9px);
        border-right: 1px solid currentColor;
        border-bottom: 1px solid currentColor;
        transition: color 0.2s, opacity 0.25s;
        transform: rotate(45deg);
      }
      .more-cue:hover .chev, .more-cue:focus-visible .chev { color: var(--sc-accent); }
      .more-cue:focus-visible { outline: 2px solid var(--sc-accent); outline-offset: 2px; border-radius: 6px; }
      @media (pointer: coarse) { .more-cue { min-height: 48px; } }
    `,
  ],
})
export class HqCueComponent {
  protected readonly nav = inject(HqPageNavService);
  /** The page the cue leads to (default: Planen, the page after Start). */
  readonly target = input<HqPageId>('planen');
  readonly href = computed(() => this.nav.href(this.target()));
}
