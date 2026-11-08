import { Injectable, inject } from '@angular/core';
import { SearchWishlistService } from '../../codex/search/search-wishlist.service';
import { logWarn } from '../../core/log';
import { UndoToastService } from '../../shared/undo-toast/undo-toast.service';
import { WishlistStore } from '../data/wishlist.store';
import { HqSuppliesService } from '../hq-supplies.service';
import { NachschubService } from '../nachschub/nachschub.service';
import { type StockCategory } from './hq-stock-model';
import { ingredientTokenOfCrate, parseStockRef } from './hq-stock-ref';

/** The cart glyph of the "auf die Wunschliste" button on a Bestand tile and in the popup (one icon, both places). */
export const WISH_CART_ICON: readonly string[] = ['M3 4h2.5l2 11h10l2-8H7', 'M9.5 19a1.2 1.2 0 1 0 0-.01', 'M16.5 19a1.2 1.2 0 1 0 0-.01'];

/** The kinds the Codex puts an item wish under; a stock row of unknown kind is matched against these. */
const ITEM_WISH_KINDS: readonly string[] = ['weapon', 'component', 'item'];

/** A wish as the wishlist stores it: the Codex kind and the bare class name. */
export interface StockWishTarget {
  /** `ship`, `blueprint`, `material`, or the Codex item kinds `weapon` / `component` / `item`. `item?` = not known for sure. */
  readonly kind: string;
  readonly className: string;
  readonly name: string;
  /** The kind was a guess (a bare class name): an existing wish of this class under another item kind wins. */
  readonly guessed?: boolean;
}

/** A stock row or tile as far as a wish needs it. */
export interface StockWishSource {
  className: string | null;
  name: string;
  unit: 'pcs' | 'scu';
  cat?: StockCategory;
}

/**
 * Bestand wishes: what a tile or a popup row means on the wishlist, the quiet hint ("auf der Wunschliste N" / "im Nachschub")
 * and the "auf die Wunschliste" action with its undo toast. One place for the tiles of Inventar, Hangar and Sammlung and for the
 * popup, so they all agree with the kind and key the Codex wishes use (a manual row stores `weapon:Foo`; a bare game class name
 * is matched against the wishes it may belong to).
 */
@Injectable({ providedIn: 'root' })
export class StockWishService {
  private readonly store = inject(WishlistStore);
  private readonly wishes = inject(SearchWishlistService);
  private readonly supplies = inject(HqSuppliesService);
  private readonly ns = inject(NachschubService);
  private readonly toast = inject(UndoToastService);

  /** Inventar row or tile → wish target; null without a class name (nothing to key a wish on). */
  targetOf(src: StockWishSource): StockWishTarget | null {
    const ref = parseStockRef(src.className);
    if (!ref) return null;
    if (ref.kind === 'ship') return { kind: 'ship', className: ref.className, name: src.name };
    if (src.unit === 'scu') {
      // Recipes name the plain material ("Iron"), the stock holds crates of it: wish the material.
      return { kind: 'material', className: ingredientTokenOfCrate(ref.className) ?? ref.className, name: src.name };
    }
    if (ref.kind === 'weapon' || ref.kind === 'component' || ref.kind === 'item') return { kind: ref.kind, className: ref.className, name: src.name };
    if (ref.kind === 'ammunition') return { kind: 'item', className: ref.className, name: src.name };
    if (ref.className.startsWith('BP_')) return { kind: 'blueprint', className: ref.className, name: src.name };
    return { kind: src.cat === 'weapons' ? 'weapon' : 'item', className: ref.className, name: src.name, guessed: true };
  }

  shipTarget(shipClassName: string, name: string): StockWishTarget {
    return { kind: 'ship', className: shipClassName, name };
  }

  blueprintTarget(id: string, name: string): StockWishTarget {
    return { kind: 'blueprint', className: id, name };
  }

  /** A guessed kind gives way to the kind an existing wish of the class already sits under (the Codex's own). */
  private settle(t: StockWishTarget): StockWishTarget {
    if (!t.guessed) return t;
    const k = ITEM_WISH_KINDS.find((kind) => this.store.totalQty(kind, t.className) > 0);
    return k ? { ...t, kind: k, guessed: false } : t;
  }

  /** How many of it are wished (over every group, so a material wished for a blueprint counts). */
  wished(target: StockWishTarget): number {
    const t = this.settle(target);
    return t.kind === 'ship' ? this.wishes.qtyOf('ship', t.className) : this.store.totalQty(t.kind, t.className);
  }

  /** The quiet hint of a tile: already wished, else already in a Nachschub. */
  hint(target: StockWishTarget | null): { key: string; params: Record<string, unknown> } | null {
    if (!target) return null;
    const n = this.wished(target);
    if (n > 0) return { key: 'hq.bestand.hintWish', params: { n } };
    const cls = target.className.toLowerCase();
    const line = this.supplies.items().find((l) => !l.done && l.packageId && (l.className ?? '').toLowerCase() === cls);
    const pkg = line ? this.ns.packages().find((p) => p.id === line.packageId) : null;
    return pkg ? { key: 'hq.bestand.hintNachschub', params: { name: pkg.name } } : null;
  }

  /** The own (ungrouped) wish of the target: the quantity the button counts up. */
  private own(t: StockWishTarget): number {
    return t.kind === 'ship' ? this.wishes.qtyOf('ship', t.className) : this.store.qtyOf(t.kind, t.className, t.name);
  }

  private async write(t: StockWishTarget, qty: number): Promise<boolean> {
    if (t.kind === 'ship') {
      // One write: setQty creates the wish where it belongs (owned ship -> store row, else the wished Hangar row).
      return this.wishes.setQty('ship', t.className, t.name, qty);
    }
    return this.store.setQty({ kind: t.kind, className: t.className, name: t.name }, qty);
  }

  private erase(t: StockWishTarget): Promise<boolean> {
    return t.kind === 'ship' ? this.wishes.remove('ship', t.className, t.name) : this.store.remove(t.kind, t.className, t.name);
  }

  /**
   * "Nachholen": `qty` more of it onto the wishlist, counted up there. The write is made at once, the toast offers the way back
   * (the former quantity, or off the list when it was not on it). False when the write failed (no toast then).
   */
  async wish(target: StockWishTarget, qty = 1, withToast = true): Promise<boolean> {
    const t = this.settle(target);
    const have = this.own(t);
    const more = Math.max(1, Math.round(qty));
    const ok = await this.write(t, have + more);
    if (!ok) return false;
    if (!withToast) return true;
    this.toast.offer({
      messageKey: 'itemPath.done.wishOn',
      messageParams: { name: t.name },
      commit: () => undefined,
      onUndo: () => {
        // Only what this step added comes off: a change made meanwhile stays.
        const left = this.own(t) - more;
        void (left > 0 ? this.write(t, left) : this.erase(t)).then((back) => {
          if (!back) logWarn('stock', 'wish undo failed', { kind: t.kind });
        });
      },
    });
    return true;
  }
}
