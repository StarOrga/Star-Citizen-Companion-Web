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
  styleUrl: './auth-stage.component.scss',
})
export class AuthStageComponent {
  protected readonly shell = inject(BetaService).isEnabled('shell');
  /** Which frame track the card's wrapper insets onto. */
  readonly track = input<'narrow' | 'wide'>('narrow');
}
