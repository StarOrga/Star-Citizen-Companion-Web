import { Directive, ElementRef, OnDestroy, computed, inject, input } from '@angular/core';
import { FeedbackSpotLabel, FeedbackSpotService } from './feedback-spot.service';

/**
 * Marks a page section as something a feedback writer can point at (feedback
 * #243). Purely declarative: it adds no DOM and no styles to the host — the
 * buttons are drawn by `<sc-feedback-spots>` in the shell, outside the page's
 * own layout, overflow and stacking contexts, and only while a feedback panel
 * is open.
 *
 *   <section [scFeedbackSpot]="'codex.detail.columnLoadout'">
 *   <details [scFeedbackSpot]="'codex.detail.columnLoadout'"
 *            [scFeedbackSpotSub]="'codex.moduleSection.weapons'">
 *   <h1 [scFeedbackSpot]="'feedbackSpot.headline'" [scFeedbackSpotText]="title">
 */
@Directive({
  selector: '[scFeedbackSpot]',
  standalone: true,
})
export class FeedbackSpotDirective implements OnDestroy {
  /** i18n key naming the section. */
  readonly scFeedbackSpot = input.required<string>();
  /** Optional i18n key appended to it (a loadout group under "Loadout"). */
  readonly scFeedbackSpotSub = input<string | null | undefined>(null);
  /** Optional raw text quoted behind it (a page title). */
  readonly scFeedbackSpotText = input<string | null | undefined>(null);

  private readonly unregister = inject(FeedbackSpotService).register({
    el: inject<ElementRef<HTMLElement>>(ElementRef).nativeElement,
    label: computed<FeedbackSpotLabel>(() => ({
      key: this.scFeedbackSpot(),
      subKey: this.scFeedbackSpotSub() || null,
      text: this.scFeedbackSpotText()?.trim() || null,
    })),
  });

  ngOnDestroy(): void {
    this.unregister();
  }
}
