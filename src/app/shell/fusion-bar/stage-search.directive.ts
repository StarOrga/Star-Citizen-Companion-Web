import { DestroyRef, Directive, ElementRef, inject } from '@angular/core';
import { ShellChromeService } from './shell-chrome.service';

/**
 * Marks the stage slot of a main page: the place the bar's search field stands
 * on while the page is at its top ("Gleiche Leiste", concept 2026-10-28 round 6–8).
 * The slot is an empty, sized placeholder — the field itself is the bar's own,
 * so docking moves and widens the very same element into the subheader.
 *
 * Usage: `<div class="stage-slot" scStageSearch></div>`. Only the beta shell's
 * bar reads it; with the β off nothing consumes the registration.
 */
@Directive({ selector: '[scStageSearch]', standalone: true, host: { 'data-stage-slot': '' } })
export class StageSearchDirective {
  constructor() {
    const el = inject(ElementRef<HTMLElement>).nativeElement as HTMLElement;
    const off = inject(ShellChromeService).registerStageAnchor(el);
    inject(DestroyRef).onDestroy(off);
  }
}
