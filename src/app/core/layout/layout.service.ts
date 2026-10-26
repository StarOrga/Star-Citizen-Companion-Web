import { Injectable, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router } from '@angular/router';
import { LAYOUT_TRACK, PageLayout, PageTrack, layoutOfSnapshot } from './page-layout';

/**
 * THE layout contract: the page type of the active route (`data.layout`),
 * as a signal. The shell (beta `shell`) and everything in the bar / footer
 * reads it instead of matching URL strings.
 */
@Injectable({ providedIn: 'root' })
export class LayoutService {
  private readonly router = inject(Router);
  private readonly current = signal<PageLayout>(layoutOfSnapshot(this.router.routerState.snapshot.root));

  /** Layout of the active route; `'content'` while nothing declares one. */
  readonly layout = this.current.asReadonly();
  /** Width track of the shared page frame for the active layout. */
  readonly track = computed<PageTrack>(() => LAYOUT_TRACK[this.current()]);

  constructor() {
    this.router.events.pipe(takeUntilDestroyed()).subscribe((e) => {
      if (e instanceof NavigationEnd) this.current.set(layoutOfSnapshot(this.router.routerState.snapshot.root));
    });
  }
}
