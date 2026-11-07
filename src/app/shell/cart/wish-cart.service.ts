import { Injectable, computed, effect, inject, signal, untracked } from '@angular/core';
import { NavigationEnd, Router } from '@angular/router';
import { WishNamesService } from '../../codex/search/wish-names.service';
import { CodexService } from '../../codex/codex.service';
import { humanizeClassName } from '../../codex/codex-format';
import { logWarn } from '../../core/log';
import { AuthService } from '../../auth/auth.service';
import { HangarService } from '../../hangar/hangar.service';
import { WishlistStore, wishKey } from '../../hq/data/wishlist.store';
import { HqInventoryService } from '../../hq/data/hq-inventory.service';
import { fpsRowsToRecItems } from '../../hq/nachschub/rec-catalogue';
import {
  READY_COUNT,
  dismissSuggestion,
  emptyDismissState,
  onWishlistAdd,
  recommend,
  visibleSuggestions,
  type RecItem,
  type Recommendation,
} from '../../hq/nachschub/recommend';
import { positionKey } from '../../hq/nachschub/nachschub.model';
import { CART_PARAM } from '../../hq/hq-routes';
import { UndoToastService } from '../../shared/undo-toast/undo-toast.service';
import { cartGroups, lastAdded, type CartItem } from './wish-cart.model';

/** The query string of a router URL, without the fragment. */
function queryOf(url: string): URLSearchParams {
  const q = url.split('#', 1)[0].split('?')[1] ?? '';
  return new URLSearchParams(q);
}

/**
 * The Warenkorb: the wishlist (store rows plus wished ships) as the cart dialog and the quick access read it.
 *
 * Open or closed lives in the URL (`?cart=1`), so the cart has its own address. Removing is immediate with an undo toast:
 * the position vanishes from the cart at once (`hidden`), the real delete runs when the toast window closes, undo just
 * un-hides it - no question asked, also for a whole group (r4 s2-a2).
 */
@Injectable({ providedIn: 'root' })
export class WishCartService {
  private readonly router = inject(Router);
  private readonly auth = inject(AuthService);
  private readonly store = inject(WishlistStore);
  private readonly hangar = inject(HangarService);
  private readonly names = inject(WishNamesService);
  private readonly inventory = inject(HqInventoryService);
  private readonly codex = inject(CodexService);
  private readonly undo = inject(UndoToastService);

  private readonly url = signal(this.router.url);
  readonly isOpen = computed(() => queryOf(this.url()).has(CART_PARAM));

  /** Positions removed in the undo window: still in the store, already gone from the cart. */
  private readonly hidden = signal<ReadonlySet<string>>(new Set());

  constructor() {
    this.router.events.subscribe((e) => {
      if (e instanceof NavigationEnd) this.url.set(e.urlAfterRedirects);
    });
    effect(() => {
      if (this.auth.user()) void this.store.ensureLoaded();
    });
    // Anything newly added brings the dismissed suggestions back (r4 s2-a3).
    let seen = 0;
    effect(() => {
      const n = this.rawItems().length;
      untracked(() => {
        if (n > seen) this.dismissed.set(onWishlistAdd());
        seen = n;
      });
    });
    // Ask for the names of what the cart shows.
    effect(() => {
      const items = this.rawItems();
      untracked(() =>
        this.names.request([
          ...items.filter((i) => !i.name && i.kind !== 'upcoming').map((i) => i.className),
          ...items.map((i) => i.forClassName ?? '').filter(Boolean),
        ]),
      );
    });
  }

  // ---------------------------------------------------------------------------------------------------- reading

  private readonly rawItems = computed<readonly CartItem[]>(() => {
    const rows: CartItem[] = this.store.rows().map((r) => ({
      kind: r.kind,
      className: r.className,
      name: r.name,
      qty: r.qty,
      forClassName: r.forClassName || null,
      key: positionKey({ kind: r.kind, className: r.className, forClassName: r.forClassName }),
      createdAt: r.createdAt,
      manufacturer: r.manufacturer,
      shipId: null,
    }));
    for (const s of this.hangar.ships()) {
      if (s.status !== 'wishlist') continue;
      rows.push({
        kind: 'ship',
        className: s.shipClassName,
        name: s.customName,
        qty: s.qty ?? 1,
        forClassName: null,
        key: positionKey({ kind: 'ship', className: s.shipClassName }),
        createdAt: s.createdAt,
        manufacturer: null,
        shipId: s.id,
      });
    }
    return rows;
  });

  /** What the cart shows: every position except the ones in the undo window. */
  readonly items = computed<readonly CartItem[]>(() => {
    const hide = this.hidden();
    return this.rawItems().filter((i) => !hide.has(i.key));
  });
  readonly byKey = computed(() => new Map(this.items().map((i) => [i.key, i] as const)));
  /** Number of positions - what "Ganze Wunschliste · N Positionen" counts. */
  readonly count = computed(() => this.items().length);
  readonly groups = computed(() => cartGroups(this.items()));

  /** The newest `n` positions, optionally cut to the ones `keep` accepts (the page type). */
  newest(n: number, keep?: (i: CartItem) => boolean): CartItem[] {
    return lastAdded(keep ? this.items().filter(keep) : this.items(), n);
  }

