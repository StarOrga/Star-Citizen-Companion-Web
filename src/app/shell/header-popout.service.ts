import { Injectable, signal } from '@angular/core';

/** The header popouts that exclude each other: wishlist, apps menu, profile menu. */
export type HeaderPopoutId = 'wishlist' | 'apps' | 'profile';

/**
 * Which header popout is open - at most one. A popout claims the slot when it opens and closes itself when
 * another id takes it, so two panels are never stacked on top of each other.
 */
@Injectable({ providedIn: 'root' })
export class HeaderPopoutService {
  readonly active = signal<HeaderPopoutId | null>(null);

  claim(id: HeaderPopoutId): void {
    this.active.set(id);
  }

  /** Free the slot, but only when this popout still holds it (another one may have taken it already). */
  release(id: HeaderPopoutId): void {
    if (this.active() === id) this.active.set(null);
  }
}
