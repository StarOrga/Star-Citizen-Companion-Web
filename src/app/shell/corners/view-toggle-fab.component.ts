import { DOCUMENT } from '@angular/common';
import { ChangeDetectionStrategy, Component, DestroyRef, computed, effect, inject } from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';
import { ScTooltipDirective } from '../../shared/tooltip/sc-tooltip.directive';
import { PageCornerService } from './page-corner.service';

/** Published on <html> while the FAB is drawn: the β FAB and the toasts stack one lane higher. */
export const VIEW_FAB_LANE_VAR = '--sc-view-fab-lane';

/**
 * Klassisch | Holotisch as one round toggle in the launcher's column: directly above the feedback
 * launcher, below the β FAB (concept codex-kopf-besitz, round 2 pin). Drawn only while a Codex detail page
 * registered its switch (`PageCornerService.setView`); a click is exactly the page's old segment
 * click, so the `?view=` URL behaviour does not change. The label and tooltip name the view the
 * click leads to; the icon shows it.
 */
@Component({
  selector: 'sc-view-toggle-fab',
  standalone: true,
  imports: [TranslatePipe, ScTooltipDirective],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (view(); as v) {
      <div class="wrap">
        <button type="button" class="fab" [attr.data-view]="v.holo() ? 'holo' : 'classic'"
                [attr.aria-label]="label() | translate" [scTooltip]="label() | translate" scTooltipTier="label"
                (click)="v.toggle()">
          @if (v.holo()) {
            <!-- Next: Klassisch - columns of cards. -->
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 5h7v14H4zM14 5h6v6h-6zM14 14h6v5h-6z" /></svg>
          } @else {
            <!-- Next: Holotisch - the ship on its table. -->
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 4l7 4-7 4-7-4 7-4zM5 8v6l7 4 7-4V8M3 20h18" /></svg>
          }
        </button>
      </div>
    }
  `,
  styles: [`
    :host { display: contents; }
    /* The launcher's column: one lane above the launcher (where the β FAB stood), the β FAB moves
       up by --sc-view-fab-lane. Phone: the β FAB's phone slot, above the share lane. */
    .wrap {
      --_d: max(44px, var(--sc-tap-min, 44px));
      position: fixed; z-index: 155;
      inset-inline-end: calc(max(var(--sc-fab-inset, 24px), env(safe-area-inset-right, 0px)) + (var(--sc-fab-size, 56px) - var(--_d)) / 2);
      bottom: var(--sc-fab-clear-block, 96px);
    }
    @media (max-width: 720px) {
      .wrap { bottom: var(--sc-beta-fab-bottom, var(--sc-fab-clear-block, 96px)); }
    }
    /* A large popup (scPopupMotion="large", html.sc-scene-pushin) covers the page: the page's own
       view switch does not float over it (it stood on the swap picker on phones). */
    :host-context(html.sc-scene-pushin) .wrap { visibility: hidden; }
    .fab {
      display: inline-grid; place-items: center; width: var(--_d); height: var(--_d);
      border-radius: 50%; padding: 0; cursor: pointer;
      border: 1px solid var(--sc-border); background: var(--sc-bg-1); color: var(--sc-accent);
      box-shadow: 0 6px 20px rgba(0, 0, 0, 0.4);
    }
    .fab:hover { background: color-mix(in srgb, var(--sc-accent) 14%, var(--sc-bg-1)); border-color: var(--sc-accent); }
    .fab:focus-visible { outline: 2px solid var(--sc-accent); outline-offset: 2px; }
    svg { width: 20px; height: 20px; fill: none; stroke: currentColor; stroke-width: 1.7; stroke-linecap: round; stroke-linejoin: round; }
  `],
})
export class ViewToggleFabComponent {
  private readonly corner = inject(PageCornerService);
  protected readonly view = this.corner.view;
  protected readonly label = computed(() => (this.view()?.holo() ? 'corner.view.toClassic' : 'corner.view.toHolo'));

  constructor() {
    const root = inject(DOCUMENT).documentElement;
    effect(() => {
      if (this.view()) root.style.setProperty(VIEW_FAB_LANE_VAR, 'var(--sc-beta-fab-lane)');
      else root.style.removeProperty(VIEW_FAB_LANE_VAR);
    });
    inject(DestroyRef).onDestroy(() => root.style.removeProperty(VIEW_FAB_LANE_VAR));
  }
}