  /** The display name: the stored name, else the catalogue name, else the readable class name. */
  nameOf(i: Pick<CartItem, 'kind' | 'className' | 'name'>): string {
    return i.name?.trim() || this.names.nameOf(i.kind, i.className) || humanizeClassName(i.className);
  }

  // ---------------------------------------------------------------------------------------------------- opening

  open(): Promise<boolean> {
    return this.router.navigate([], { queryParams: { [CART_PARAM]: '1' }, queryParamsHandling: 'merge', preserveFragment: true });
  }

  close(): Promise<boolean> {
    return this.router.navigate([], { queryParams: { [CART_PARAM]: null }, queryParamsHandling: 'merge', preserveFragment: true });
  }

  // ---------------------------------------------------------------------------------------------------- writing

  async setQty(i: CartItem, qty: number): Promise<boolean> {
    const next = Math.min(999, Math.max(1, Math.round(qty)));
    if (i.shipId) return this.hangar.updateShip(i.shipId, { qty: next });
    return this.store.setQty({ kind: i.kind, className: i.className, name: i.name, forClassName: i.forClassName }, next);
  }

  /** Remove positions with an undo window; nothing is written before the toast closes. */
  remove(items: readonly CartItem[], messageKey = 'cart.removed', params?: Record<string, unknown>): void {
    if (!items.length) return;
    const keys = items.map((i) => i.key);
    this.hidden.update((h) => new Set([...h, ...keys]));
    this.undo.offer({
      messageKey,
      messageParams: params ?? { name: this.nameOf(items[0]), n: items.length },
      onUndo: () => this.unhide(keys),
      commit: async () => {
        await Promise.all(items.map((i) => this.erase(i)));
        this.unhide(keys);
      },
    });
  }

  private unhide(keys: readonly string[]): void {
    const gone = new Set(keys);
    this.hidden.update((h) => new Set([...h].filter((k) => !gone.has(k))));
  }

  private async erase(i: CartItem): Promise<void> {
    try {
      if (i.shipId) await this.hangar.removeShip(i.shipId);
      else await this.store.remove(i.kind, i.className, i.name, i.forClassName);
    } catch (err) {
      logWarn('cart', 'remove failed', err);
    }
  }

  /** A suggestion goes onto the wishlist (quantity 1). */
  async addSuggestion(r: Recommendation): Promise<boolean> {
    const item = this.catalogue().get(r.className);
    const kind = item?.kind === 'fps_weapon' ? 'weapon' : 'item';
    return this.store.add({ kind, className: r.className, name: r.name });
  }

  // ---------------------------------------------------------------------------------------------------- Passt dazu

  private readonly catalogue = signal<ReadonlyMap<string, RecItem>>(new Map());
  private catalogueAsked = false;
  private readonly dismissed = signal(emptyDismissState);

  /**
   * The ranked ready list (up to 7), recomputed whenever the wishlist or ownership changes. The catalogue (the lean FPS
   * lists, cached by the codex service) is read the first time the cart opens.
   */
  readonly ready = computed<readonly Recommendation[]>(() => {
    const cat = this.catalogue();
    if (!cat.size) return [];
    const anchors = lastAdded(
      this.items().filter((i) => i.kind === 'item' || i.kind === 'weapon'),
      3,
    ).map((i) => ({ className: i.className, addedAt: i.createdAt }));
    if (!anchors.length) return [];
    const owned = new Set<string>(this.inventory.items().map((r) => r.class_name ?? '').filter(Boolean));
    for (const s of this.hangar.ships()) if (s.status === 'owned') owned.add(s.shipClassName);
    return recommend({
      anchors,
      catalogue: cat,
      owned,
      wished: new Set(this.rawItems().map((i) => i.className)),
      stocked: new Set(owned),
      dismissed: this.dismissed().dismissed,
      count: READY_COUNT,
    });
  });

  /** The three shown: the ready list without what was just dismissed; each dismissal slides the next one up. */
  readonly suggestions = computed(() => visibleSuggestions(this.ready(), this.dismissed()));

  dismiss(className: string): void {
    this.dismissed.update((s) => dismissSuggestion(s, className));
  }

  /** Read the catalogue the first time the cart opens. */
  ensureCatalogue(): void {
    if (this.catalogueAsked) return;
    this.catalogueAsked = true;
    void (async () => {
      try {
        const [armor, weapons] = await Promise.all([this.codex.listFpsCatalog('armor', true, true), this.codex.listFpsCatalog('weapon', true, true)]);
        const all = [...fpsRowsToRecItems(armor, 'armor'), ...fpsRowsToRecItems(weapons, 'weapon')];
        this.catalogue.set(new Map(all.map((i) => [i.className, i] as const)));
      } catch (err) {
        // Suggestions are advisory: no catalogue, no row - never an error state. Ask again on the next open.
        this.catalogueAsked = false;
        logWarn('cart', 'suggestion catalogue unavailable', err);
      }
    })();
  }

  /** The wishlist store's own key of a cart item. */
  wishKeyOf(i: Pick<CartItem, 'kind' | 'className' | 'name' | 'forClassName'>): string {
    return wishKey(i.kind, i.className, i.name, i.forClassName);
  }
}
