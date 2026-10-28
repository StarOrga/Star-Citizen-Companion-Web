import { DestroyRef, Directive, ElementRef, inject } from '@angular/core';
import { BetaService } from '../../core/beta.service';
import { ShellChromeService } from './shell-chrome.service';

/**
 * Marks the stage slot of a main page: the place the bar's search field stands
 * on while the page is at its top ("Gleiche Leiste", concept 2026-10-28 round 6–8).
 * Every main page (Verse, Codex, HQ, admin hub) renders it directly under its
 * hero (eyebrow + title), so the field stands below the title as in the concept.
 * The slot is an empty, sized placeholder — the field itself is the bar's own,
 * so docking moves and widens the very same element into the subheader.
 *
 * Usage: `<div scStageSearch></div>`. The size comes from the global
 * `[data-stage-slot]` rule (styles.scss); the attribute is only set while the
 * beta shell is on, so with the β off the slot is an empty, zero-height div.
 */
@Directive({
  selector: '[scStageSearch]',
  standalone: true,
  host: { '[attr.data-stage-slot]': "on() ? '' : null", 'aria-hidden': 'true' },
})
export class StageSearchDirective {
  readonly on = inject(BetaService).isEnabled('shell');

  constructor() {
    const el = inject(ElementRef<HTMLElement>).nativeElement as HTMLElement;
    const off = inject(ShellChromeService).registerStageAnchor(el);
    inject(DestroyRef).onDestroy(off);
  }
}
