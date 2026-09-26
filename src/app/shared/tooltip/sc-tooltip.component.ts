import { ChangeDetectionStrategy, Component, input } from '@angular/core';

/**
 * The floating bubble portaled by `ScTooltipDirective` through CDK's
 * `Overlay`. Visual contract lifted from the set page's former CSS-only
 * share tooltip, the app's first styled one: `--sc-bg-0` surface, 1px
 * `--sc-border`, 4px radius, `5px 9px` padding, a font-size floor via
 * `max()`, a 120ms fade.
 * Kept as its own component (rather than inline in the directive) so the
 * directive only ever has to manage an `OverlayRef` + `ComponentRef`, never
 * template wiring.
 */
@Component({
  selector: 'sc-tooltip-bubble',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="sc-tooltip-bubble" role="tooltip" [attr.id]="tooltipId() || null">{{ text() }}</div>
  `,
  styles: [
    `
      :host {
        display: block;
        pointer-events: auto;
      }
      .sc-tooltip-bubble {
        background: var(--sc-bg-0);
        border: 1px solid var(--sc-border);
        color: var(--sc-fg-1);
        border-radius: 4px;
        padding: 5px 9px;
        font-size: max(0.72rem, var(--sc-fs-floor, 0.7rem));
        max-width: min(280px, 90vw);
        white-space: normal;
        line-height: 1.35;
        box-shadow: 0 6px 18px rgb(0 0 0 / 40%);
        opacity: 0;
        animation: sc-tooltip-fade-in 0.12s ease forwards;
      }
      @keyframes sc-tooltip-fade-in {
        from {
          opacity: 0;
        }
        to {
          opacity: 1;
        }
      }
      @media (prefers-reduced-motion: reduce) {
        .sc-tooltip-bubble {
          animation: none;
          opacity: 1;
        }
      }
    `,
  ],
})
export class ScTooltipComponent {
  readonly text = input('');
  readonly tooltipId = input('');
}
