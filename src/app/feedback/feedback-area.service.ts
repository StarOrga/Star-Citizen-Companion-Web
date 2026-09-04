import { Injectable, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router } from '@angular/router';
import { filter } from 'rxjs/operators';
import { RoleService } from '../auth/role.service';
import { FEEDBACK_AREAS, FeedbackArea, areaForUrl } from './feedback-area.types';

/**
 * Where the user currently is, expressed as a feedback area (admin feedback
 * 835fec58) — the source of the pre-selected chip in every feedback composer.
 *
 * Root-scoped and event-driven rather than read on demand, because the feedback
 * panels stay MOUNTED while the user keeps navigating: an admin can open the
 * FAB on /news, walk over to /codex and only then start typing. A value snapshot
 * taken when the composer opened would tag that topic "News". This signal
 * follows the router, and the picker follows this signal until the sender picks
 * a chip by hand.
 */
@Injectable({ providedIn: 'root' })
export class FeedbackAreaService {
  private readonly router = inject(Router);
  private readonly roles = inject(RoleService);

  private readonly _current = signal<FeedbackArea>(areaForUrl(this.router.url));

  /** The area of the page on screen right now. */
  readonly current = this._current.asReadonly();

  /**
   * The chips a given user may choose from. `admin` is dropped for everyone who
   * is not one: a viewer can neither reach those pages nor have feedback about
   * them, so offering the chip would only invite mis-tagging. The auto-detection
   * never produces it for them either — the routes are guarded.
   */
  readonly options = computed<readonly FeedbackArea[]>(() =>
    this.roles.isAdmin() ? FEEDBACK_AREAS : FEEDBACK_AREAS.filter((a) => a !== 'admin'),
  );

  constructor() {
    this.router.events
      .pipe(
        filter((e): e is NavigationEnd => e instanceof NavigationEnd),
        takeUntilDestroyed(),
      )
      .subscribe((e) => this._current.set(areaForUrl(e.urlAfterRedirects)));
  }
}
