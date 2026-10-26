import { ChangeDetectionStrategy, Component, inject, input } from '@angular/core';
import { BetaService } from '../core/beta.service';

/**
 * Cinematic backdrop for the small auth cards (set-password, access-unavailable,
 * uploader / desktop auth, desktop connect) - shell beta, implement.md §12:
 * "cinematic but simple, focused". The routed pages sit in the `cinematic`
 * layout (frame track `full`, no gutter), so the card's inner wrapper insets
 * itself onto the `wide` / `narrow` track here instead of relying on a frame
 * gutter. The utilities `.sc-track-*` only match DIRECT children of `.sc-frame`,
 * so the wrapper reproduces the same widths from the frame's own variables.
 *
 * Beta off: `display: contents` on the host and the wrapper - the projected page
 * renders exactly as before. The page's behaviour never depends on this shell.
 */
@Component({
  selector: 'sc-auth-stage',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '[class.on]': 'shell()', '[attr.data-track]': 'track()' },
  template: `<div class="track"><ng-content /></div>`,
  styles: [
    `
      :host, .track { display: contents; }
      :host(.on) {
        position: relative;
        isolation: isolate;
        display: grid;
        place-items: center;
        min-height: calc(100dvh - var(--sc-bar-h, 64px) - var(--sc-footer-h, 56px));
        padding-block: var(--sc-space-6, 32px);
        overflow: clip;
      }
      :host(.on) .track {
        display: block;
        width: var(--_n, min(clamp(720px, 60%, 1040px), 100% - 2 * var(--sc-wide-gutter, 24px)));
        max-width: 100%;
      }
      :host(.on[data-track='wide']) .track { width: calc(100% - 2 * var(--sc-wide-gutter, 24px)); }
      :host(.on)::before, :host(.on)::after { content: ''; position: absolute; inset: 0; z-index: -1; pointer-events: none; }
      :host(.on)::before {
        background:
          radial-gradient(ellipse 50% 40% at 30% 30%, color-mix(in srgb, var(--sc-accent) 12%, transparent), transparent 70%),
          radial-gradient(ellipse 60% 40% at 50% 100%, color-mix(in srgb, var(--sc-accent) 9%, transparent), transparent 70%);
      }
      :host(.on)::after {
        opacity: 0.45;
        background-image:
          radial-gradient(1px 1px at 12% 18%, var(--sc-fg-0), transparent), radial-gradient(1px 1px at 34% 62%, var(--sc-fg-0), transparent),
          radial-gradient(1px 1px at 58% 12%, var(--sc-fg-0), transparent), radial-gradient(1px 1px at 78% 72%, var(--sc-fg-0), transparent),
          radial-gradient(1px 1px at 88% 28%, var(--sc-fg-0), transparent), radial-gradient(1px 1px at 22% 84%, var(--sc-fg-0), transparent);
        background-size: 280px 240px;
      }
      @media (prefers-reduced-motion: no-preference) {
        :host(.on)::after { animation: auth-drift 90s linear infinite; }
        :host(.on) ::slotted(*) { animation: auth-in 0.45s ease-out both; }
      }
      @keyframes auth-drift { to { background-position: 280px 240px; } }
      @keyframes auth-in { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: none; } }
    `,
  ],
})
export class AuthStageComponent {
  protected readonly shell = inject(BetaService).isEnabled('shell');
  /** Which frame track the card's wrapper insets onto. */
  readonly track = input<'narrow' | 'wide'>('narrow');
}
