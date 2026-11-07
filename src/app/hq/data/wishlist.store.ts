import { Injectable, computed, inject, signal } from '@angular/core';
import { AuthService } from '../../auth/auth.service';
import { SupabaseClientProvider } from '../../core/supabase.client';
import { logWarn } from '../../core/log';
import { normalizeShipName } from '../../codex/upcoming-ships.service';

/** One row of `search_wishlist` - the single wishlist table (migration 20261106140000). */
export interface WishRow {
  kind: string;
  className: string;
  /** Set for announced ships (`kind = 'upcoming'`), which have no catalog name. */
  name: string | null;
  manufacturer: string | null;
  rsiUrl: string | null;
  notes: string | null;
  /** Wished quantity (cart counter), 1..999. */
  qty: number;
  /** Blueprint this material is wished for ('' = on its own); part of the row key. */
  forClassName: string;
  createdAt: string;
}

/** Wish key of an entry: lower-cased class name; announced ships key on their folded name. */
export function wishKey(kind: string, className: string, name?: string | null, forClassName?: string | null): string {
  if (kind === 'upcoming') return `upcoming:${normalizeShipName(name ?? className) || className.toLowerCase()}`;
  const f = (forClassName ?? '').trim().toLowerCase();
  return f ? `${kind}:${className.toLowerCase()}@${f}` : `${kind}:${className.toLowerCase()}`;
}

export const WISH_QTY_MAX = 999;

export function clampWishQty(n: number): number {
  return Number.isFinite(n) ? Math.min(WISH_QTY_MAX, Math.max(1, Math.round(n))) : 1;
}

/** What {@link WishlistStore.add} takes. `qty` defaults to 1; an existing wish is left as it is (see `addQty`). */
export interface WishEntry {
  kind: string;
  className: string;
  name?: string | null;
  manufacturer?: string | null;
  rsiUrl?: string | null;
  notes?: string | null;
  qty?: number;
  forClassName?: string | null;
}

/** Table column that holds an announced ship's key: its folded name. */
export function upcomingClassName(name: string): string {
  return normalizeShipName(name) || name.trim().toLowerCase().slice(0, 200);
}

/**
 * The wishlist table, read once per signed-in user. No dependency on the hangar
 * (the hangar delegates its announced-ship wishlist here). A missing table or a
 * failed write degrades quietly: reads give an empty list, writes return false.
 */
@Injectable({ providedIn: 'root' })
export class WishlistStore {
  private readonly sb = inject(SupabaseClientProvider);
  private readonly auth = inject(AuthService);

  readonly rows = signal<readonly WishRow[]>([]);
  readonly loaded = signal(false);
  private loadedFor: string | null = null;
  private inFlight: Promise<void> | null = null;

  /** key -> row, for O(1) `has`. */
  readonly byKey = computed(() => new Map(this.rows().map((r) => [wishKey(r.kind, r.className, r.name, r.forClassName), r] as const)));

  has(kind: string, className: string, name?: string | null, forClassName?: string | null): boolean {
    return this.byKey().has(wishKey(kind, className, name, forClassName));
  }

  find(kind: string, className: string, name?: string | null, forClassName?: string | null): WishRow | null {
    return this.byKey().get(wishKey(kind, className, name, forClassName)) ?? null;
  }

  /** Wished quantity of an entry, 0 when it is not on the list. */
  qtyOf(kind: string, className: string, name?: string | null, forClassName?: string | null): number {
    return this.find(kind, className, name, forClassName)?.qty ?? 0;
  }

  /** Wished quantity of a class over every group (own wish plus material wished for blueprints). */
  totalQty(kind: string, className: string): number {
    const k = className.toLowerCase();
    return this.rows().reduce((n, r) => (r.kind === kind && r.className.toLowerCase() === k ? n + r.qty : n), 0);
  }

  /** Load once per signed-in user (and again after a user switch). */
  ensureLoaded(): Promise<void> {
    const uid = this.auth.user()?.id ?? null;
    if (!uid) {
      this.rows.set([]);
      this.loadedFor = null;
      this.loaded.set(false);
      return Promise.resolve();
    }
    if (this.loadedFor === uid) return this.inFlight ?? Promise.resolve();
    this.loadedFor = uid;
    this.loaded.set(false);
    this.rows.set([]);
    this.inFlight = (async () => {
      try {
        const { data, error } = await this.sb.client.from('search_wishlist' as never).select('*');
        // The session changed while this ran: these are someone else's wishes.
        if (this.loadedFor !== uid) return;
        if (error) {
          this.loadedFor = null; // try again on the next call
          return;
        }
        this.rows.set(((data ?? []) as Record<string, unknown>[]).map(mapWishRow));
        this.loaded.set(true);
      } catch (err) {
        if (this.loadedFor === uid) this.loadedFor = null;
        logWarn('wishlist', 'load failed', err);
      } finally {
        if (this.loadedFor === uid || this.loadedFor === null) this.inFlight = null;
      }
    })();
    return this.inFlight;
  }

