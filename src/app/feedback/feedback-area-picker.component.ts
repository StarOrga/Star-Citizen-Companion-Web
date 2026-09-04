import {
  ChangeDetectionStrategy,
  Component,
  effect,
  inject,
  model,
  signal,
  untracked,
} from '@angular/core';
import { TranslateModule } from '@ngx-translate/core';
import { FeedbackAreaService } from './feedback-area.service';
import { FeedbackArea, feedbackAreaLabelKey } from './feedback-area.types';

/**
 * The "what is this about?" chip row above a new-topic composer (admin feedback
 * 835fec58).
 *
 * The whole design rests on one sentence from the request — *"dass du weißt,
 * worauf man sich bezieht"*: the area is **already picked** when the row
 * appears, taken from the page the sender is on. Nothing is required of them;
 * the chips exist so a wrong guess can be corrected in one click (writing
 * about the Codex while sitting in the settings is normal).
 *
 * Two consequences that are easy to get wrong and are therefore explicit here:
 *
 * - The pre-selection KEEPS FOLLOWING the router while the sender has not
 *   chosen. The feedback panels stay mounted across navigations, so someone can
 *   open the FAB on /news, browse to /codex and start typing there — the tag has
 *   to be Codex, not News.
 * - Once they click a chip, the router stops overriding it (`touched`). Anything
 *   else would silently undo a deliberate choice on the next navigation.
 *
 * The component is a plain `model()` on the area value, so the composer owns the
 * state and clearing it to `null` after a successful send re-arms the
 * auto-detection for the next topic.
 *
 * Colour: normal `--sc-accent` in both hosts. The red `--sc-accent-hot` marks
 * surfaces only an elevated account may reach; this row renders in the ordinary
 * user's composer too, and the `admin` chip itself is filtered out for them
 * (see `FeedbackAreaService.options`).
 */
@Component({
  selector: 'sc-feedback-area-picker',
  standalone: true,
  imports: [TranslateModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="area-row" role="group" [attr.aria-label]="'feedbackArea.aria' | translate">
      <span class="area-label">{{ 'feedbackArea.label' | translate }}</span>
      @for (a of areas.options(); track a) {
        <button
          type="button"
          class="chip"
          [class.active]="area() === a"
          [attr.aria-pressed]="area() === a"
          (click)="pick(a)">
          {{ labelKey(a) | translate }}
        </button>
      }
    </div>
  `,
  styles: [`
    :host { display: block; }
    .area-row {
      display: flex;
      align-items: center;
      gap: 5px;
      flex-wrap: wrap;
    }
    .area-label {
      font-size: max(0.72rem, var(--sc-fs-floor));
      color: var(--sc-fg-2);
      margin-right: 2px;
    }
    .chip {
      padding: 2px 9px;
      border: 1px solid var(--sc-border);
      border-radius: 999px;
      background: var(--sc-bg-1);
      color: var(--sc-fg-2);
      font: inherit;
      font-size: max(0.72rem, var(--sc-fs-floor));
      line-height: 1.5;
      cursor: pointer;
      transition: all 0.16s ease;
    }
    .chip:hover { color: var(--sc-fg-0); border-color: var(--sc-accent); }
    .chip:focus-visible {
      outline: none;
      border-color: var(--sc-accent);
      box-shadow: 0 0 0 2px rgba(0, 212, 255, 0.35);
    }
    .chip.active {
      border-color: var(--sc-accent);
      color: var(--sc-accent);
      background: rgba(0, 212, 255, 0.1);
    }
  `],
})
export class FeedbackAreaPickerComponent {
  readonly areas = inject(FeedbackAreaService);

  /** The tag that travels with the topic. `null` = "not decided yet, follow the route". */
  readonly area = model<FeedbackArea | null>(null);

  /** The sender clicked a chip — the router may no longer overrule the value. */
  private readonly touched = signal(false);

  constructor() {
    effect(() => {
      const detected = this.areas.current();
      const current = this.area();
      untracked(() => {
        // Reset to null (a fresh composer, or the clear after a send) re-arms
        // the detection instead of leaving the row blank.
        if (current === null) {
          this.touched.set(false);
          this.area.set(detected);
          return;
        }
        if (!this.touched() && current !== detected) this.area.set(detected);
      });
    });
  }

  labelKey(area: FeedbackArea): string {
    return feedbackAreaLabelKey(area);
  }

  pick(area: FeedbackArea): void {
    this.touched.set(true);
    this.area.set(area);
  }
}
