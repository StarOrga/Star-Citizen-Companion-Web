import { Injectable, computed, inject } from '@angular/core';
import { AuthService } from '../../auth/auth.service';
import { logWarn } from '../../core/log';
import { HangarService } from '../../hangar/hangar.service';
import { WishlistStore, wishKey } from '../../hq/data/wishlist.store';

/**
 * The one wishlist, as the search and every surface read it. Ships of the live
 * catalog are the hangar's own wishlist status (`hangar_ships.status = 'wishlist'`);
 * every other kind - and announced ships (`kind = 'upcoming'`, keyed on their
 * name because the feed has no class name) - lives in `search_wishlist`
 * (`WishlistStore`). Never the Nachschub storage.
 *
 * Read once per session after sign-in; a missing table degrades silently to an
 * empty list and a failed toggle returns false.
 */
@Injectable({ providedIn: 'root' })
export class SearchWishlistService {
  private readonly auth = inject(AuthService);
  private readonly hangar = inject(HangarService);
  private readonly store = inject(WishlistStore);

  /** Wish keys: kinds + class names on the list (live ships from the hangar, announced ships by folded name). */
  readonly keys = computed<ReadonlySet<string>>(() => {
    const out = new Set(this.store.byKey().keys());
    for (const s of this.hangar.ships()) if (s.status === 'wishlist') out.add(wishKey('ship', s.shipClassName));
    return out;
  });

  /** Number of wished entries (all kinds). */
  readonly count = computed(() => this.keys().size);

  /** `name` matters for announced ships (`upcoming`): their feed id is no stable key, the name is. */
  has(kind: string, className: string, name?: string | null): boolean {
    return this.keys().has(wishKey(kind, className, name));
  }

  /** Load the non-ship rows once per signed-in user. */
  ensureLoaded(): void {
    void this.store.ensureLoaded();
  }

  /** Put an entry on the list or take it off. True when the list now shows the other state. */
  async toggle(kind: string, className: string, name?: string | null): Promise<boolean> {
    if (!this.auth.user()) return false;
    return this.has(kind, className, name) ? this.remove(kind, className, name) : this.add(kind, className, name);
  }

  async add(kind: string, className: string, name?: string | null): Promise<boolean> {
    if (!this.auth.user()) return false;
    if (this.has(kind, className, name)) return true;
    if (kind === 'ship') {
      const ship = this.hangar.shipByClassName(className);
      if (ship) return false; // owned already: nothing to wish for
      return !!(await this.hangar.addShip(className, 'wishlist'));
    }
    const ok = await this.store.add({ kind, className, name: kind === 'upcoming' ? (name ?? className) : null });
    if (!ok) logWarn('search', 'wishlist add failed', { kind });
    return ok;
  }

  async remove(kind: string, className: string, name?: string | null): Promise<boolean> {
    if (!this.auth.user()) return false;
    if (kind === 'ship') {
      const ship = this.hangar.shipByClassName(className);
      if (ship?.status !== 'wishlist') return !ship; // owned: not ours to remove
      return this.hangar.removeShip(ship.id);
    }
    return this.store.remove(kind, className, name);
  }
}
