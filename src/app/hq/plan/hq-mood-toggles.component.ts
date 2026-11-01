import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';
import { MOOD_IDS, MOOD_PAIRS, MoodPair, MoodSide, MoodState } from './hq-moods';

/**
 * The three mood pairs of Planen (D25): Friedlich ↔ Kampf · Schnell ↔ Zeitintensiv · Solo ↔ Gruppe.
 * Each pair is one 3-way switch (off · left · right): a click on a side turns it on, a click on the
 * active side turns the pair off again. The host owns the model (`moodChange`).
 */
@Component({
  selector: 'sc-hq-mood-toggles',
  standalone: true,
  imports: [TranslatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @for (pair of pairs; track pair) {
      <div class="pair" role="group"
           [attr.aria-label]="'hq.mood.pairAria' | translate: { left: ('hq.mood.' + ids[pair][0] | translate), right: ('hq.mood.' + ids[pair][1] | translate) }"
           [attr.data-on]="moods()[pair] ?? 'off'">
        <button type="button" class="side left" [attr.aria-pressed]="moods()[pair] === 'left'"
                (click)="moodChange.emit({ pair, side: 'left' })">{{ 'hq.mood.' + ids[pair][0] | translate }}</button>
        <button type="button" class="side right" [attr.aria-pressed]="moods()[pair] === 'right'"
                (click)="moodChange.emit({ pair, side: 'right' })">{{ 'hq.mood.' + ids[pair][1] | translate }}</button>
      </div>
    }
  `,
  styles: [
    `
      :host { display: flex; flex-wrap: wrap; gap: var(--sc-space-3, 12px); }
      .pair {
        display: inline-flex;
        padding: 3px;
        border: 1px solid var(--sc-border);
        border-radius: 999px;
        background: var(--sc-bg-0);
      }
      .side {
        min-height: 36px;
        padding: 0 var(--sc-space-3, 12px);
        border: 0;
        border-radius: 999px;
        background: transparent;
        color: var(--sc-fg-2);
        font: inherit;
        cursor: pointer;
        transition: color 0.15s ease, background-color 0.15s ease, box-shadow 0.15s ease;
      }
      .side:hover { color: var(--sc-fg); }
      .side[aria-pressed='true'] {
        color: var(--sc-fg);
        background: color-mix(in srgb, var(--sc-accent) 22%, transparent);
        box-shadow: 0 0 0 1px var(--sc-accent), 0 0 12px color-mix(in srgb, var(--sc-accent) 40%, transparent);
      }
      .side:focus-visible { outline: 2px solid var(--sc-accent); outline-offset: 2px; }
      @media (pointer: coarse) { .side { min-height: 48px; } }
      @media (prefers-reduced-motion: reduce) { .side { transition: none; } }
    `,
  ],
})
export class HqMoodTogglesComponent {
  readonly moods = input.required<MoodState>();
  readonly moodChange = output<{ pair: MoodPair; side: MoodSide }>();
  protected readonly pairs = MOOD_PAIRS;
  protected readonly ids = MOOD_IDS;
}
