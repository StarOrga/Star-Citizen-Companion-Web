import { Injectable, Signal, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute, NavigationEnd, Router } from '@angular/router';
import { filter } from 'rxjs';

/**
 * Lets a parent page of an overlay route know whether a child route is
 * active right now (so it can hide its list when the child is a full page).
 * Call `track()` in the parent's injection context.
 */
@Injectable({ providedIn: 'root' })
export class ChildRouteService {
  private readonly router = inject(Router);

  track(): { readonly active: Signal<boolean> } {
    const route = inject(ActivatedRoute);
    const active = signal(!!route.firstChild);
    this.router.events
      .pipe(filter((e) => e instanceof NavigationEnd), takeUntilDestroyed())
      .subscribe(() => active.set(!!route.firstChild));
    return { active: active.asReadonly() };
  }
}