  /** Insert a wish. True when it is on the list afterwards (a duplicate counts). */
  async add(entry: WishEntry): Promise<boolean> {
    if (!this.auth.user()) return false;
    if (this.has(entry.kind, entry.className, entry.name, entry.forClassName)) return true;
    const row = {
      qty: clampWishQty(entry.qty ?? 1),
      for_class_name: (entry.forClassName ?? '').trim().slice(0, 200),
      entity_kind: entry.kind,
      class_name: entry.kind === 'upcoming' ? upcomingClassName(entry.name ?? entry.className) : entry.className,
      name: entry.name?.trim().slice(0, 80) || null,
      manufacturer: entry.manufacturer?.trim() || null,
      rsi_url: entry.rsiUrl ?? null,
      notes: entry.notes?.trim() || null,
    };
    try {
      const { data, error } = await this.sb.client.from('search_wishlist' as never).insert(row as never).select('*').single();
      if (error) {
        if ((error as { code?: string }).code === '23505') return true;
        logWarn('wishlist', 'add failed', error);
        return false;
      }
      this.rows.update((rs) => [mapWishRow(data as Record<string, unknown>), ...rs]);
      return true;
    } catch (err) {
      logWarn('wishlist', 'add failed', err);
      return false;
    }
  }

  /**
   * Set the wished quantity of an entry (the cart stepper). 0 or less removes it; an entry that is not on the
   * list yet is created with that quantity. True when the list shows the quantity afterwards.
   */
  async setQty(entry: WishEntry, qty: number): Promise<boolean> {
    if (!this.auth.user()) return false;
    if (qty <= 0) return this.remove(entry.kind, entry.className, entry.name, entry.forClassName);
    const hit = this.find(entry.kind, entry.className, entry.name, entry.forClassName);
    if (!hit) return this.add({ ...entry, qty });
    const next = clampWishQty(qty);
    if (hit.qty === next) return true;
    try {
      const { error } = await this.sb.client
        .from('search_wishlist' as never)
        .update({ qty: next } as never)
        .eq('entity_kind', hit.kind)
        .eq('class_name', hit.className)
        .eq('for_class_name', hit.forClassName);
      if (error) {
        logWarn('wishlist', 'setQty failed', error);
        return false;
      }
      this.rows.update((rs) => rs.map((r) => (r === hit ? { ...r, qty: next } : r)));
      return true;
    } catch (err) {
      logWarn('wishlist', 'setQty failed', err);
      return false;
    }
  }

  /** Count an entry up by `qty` (default 1) - how returned Nachschub lines land on the wishlist. */
  addQty(entry: WishEntry, qty = entry.qty ?? 1): Promise<boolean> {
    return this.setQty(entry, this.qtyOf(entry.kind, entry.className, entry.name, entry.forClassName) + Math.max(1, Math.round(qty)));
  }

  /** Delete a wish. True when it is gone afterwards. */
  async remove(kind: string, className: string, name?: string | null, forClassName?: string | null): Promise<boolean> {
    if (!this.auth.user()) return false;
    const hit = this.find(kind, className, name, forClassName);
    if (!hit) return true;
    try {
      const { error } = await this.sb.client
        .from('search_wishlist' as never)
        .delete()
        .eq('entity_kind', hit.kind)
        .eq('class_name', hit.className)
        .eq('for_class_name', hit.forClassName);
      if (error) {
        logWarn('wishlist', 'remove failed', error);
        return false;
      }
      this.rows.update((rs) => rs.filter((r) => r !== hit));
      return true;
    } catch (err) {
      logWarn('wishlist', 'remove failed', err);
      return false;
    }
  }
}

function mapWishRow(r: Record<string, unknown>): WishRow {
  const s = (k: string): string | null => (typeof r[k] === 'string' && r[k] ? (r[k] as string) : null);
  return {
    kind: String(r['entity_kind'] ?? ''),
    className: String(r['class_name'] ?? ''),
    name: s('name'),
    manufacturer: s('manufacturer'),
    rsiUrl: s('rsi_url'),
    notes: s('notes'),
    qty: clampWishQty(Number(r['qty'] ?? 1)),
    forClassName: s('for_class_name') ?? '',
    createdAt: s('created_at') ?? '',
  };
}
