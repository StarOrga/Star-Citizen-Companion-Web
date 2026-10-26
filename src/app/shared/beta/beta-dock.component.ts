import { ChangeDetectionStrategy, Component, inject, input } from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';
import { BetaArea, BetaService } from '../../core/beta.service';

/**
 * The sticky β pill in the free bottom-left corner: ONE switch, for the nav
 * item the reader is in, between its new view and what it replaced. The shell
 * mounts it only on pages of an item that has a switch (`betaAreaOf`), so a
 * page where on and off look the same never offers it.
 */
@Component({
  selector: 'sc-beta-dock',
  standalone: true,
  imports: [TranslatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <aside class="beta-dock" [style.--lane]="lane()" [attr.aria-label]="'beta.aria' | translate">
      <div class="beta-pill">
        <span class="beta-mark" aria-hidden="true">β</span>
        <button type="button" role="switch" class="sw"
                [attr.aria-checked]="beta.state()[area()]"
                [disabled]="beta.locked()[area()]"
                [attr.aria-label]="'beta.switchFor' | translate:{ area: (('beta.area.' + area()) | translate) }"
                (click)="beta.toggle(area())">
          <span class="pill-label">{{ ('beta.area.' + area()) | translate }}</span>
          <span class="knob-track" aria-hidden="true"><span class="knob"></span></span>
        </button>
      </div>
    </aside>
  `,
  styles: [`
    :host { display: contents; }
    .beta-dock {
      position: fixed; z-index: 40;
      left: max(12px, env(safe-area-inset-left));
      /* --lane stacks a second pill above the first (the app-wide shell switch). */
      bottom: calc(var(--sc-beta-dock-bottom, var(--sc-float-bottom, 16px)) + var(--lane, 0) * (var(--sc-tap-min) + 16px));
      max-width: calc(100vw - var(--sc-fab-clear-inline, 88px) - 24px);
    }
    .beta-pill {
      display: flex; align-items: center; gap: 6px; padding: 4px 4px 4px 12px;
      background: color-mix(in srgb, var(--sc-bg-1) 92%, transparent);
      border: 1px solid var(--sc-border); border-radius: 999px;
      box-shadow: 0 6px 22px rgba(0, 0, 0, 0.35);
      backdrop-filter: blur(8px);
    }
    .beta-mark { font-family: var(--sc-font-display); color: var(--sc-accent); font-weight: 700; }
    .sw {
      display: inline-flex; align-items: center; gap: 8px; border: 0; background: none; color: inherit;
      font: inherit; cursor: pointer; min-height: var(--sc-tap-min); padding: 0 6px; border-radius: 999px;
    }
    .sw:disabled { opacity: 0.45; cursor: not-allowed; }
    .sw:focus-visible { outline: 2px solid var(--sc-accent); outline-offset: 2px; }
    .pill-label { font-size: max(0.82rem, var(--sc-fs-floor)); color: var(--sc-fg-2); }
    .knob-track {
      position: relative; width: 38px; height: 22px; border-radius: 999px;
      background: var(--sc-bg-2); border: 1px solid var(--sc-border);
      transition: background 0.16s;
    }
    .knob {
      position: absolute; top: 2px; left: 2px; width: 16px; height: 16px; border-radius: 50%;
      background: var(--sc-fg-2); transition: transform 0.16s, background 0.16s;
    }
    .sw[aria-checked='true'] .knob-track {
      background: color-mix(in srgb, var(--sc-accent) 35%, transparent); border-color: var(--sc-accent);
    }
    .sw[aria-checked='true'] .knob { transform: translateX(16px); background: var(--sc-accent); }
    @media (prefers-reduced-motion: reduce) {
      .knob, .knob-track { transition: none; }
    }
  `],
})
export class BetaDockComponent {
  protected readonly beta = inject(BetaService);

  readonly area = input.required<BetaArea>();
  /** 0 = the corner; 1 = one pill higher, for a second dock on the same page. */
  readonly lane = input(0);
}
