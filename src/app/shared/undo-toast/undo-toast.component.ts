import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { ToastSlotDirective } from '../toast-stack/toast-stack';
import { TranslatePipe } from '@ngx-translate/core';
import { UndoToastService } from './undo-toast.service';

/**
 * The undo toast for {@link UndoToastService}: one card bottom-right, above the
 * feedback launcher (same lane as the star toast), with the action in words, an
 * "Undo" button and a draining bar for the window. Hover or focus holds the
 * window. Hosted once by the shell, outside the routed page's stacking context;
 * the window keeps running across navigation and commits when it closes.
 */
@Component({
  selector: 'sc-undo-toast',
  standalone: true,
  imports: [ToastSlotDirective, TranslatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @for (p of shown(); track p.id) {
      <div class="toast" scToastSlot role="status" aria-live="polite" [class.paused]="svc.held()"
           (mouseenter)="svc.hold('hover', true)" (mouseleave)="svc.hold('hover', false)"
           (focusin)="svc.hold('focus', true)" (focusout)="svc.hold('focus', false)">
        <span class="msg">{{ p.messageKey | translate: p.messageParams }}</span>
        <button type="button" class="undo" (click)="svc.undo()">{{ 'common.undo' | translate }}</button>
        <i class="drain" aria-hidden="true" [style.animation-duration.ms]="svc.duration"></i>
      </div>
    }
  `,
  styles: [`
    :host { display: contents; }
    .toast {
      position: fixed; z-index: 1450;
      inset-inline-end: var(--sc-fab-gutter, 16px);
      bottom: calc(var(--sc-toast-bottom, var(--sc-fab-clear-block, 80px)) + var(--sc-toast-offset, 0px));
      width: min(var(--sc-toast-w, 24rem), calc(100vw - 2 * var(--sc-fab-gutter, 16px)));
      display: flex; align-items: center; gap: 12px;
      padding: 10px 10px 12px 16px; border-radius: 14px; overflow: hidden;
      background: color-mix(in srgb, var(--sc-bg-1) 94%, transparent);
      border: 1px solid color-mix(in srgb, var(--sc-accent) 45%, var(--sc-border));
      box-shadow: 0 18px 44px rgba(0, 0, 0, 0.55), 0 0 30px color-mix(in srgb, var(--sc-accent) 14%, transparent);
      backdrop-filter: blur(10px);
      animation: toast-in 0.28s ease-out both;
    }
    .msg { flex: 1; min-width: 0; font-size: 0.9rem; color: var(--sc-fg-0); }
    .undo {
      flex: none; height: 36px; padding: 0 16px; border-radius: 999px; cursor: pointer;
      font: 600 max(0.8rem, var(--sc-fs-floor)) var(--sc-font-display); letter-spacing: 0.12em; text-transform: uppercase;
      background: none; color: var(--sc-accent);
      border: 1px solid color-mix(in srgb, var(--sc-accent) 55%, transparent);
      transition: background 0.15s, color 0.15s;
    }
    .undo:hover { background: color-mix(in srgb, var(--sc-accent) 16%, transparent); color: var(--sc-fg-0); }
    .undo:focus-visible { outline: 2px solid var(--sc-accent); outline-offset: 2px; }
    @media (pointer: coarse) { .undo { height: 48px; } }
    .drain {
      position: absolute; inset: auto 0 0 0; height: 2px; background: var(--sc-accent); transform-origin: left center;
      animation: toast-drain linear forwards;
    }
    .toast.paused .drain { animation-play-state: paused; }
    @keyframes toast-in { from { opacity: 0; transform: translateY(14px); } to { opacity: 1; transform: none; } }
    @keyframes toast-drain { from { transform: scaleX(1); } to { transform: scaleX(0); } }
    @media (prefers-reduced-motion: reduce) {
      .toast { animation: toast-fade 0.2s linear both; }
      .undo { transition: none; }
      @keyframes toast-fade { from { opacity: 0; } to { opacity: 1; } }
    }
  `],
})
export class UndoToastComponent {
  protected readonly svc = inject(UndoToastService);
  /** One-element list so each offer gets a fresh DOM node (restarts the drain). */
  protected readonly shown = computed(() => {
    const c = this.svc.current();
    return c ? [c] : [];
  });
}
