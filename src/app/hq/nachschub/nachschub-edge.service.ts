import { Injectable, inject } from '@angular/core';
import { AuthService } from '../../auth/auth.service';
import { toErrorKey } from '../../core/describe-error';
import { SupabaseClientProvider } from '../../core/supabase.client';
import { SearchWishlistService } from '../../codex/search/search-wishlist.service';
import { HangarService } from '../../hangar/hangar.service';
import { HangarShipOrigin } from '../../hangar/hangar.types';
import { HqInventoryService } from '../data/hq-inventory.service';
import { WishlistStore, upcomingClassName } from '../data/wishlist.store';
import { followAnnounced, ingameSources, nextShipCopies } from './nachschub.model';

/**
 * The edge rules of the Nachschub concept (W1.7) that need I/O. The pure rules sit in `nachschub.model.ts`.
 *
 *   resetIngameStock()           wipe: removes every inventory place the game wrote (log / search / community / ocr),
 *                                keeps what the player typed (manual). The UI asks first (danger confirm).
 *   addShipCopy(className, ...)  a second copy of a ship is allowed: the one hangar row counts up; the first copy is
 *                                added with its origin (pledge / ingame / loan).
 *   followAnnouncedShips(map)    an announced ship's wish becomes a normal ship wish once the catalogue carries it.
 *   addPledgedAnnounced(name)    a pledged ship the game does not have yet may sit in the Hangar (keyed by folded name).
 *
 * The catalogue never deletes player rows: nothing here (or anywhere) removes a wish, stock row or line because an
 * item left the build - it is only flagged via `gameStatus()`.
 */
@Injectable({ providedIn: 'root' })
export class NachschubEdgeService {
  private readonly sb = inject(SupabaseClientProvider);
  private readonly auth = inject(AuthService);
  private readonly inventory = inject(HqInventoryService);
  private readonly hangar = inject(HangarService);
  private readonly wish = inject(WishlistStore);
  private readonly searchWish = inject(SearchWishlistService);

  /** i18n key of the last failure, else null. */
  lastError: string | null = null;

  /** Wipe: delete the game-written snapshots (their items cascade). True on success. */
  async resetIngameStock(): Promise<boolean> {
    if (!this.auth.user()) return false;
    this.lastError = null;
    try {
      const { error } = await this.sb.client
        .from('hq_inventory_snapshots' as never)
        .delete()
        .in('source', [...ingameSources()]);
      if (error) throw error;
      await this.inventory.load();
      return true;
    } catch (err) {
      this.lastError = toErrorKey('hq', 'inventory.reset', err);
      return false;
    }
  }

  /** First copy (with origin) or one more copy of a ship. Returns the copy count afterwards, or 0 on failure. */
  async addShipCopy(shipClassName: string, origin: HangarShipOrigin | null = null): Promise<number> {
    const have = this.hangar.shipByClassName(shipClassName);
    if (!have) {
      const added = await this.hangar.addShip(shipClassName, 'owned');
      if (!added) return 0;
      if (origin) await this.hangar.updateShip(added.id, { origin });
      return 1;
    }
    if (have.status === 'wishlist') {
      // Owning fulfils ONE copy of the wish: the row flips to owned with 1 copy, the other wished copies stay wished
      // (3 wished + buy 1 = owned 1, wished 2) - as an extra-copies wish in the store, which SearchWishlistService owns.
      const wished = have.qty ?? 1;
      if (!(await this.hangar.updateShip(have.id, { status: 'owned', qty: 1, ...(origin ? { origin } : {}) }))) return 0;
      if (wished > 1 && !(await this.searchWish.setQty('ship', shipClassName, have.customName, wished - 1))) {
        // The other wished copies could not be kept: back to the wished row as it was, nothing half done.
        await this.hangar.updateShip(have.id, { status: 'wishlist', qty: wished });
        return 0;
      }
      return 1;
    }
    const next = nextShipCopies(have.qty);
    return (await this.hangar.updateShip(have.id, { qty: next })) ? next : 0;
  }

  /** A pledged announced ship in the Hangar: no catalogue entry needed, keyed by its folded name. */
  addPledgedAnnounced(name: string): Promise<number> {
    return this.addShipCopy(upcomingClassName(name), 'pledge');
  }

  /**
   * Announced-ship wishes whose ship the catalogue now has become normal ship wishes (class name known). Returns the
   * converted class names. `catalogShips` maps folded name -> class name.
   */
  async followAnnouncedShips(catalogShips: ReadonlyMap<string, string>): Promise<string[]> {
    const wished = this.wish.rows().filter((r) => r.kind === 'upcoming');
    const hits = followAnnounced(wished.map((r) => r.className), catalogShips);
    const done: string[] = [];
    for (const h of hits) {
      const row = wished.find((r) => r.className === h.foldedName);
      if (!row) continue;
      const qty = row.qty;
      const ship = await this.hangar.addShip(h.shipClassName, 'wishlist');
      if (!ship) continue;
      if (qty > 1) await this.hangar.updateShip(ship.id, { qty });
      await this.wish.remove('upcoming', row.className, row.name);
      done.push(h.shipClassName);
    }
    return done;
  }
}
