import { ChangeDetectionStrategy, Component, DestroyRef, effect, inject, signal } from '@angular/core';
import { TranslateService } from '@ngx-translate/core';
import { RoleService } from '../auth/role.service';
import { FeedbackAreaService } from './feedback-area.service';
import { captureLine, isCaptureClick, meaningfulElement, nameOf, roleOf, spotFor } from './feedback-capture.util';
import { FeedbackPeekService } from './feedback-peek.service';
import { FeedbackSpotService } from './feedback-spot.service';

/** How long the captured element stays outlined, ms. */
export const CAPTURE_FLASH_MS = 1100;

/**
 * Admin click capture (feedback #243): Alt+click — or Ctrl+click outside
 * links and fields — anywhere on the page cancels the click, describes the
 * element ("<area> › Button „Name“") and puts that as the first line of the
 * feedback draft, opening the panel if it is shut. Nothing is armed for
 * anybody who is not an admin.
 *
 * Mounted once in the shell. The listeners sit on the document in the capture
 * phase so they run before the page's own handlers and routerLinks; the
 * outline is a fixed overlay (not a style on the page's element), so no
 * overflow or stacking context of the page can clip it.
 */
@Component({
  selector: 'sc-feedback-capture',
  standalone: true,
  host: { 'data-sc-capture-hide': '', 'aria-hidden': 'true' },
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (box(); as b) {
      <div class="flash" [style.top.px]="b.top" [style.left.px]="b.left" [style.width.px]="b.width" [style.height.px]="b.height"></div>
    }
  `,
  styles: [`
    :host { display: contents; }
    .flash {
      position: fixed;
      z-index: 1000;
      pointer-events: none;
      box-sizing: border-box;
      border: 2px solid var(--sc-accent-hot);
      border-radius: 6px;
      background: color-mix(in srgb, var(--sc-accent-hot) 14%, transparent);
      box-shadow: 0 0 0 3px color-mix(in srgb, var(--sc-accent-hot) 30%, transparent);
      animation: flash-out 1.1s ease-out forwards;
    }
    @keyframes flash-out {
      0%, 55% { opacity: 1; }
      100% { opacity: 0; }
    }
    @media (prefers-reduced-motion: reduce) {
      .flash { animation: none; }
    }
  `],
})
export class FeedbackCaptureComponent {
  private readonly roles = inject(RoleService);
  private readonly spots = inject(FeedbackSpotService);
  private readonly peek = inject(FeedbackPeekService);
  private readonly area = inject(FeedbackAreaService);
  private readonly translate = inject(TranslateService);
  private readonly destroyRef = inject(DestroyRef);

  readonly box = signal<{ top: number; left: number; width: number; height: number } | null>(null);
  private timer: ReturnType<typeof setTimeout> | undefined;

  constructor() {
    effect((onCleanup) => {
      if (!this.roles.isAdmin() || typeof document === 'undefined') return;
      this.spots.captureActive.set(true);
      const onClick = (ev: MouseEvent) => this.onClick(ev);
      // Alt+mousedown would start a text selection / focus change on the way.
      const onDown = (ev: MouseEvent) => {
        if (isCaptureClick(ev, this.targetOf(ev))) ev.preventDefault();
      };
      document.addEventListener('click', onClick, true);
      document.addEventListener('mousedown', onDown, true);
      const stopPeek = this.peek.listen();
      onCleanup(() => {
        document.removeEventListener('click', onClick, true);
        document.removeEventListener('mousedown', onDown, true);
        stopPeek();
        this.spots.captureActive.set(false);
      });
    });
    this.destroyRef.onDestroy(() => clearTimeout(this.timer));
  }

  private targetOf(ev: Event): Element | null {
    return ev.target instanceof Element ? ev.target : null;
  }

  private onClick(ev: MouseEvent): void {
    const target = this.targetOf(ev);
    if (!target || !isCaptureClick(ev, target)) return;
    ev.preventDefault();
    ev.stopImmediatePropagation();
    const el = meaningfulElement(target);
    const spot = spotFor(this.spots.spots(), target);
    const line = captureLine(
      spot?.label() ?? null,
      this.area.currentView(),
      typeof location === 'undefined' ? '' : location.pathname,
      { role: roleOf(el), name: nameOf(el) },
      (key, params) => this.translate.instant(key, params),
    );
    this.spots.insert(line);
    this.flash(el);
  }

  private flash(el: Element): void {
    const r = el.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0) return;
    this.box.set({ top: r.top - 2, left: r.left - 2, width: r.width + 4, height: r.height + 4 });
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.box.set(null), CAPTURE_FLASH_MS);
  }
}
