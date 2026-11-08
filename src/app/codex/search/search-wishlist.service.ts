import { Injectable, computed, inject } from '@angular/core';
import { AuthService } from '../../auth/auth.service';
import { logWarn } from '../../core/log';
import { HangarService } from '../../hangar/hangar.service';
import { WishlistStore, clampWishQty, wishKey } from '../../hq/data/wishlist.store';

/**
 * The one wishlist, as the search and every surface read it. Never the Nachschub storage.
 *
 * Ships (concept nachschub-hq r1 "Zweites Exemplar desselben Schiffs erlaubt") have two homes, and every read here
 * adds both up, so callers never ask which one holds a wish:
 *   - a ship NOT in the Hangar is wished as the hangar's own row (`hangar_ships.status = 'wishlist'`, `qty` copies) -
 *     the Hangar, friends and the Hangar badge keep seeing it there;
 *   - a ship the reader already OWNS keeps its owned row, and the wish for more copies lives in `search_wishlist`
 *     (`entity_kind = 'ship'`, `qty`). `hangar_ships` is unique per (user, ship), so one row cannot be both.
 * Every other kind - and announced ships (`kind = 'upcoming'`, keyed on their name because the feed has no class
 * name) - lives in `search_wishlist` (`WishlistStore`).
 *
 * Read once per session after sign-in; a missing table degrades silently to an empty list and a failed toggle
 * returns false.
 */
@Injectable({ providedIn: 'root' })
export class SearchWishlistService {
  private readonly auth = inject(AuthService);
  private readonly hangar = inject(HangarService);
  private readonly store = inject(WishlistStore);

  /** Wish keys: kinds + class names on the list (live ships from both homes, announced ships by folded name). */
  readonly keys = computed<ReadonlySet<string>>(() => {
    const out = new Set(this.store.byKey().keys());
    for (const s of this.hangar.ships()) if (s.status === 'wishlist') out.add(wishKey('ship', s.shipClassName));
    return out;
  });

  /** Number of wished entries (all kinds); a ship wished in both homes counts once. */
  readonly count = computed(() => this.keys().size);

  /** `name` matters for announced ships (`upcoming`): their feed id is no stable key, the name is. */
  has(kind: string, className: string, name?: string | null): boolean {
    return this.keys().has(wishKey(kind, className, name));
  }

  /** Wished quantity of an entry (the cart counter); 0 when it is not on the list. A ship adds up both homes. */
  qtyOf(kind: string, className: string, name?: string | null): number {
    if (kind === 'ship') return this.hangarWishQty(className) + this.store.qtyOf('ship', className);
    return this.store.qtyOf(kind, className, name);
  }

  /**
   * Set the wished quantity of an entry; 0 or less takes it off, an entry not on the list yet is created with it.
   * True when the list shows that quantity afterwards. A ship's wish stays in the home it has (see the class doc).
   */
  async setQty(kind: string, className: string, name: string | null | undefined, qty: number): Promise<boolean> {
    if (!this.auth.user()) return false;
    if (qty <= 0) return this.remove(kind, className, name);
    if (kind === 'ship') {
      const s = this.hangar.shipByClassName(className);
      if (s?.status === 'wishlist') return this.hangar.updateShip(s.id, { qty: clampWishQty(qty) });
      if (!s && !this.store.has('ship', className)) {
        const added = await this.hangar.addShip(className, 'wishlist');
        if (!added) return false;
        return qty > 1 ? this.hangar.updateShip(added.id, { qty: clampWishQty(qty) }) : true;
      }
      return this.store.setQty({ kind: 'ship', className, name: name ?? null }, qty);
    }
    return this.store.setQty({ kind, className, name: name ?? null }, qty);
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
    if (kind === 'ship' && !this.hangar.shipByClassName(className)) return !!(await this.hangar.addShip(className, 'wishlist'));
    // An owned ship's wish (one more copy) is a store row, like every other kind. The name is stored for every kind,
    // so the Merkliste and the lists show "Arrow-I-Rakete", not the class name.
    const ok = await this.store.add({ kind, className, name: name?.trim() || (kind === 'upcoming' ? className : null) });
    if (!ok) logWarn('search', 'wishlist add failed', { kind });
    return ok;
  }

  async remove(kind: string, className: string, name?: string | null): Promise<boolean> {
    if (!this.auth.user()) return false;
    if (kind === 'ship') {
      // Both homes: the store row (the wish for more copies) and a hangar row that is only a wish. An owned row stays.
      if (!(await this.store.remove('ship', className))) return false;
      const ship = this.hangar.shipByClassName(className);
      return ship?.status === 'wishlist' ? this.hangar.removeShip(ship.id) : true;
    }
    return this.store.remove(kind, className, name);
  }

  private hangarWishQty(className: string): number {
    const s = this.hangar.shipByClassName(className);
    return s?.status === 'wishlist' ? (s.qty ?? 1) : 0;
  }
}
