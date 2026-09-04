import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { TranslateModule } from '@ngx-translate/core';
import { FEEDBACK_COUNTER_WARN_AT, FEEDBACK_MAX_CHARS } from './feedback-limits';

/**
 * The live "1234 / 2000" readout that sits in the bottom-right corner INSIDE a
 * feedback input (admin feedback 0a0fad31: "welches dem nutzer im input feld
 * rechts unten halb transparente live angezeigt wird").
 *
 * Half-transparent and grey while there is room, so it is furniture rather than
 * a demand; it firms up into the warning colour over the last few hundred
 * characters and into `--sc-danger` once the cap is reached — which is also the
 * moment the send button goes away, so the colour is the explanation for it.
 *
 * Positioning lives on the host: every field that uses this makes its own
 * wrapper `position: relative` and reserves the bottom padding, so the counter
 * can never sit on top of the typed text. `aria-hidden`, because the field's own
 * `maxlength` is what assistive technology reads the limit from — a second
 * spoken number on every keystroke would be noise, not help.
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

  readonly atLimit = computed(() => this.used() >= this.max());
  readonly warn = computed(() => !this.atLimit() && this.max() - this.used() <= this.warnAt());

  readonly titleKey = computed(() =>
    this.atLimit() ? 'adminFeedback.compose.charLimit' : 'adminFeedback.compose.charCount',
  );

  readonly titleParams = computed(() => ({ used: this.used(), max: this.max() }));
}
