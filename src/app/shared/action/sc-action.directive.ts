import { Directive, ElementRef, Renderer2, effect, inject, input, booleanAttribute } from '@angular/core';
import { ScTooltipDirective } from '../tooltip/sc-tooltip.directive';
import { logWarn } from '../../core/log';

export type ScActionTier = 'primary' | 'secondary' | 'tertiary';
export type ScActionTone = 'default' | 'hot' | 'danger';

/**
 * The one action control (concept gegenstand-weg, round 2 `baustein`).
 * Sits on the native element, so a navigation stays a real anchor:
 *
 *   <button scAction tier="primary" type="button"><svg class="sc-action-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="..."/></svg><span>{{ 'x' | translate }}</span></button>
 *   <a scAction tier="secondary" [routerLink]="...">...</a>
 *   <button scAction tier="tertiary" tone="danger" [scTooltip]="l" scTooltipTier="label" [attr.aria-label]="l">icon</button>
 *
 * Icon slot: a child `svg.sc-action-icon` (24-unit viewBox, stroke style of
 * `shell/fusion-bar/search-icons.ts`). Busy: `[busy]="true"` adds a ring,
 * `aria-busy` and blocks clicks; `done` is the class `is-done` set by the
 * caller for the confirmation moment. Everything visual lives in the marked
 * block "ACTION (scAction)" in styles.scss.
 */
@Directive({
  selector: 'a[scAction], button[scAction]',
  host: {
    class: 'sc-action',
    '[class.sc-action--primary]': "tier() === 'primary'",
    '[class.sc-action--secondary]': "tier() === 'secondary'",
    '[class.sc-action--tertiary]': "tier() === 'tertiary'",
    '[class.sc-action--hot]': "tone() === 'hot'",
    '[class.sc-action--danger]': "tone() === 'danger'",
    '[class.is-busy]': 'busy()',
    '[attr.aria-busy]': 'busy() ? "true" : null',
  },
})
export class ScActionDirective {
  readonly tier = input<ScActionTier>('secondary');
  readonly tone = input<ScActionTone>('default');
  readonly busy = input(false, { transform: booleanAttribute });

  private readonly el = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly renderer = inject(Renderer2);
  private readonly tooltip = inject(ScTooltipDirective, { self: true, optional: true });
  private ring: HTMLElement | null = null;

  constructor() {
    // Capture phase, so it wins over (click) handlers the template put on the same element.
    this.el.nativeElement.addEventListener('click', (ev) => this.onClick(ev), true);
    effect(() => {
      const host = this.el.nativeElement;
      if (this.busy()) {
        if (!this.ring) {
          this.ring = this.renderer.createElement('i');
          this.renderer.addClass(this.ring, 'sc-action-ring');
          this.renderer.setAttribute(this.ring, 'aria-hidden', 'true');
          this.renderer.insertBefore(host, this.ring, host.firstChild);
        }
      } else if (this.ring) {
        this.renderer.removeChild(host, this.ring);
        this.ring = null;
      }
    });
    effect(() => {
      if (this.tier() !== 'tertiary') return;
      const host = this.el.nativeElement;
      const named = !!this.tooltip?.scTooltip() || host.hasAttribute('aria-label') || host.hasAttribute('aria-labelledby');
      if (!named || !this.tooltip) {
        logWarn('scAction', 'tertiary action needs an accessible name and [scTooltip]', host.outerHTML.slice(0, 80));
      }
    });
  }

  private onClick(ev: Event): void {
    if (this.busy()) {
      ev.preventDefault();
      ev.stopImmediatePropagation();
    }
  }
}
