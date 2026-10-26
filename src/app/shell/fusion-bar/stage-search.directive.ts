import { DestroyRef, Directive, ElementRef, afterNextRender, inject } from '@angular/core';
import { BetaService } from '../../core/beta.service';
import { ShellChromeService } from './shell-chrome.service';

/**
 * Marks a cinematic hub's stage search line (the big search in the stage).
 * While it is on screen the Fusion bar leaves the search to it; once the line
 * has scrolled up under the bar, the bar plays its one-shot morph and carries
 * the search itself (spec §4: played once at a threshold, never scroll-scrubbed).
 *
 * Usage: `<div class="stage-search" scStageSearch>…</div>` — nothing else. With
 * the shell β off the directive does nothing.
 */
@Directive({ selector: '[scStageSearch]', standalone: true })
export class StageSearchDirective {
  constructor() {
    const el = inject(ElementRef<HTMLElement>).nativeElement as HTMLElement;
    const chrome = inject(ShellChromeService);
    const shellOn = inject(BetaService).isEnabled('shell');
    let io: IntersectionObserver | null = null;

    afterNextRender(() => {
      if (!shellOn() || typeof IntersectionObserver === 'undefined') return;
      chrome.setStageSearch('stage');
      // The line counts as "passed" once its bottom edge rose above the bar's
      // lower edge — the moment the two would overlap.
      const barH = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--sc-bar-h')) || 64;
      io = new IntersectionObserver(
        ([entry]) => {
          if (!entry) return;
          const above = entry.boundingClientRect.bottom <= barH + 8;
          chrome.setStageSearch(!entry.isIntersecting && above ? 'docked' : 'stage');
        },
        { rootMargin: `-${Math.round(barH + 8)}px 0px 0px 0px`, threshold: 0 },
      );
      io.observe(el);
    });

    inject(DestroyRef).onDestroy(() => {
      io?.disconnect();
      chrome.setStageSearch('none');
    });
  }
}
