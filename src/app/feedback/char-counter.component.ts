import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { TranslateModule } from '@ngx-translate/core';
import { FEEDBACK_COUNTER_WARN_AT, FEEDBACK_MAX_CHARS } from './feedback-limits';

/**
 * Where the readout sits relative to the field it belongs to.
 *
 * `inside` — the original placement (admin feedback 0a0fad31): absolutely
 * positioned in the field's bottom-right corner, on a padding lane the field
 * reserves for it. Fine for a fixed-height box.
 *
 * `below` — a row of its own under the field (admin feedback d08f1983: "die
 * buchstabenanzahl [sollte] immer sichtbar sein, aber darunter und nicht
 * abgeschnitten"). A field that grows with its content has no stable inside
 * corner to pin to, and an overlay inside a scrolling box is the thing that
 * gets clipped — in normal flow it cannot be.
 */
export type CharCounterPlacement = 'inside' | 'below';

/**
 * The live "1234 / 2000" readout for a feedback input.
 *
 * Quiet and grey while there is room, so it is furniture rather than a demand;
 * it firms up into the warning colour over the last few hundred characters and
 * into `--sc-danger` once the cap is reached — which is also the moment the send
 * button goes away, so the colour is the explanation for it.
 *
 * `aria-hidden`, because the field's own `maxlength` is what assistive
 * technology reads the limit from — a second spoken number on every keystroke
 * would be noise, not help.
 */
@Component({
  selector: 'sc-char-counter',
  standalone: true,
  imports: [TranslateModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    'aria-hidden': 'true',
    '[class.warn]': 'warn()',
    '[class.over]': 'atLimit()',
    '[class.below]': "placement() === 'below'",
  },
  template: `<span [title]="titleKey() | translate: titleParams()">{{ used() }} / {{ max() }}</span>`,
  styles: [`
    :host {
      position: absolute;
      right: 18px; /* clear of the textarea's own resize grip */
      bottom: 6px;
      pointer-events: none;
      font-size: max(0.68rem, var(--sc-fs-floor));
      font-variant-numeric: tabular-nums;
      letter-spacing: 0.03em;
      line-height: 1;
      color: var(--sc-fg-2);
      opacity: 0.45;
      transition: opacity 0.16s ease, color 0.16s ease;
    }
    /* In flow, on its own line under the field, aligned with the field's right
       edge. Nothing above it can clip it and nothing below it can cover it, so
       it is readable at all times instead of being a half-transparent overlay
       competing with the last typed line. */
    :host(.below) {
      position: static;
      align-self: flex-end;
      opacity: 0.75;
    }
    :host(.warn) { opacity: 0.8; color: var(--sc-warning); }
    :host(.over) { opacity: 1; color: var(--sc-danger); font-weight: 600; }
    span { pointer-events: auto; }
  `],
})
export class CharCounterComponent {
  /** Characters currently in the field. */
  readonly used = input(0);
  /** The cap this field enforces — the shared one unless a caller says otherwise. */
  readonly max = input(FEEDBACK_MAX_CHARS);
  /** How many characters before the cap the readout starts warning. */
  readonly warnAt = input(FEEDBACK_COUNTER_WARN_AT);
  /** Overlay inside the field, or a line of its own under it. */
  readonly placement = input<CharCounterPlacement>('inside');

  readonly atLimit = computed(() => this.used() >= this.max());
  readonly warn = computed(() => !this.atLimit() && this.max() - this.used() <= this.warnAt());

  readonly titleKey = computed(() =>
    this.atLimit() ? 'adminFeedback.compose.charLimit' : 'adminFeedback.compose.charCount',
  );

  readonly titleParams = computed(() => ({ used: this.used(), max: this.max() }));
}
