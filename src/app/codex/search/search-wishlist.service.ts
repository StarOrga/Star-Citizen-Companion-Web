import { Injectable, computed, inject, signal } from '@angular/core';
import { AuthService } from '../../auth/auth.service';
import { SupabaseClientProvider } from '../../core/supabase.client';
import { logWarn } from '../../core/log';
import { HangarService } from '../../hangar/hangar.service';

const key = (kind: string, cls: string): string => `${kind}:${cls.toLowerCase()}`;

/**
 * The search's Wunschliste (concept 2026-11-02, B11). Ships are the hangar's
 * own wishlist status (`hangar_ships.status = 'wishlist'`); every other kind
 * lands in the lean `search_wishlist` table. Never the Nachschub storage.
 *
 * Read once per session after sign-in; a missing table (not deployed yet)
 * degrades silently to an empty list and a failed toggle returns false.
 */
@Injectable({ providedIn: 'root' })
export class SearchWishlistService {
  private readonly sb = inject(SupabaseClientProvider);
  private readonly auth = inject(AuthService);
  private readonly hangar = inject(HangarService);

  private readonly rows = signal<ReadonlySet<string>>(new Set());
  private loadedFor: string | null = null;

  /** Kinds + class names on the list (ships from the hangar). */
  readonly keys = computed<ReadonlySet<string>>(() => {
    const out = new Set(this.rows());
    for (const s of this.hangar.ships()) if (s.status === 'wishlist') out.add(key('ship', s.shipClassName));
    return out;
  });

  has(kind: string, className: string): boolean {
    return this.keys().has(key(kind, className));
  }

  /** Load the non-ship rows once per signed-in user. */
  ensureLoaded(): void {
    const uid = this.auth.user()?.id ?? null;
    if (!uid || this.loadedFor === uid) return;
    this.loadedFor = uid;
    void (async () => {
      try {
        const { data, error } = await this.sb.client.from('search_wishlist' as never).select('entity_kind, class_name');
        if (error) return;
        const rows = (data ?? []) as { entity_kind: string; class_name: string }[];
        this.rows.set(new Set(rows.map((r) => key(r.entity_kind, r.class_name))));
      } catch {
        /* not deployed yet: an empty list */
      }
    })();
  }

  /** Put an entry on the list or take it off. True when it worked. */
  async toggle(kind: string, className: string): Promise<boolean> {
    if (!this.auth.user()) return false;
    if (kind === 'ship' || kind === 'upcoming') return this.toggleShip(className);
    const k = key(kind, className);
    const on = this.rows().has(k);
    try {
      const table = this.sb.client.from('search_wishlist' as never);
      const { error } = on
        ? await table.delete().eq('entity_kind', kind).eq('class_name', className)
        : await table.insert({ entity_kind: kind, class_name: className } as never);
      if (error) {
        logWarn('search', 'wishlist toggle failed', error);
        return false;
      }
      const next = new Set(this.rows());
      if (on) next.delete(k);
      else next.add(k);
      this.rows.set(next);
      return true;
    } catch (err) {
      logWarn('search', 'wishlist toggle failed', err);
      return false;
    }
  }

  private async toggleShip(className: string): Promise<boolean> {
    const ship = this.hangar.shipByClassName(className);
    if (ship?.status === 'wishlist') return this.hangar.removeShip(ship.id);
    if (ship) return false; // owned already: nothing to wish for
    return !!(await this.hangar.addShip(className, 'wishlist'));
  }
}
