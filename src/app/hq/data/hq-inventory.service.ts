import { Injectable, computed, inject, signal } from '@angular/core';
import { AuthService } from '../../auth/auth.service';
import { toErrorKey } from '../../core/describe-error';
import { SupabaseClientProvider } from '../../core/supabase.client';
import type { HqInventoryItemRow, HqInventorySnapshotRow, HqInventorySource, HqShipStorageRow } from './hq-db.types';

const SNAPSHOT_SOURCES: readonly HqInventorySource[] = ['log', 'search', 'community', 'ocr', 'manual'];

export interface PreviousSnapshot {
  location: string;
  system: string | null;
  source: HqInventorySource;
  takenAt: string;
  items: { name: string; class_name: string | null; qty: number; unit: 'pcs' | 'scu' }[];
}

/** Defensive parse of the `previous` snapshot a desktop `inventory.snapshot` event carries. */
export function parsePreviousSnapshot(raw: unknown): PreviousSnapshot | null {
  if (!raw || typeof raw !== 'object') return null;
  let o = raw as Record<string, unknown>;
  // The desktop writes `{ snapshot: <snapshot row>, items: [<item rows>] }` (docs/contracts/hq-live.md).
  const nested = o['snapshot'];
  if (nested && typeof nested === 'object') o = { ...(nested as Record<string, unknown>), items: o['items'] };
  const location = typeof o['location'] === 'string' ? o['location'].trim().slice(0, 200) : '';
  if (!location) return null;
  const source = SNAPSHOT_SOURCES.find((s) => s === o['source']) ?? 'manual';
  const takenRaw = o['taken_at'] ?? o['takenAt'];
  const takenAt = typeof takenRaw === 'string' && Number.isFinite(Date.parse(takenRaw)) ? takenRaw : new Date().toISOString();
  const items: PreviousSnapshot['items'] = [];
  for (const it of Array.isArray(o['items']) ? (o['items'] as unknown[]).slice(0, 400) : []) {
    if (!it || typeof it !== 'object') continue;
    const r = it as Record<string, unknown>;
    const name = typeof r['name'] === 'string' ? r['name'].trim().slice(0, 160) : '';
    const qty = Number(r['qty']);
    if (!name || !Number.isFinite(qty) || qty <= 0 || qty > 1_000_000_000) continue;
    items.push({
      name,
      class_name: typeof r['class_name'] === 'string' && r['class_name'] ? r['class_name'] : null,
      qty,
      unit: r['unit'] === 'scu' ? 'scu' : 'pcs',
    });
  }
  return { location, system: typeof o['system'] === 'string' ? o['system'] : null, source, takenAt, items };
}

/** From this age (days) a snapshot's margin note turns `--sc-warning` (D39). */
export const HQ_STOCK_STALE_DAYS = 7;
export const HQ_LOCATION_MAX = 200;
export const HQ_ITEM_NAME_MAX = 160;
export const HQ_QTY_MAX = 1_000_000_000;

const DAY_MS = 86_400_000;

export type HqAgeUnit = 'minutes' | 'hours' | 'days';
export interface HqAge {
  unit: HqAgeUnit;
  n: number;
  /** True from {@link HQ_STOCK_STALE_DAYS} days on. */
  stale: boolean;
}

/** Age of a snapshot as a coarse "vor n …" figure. Future/invalid timestamps count as "just now". */
export function snapshotAge(takenAt: string, now: number = Date.now()): HqAge {
  const t = Date.parse(takenAt);
  const ms = Number.isFinite(t) ? Math.max(0, now - t) : 0;
  if (ms < 3_600_000) return { unit: 'minutes', n: Math.floor(ms / 60_000), stale: false };
  if (ms < DAY_MS) return { unit: 'hours', n: Math.floor(ms / 3_600_000), stale: false };
  const n = Math.floor(ms / DAY_MS);
  return { unit: 'days', n, stale: n >= HQ_STOCK_STALE_DAYS };
}

/** One storage place with its snapshot and items. */
export interface HqLocation {
  snapshot: HqInventorySnapshotRow;
  items: HqInventoryItemRow[];
  /** Raw materials (unit scu) and pieces, split for the two rows of the Lager card. */
  materials: HqInventoryItemRow[];
  pieces: HqInventoryItemRow[];
}

export function groupLocations(
  snaps: readonly HqInventorySnapshotRow[],
  items: readonly HqInventoryItemRow[],
): HqLocation[] {
  return [...snaps]
    .sort((a, b) => b.taken_at.localeCompare(a.taken_at))
    .map((snapshot) => {
      const own = items.filter((i) => i.location === snapshot.location);
      return {
        snapshot,
        items: own,
        materials: own.filter((i) => i.unit === 'scu'),
        pieces: own.filter((i) => i.unit !== 'scu'),
      };
    });
}

/**
 * Lager (D38/D39): inventory snapshots per place, their items, and where ships are stored.
 * Reads are RLS self-only. A manual entry ("liegt in …") writes source `manual`, touches only
 * its own item row and bumps the snapshot's `taken_at`.
 */
@Injectable({ providedIn: 'root' })
export class HqInventoryService {
  private readonly sb = inject(SupabaseClientProvider);
  private readonly auth = inject(AuthService);

  readonly snapshots = signal<readonly HqInventorySnapshotRow[]>([]);
  readonly items = signal<readonly HqInventoryItemRow[]>([]);
  readonly shipStorage = signal<readonly HqShipStorageRow[]>([]);
  readonly loading = signal(false);
  readonly loaded = signal(false);
  /** i18n key of the last failed load/save, never raw text. */
  readonly error = signal<string | null>(null);

  readonly locations = computed(() => groupLocations(this.snapshots(), this.items()));

  private inFlight: Promise<void> | null = null;

  load(): Promise<void> {
    if (!this.inFlight) {
      this.inFlight = this.loadOnce().finally(() => (this.inFlight = null));
    }
    return this.inFlight;
  }

  private async loadOnce(): Promise<void> {
    this.loading.set(true);
    this.error.set(null);
    try {
      const c = this.sb.client;
      const [s, i, st] = await Promise.all([
        c.from('hq_inventory_snapshots' as never).select('*').order('taken_at', { ascending: false }),
        c.from('hq_inventory_items' as never).select('*').order('name', { ascending: true }),
        c.from('hq_ship_storage' as never).select('*').order('taken_at', { ascending: false }),
      ]);
      if (s.error) throw s.error;
      if (i.error) throw i.error;
      if (st.error) throw st.error;
      this.snapshots.set((s.data ?? []) as unknown as HqInventorySnapshotRow[]);
      this.items.set((i.data ?? []) as unknown as HqInventoryItemRow[]);
      this.shipStorage.set((st.data ?? []) as unknown as HqShipStorageRow[]);
      this.loaded.set(true);
    } catch (err) {
      this.error.set(toErrorKey('hq', 'inventory.load', err));
    } finally {
      this.loading.set(false);
    }
  }

  /**
   * Undo of a replaced snapshot (desktop `inventory.snapshot` event, `applied.previous`): puts the
   * previous snapshot and its items back. False on an unusable `previous` or a failed write.
   */
  async restoreSnapshot(previous: unknown): Promise<boolean> {
    const userId = this.auth.user()?.id;
    const snap = parsePreviousSnapshot(previous);
    if (!userId || !snap) return false;
    this.error.set(null);
    try {
      const c = this.sb.client;
      const s = await c.from('hq_inventory_snapshots' as never).upsert(
        {
          user_id: userId,
          location: snap.location,
          system: snap.system,
          source: snap.source,
          taken_at: snap.takenAt,
          item_count: Math.min(400, snap.items.length),
        } as never,
        { onConflict: 'user_id,location' },
      );
      if (s.error) throw s.error;
      const del = await c.from('hq_inventory_items' as never).delete().eq('user_id', userId).eq('location', snap.location);
      if (del.error) throw del.error;
      if (snap.items.length) {
        const ins = await c
          .from('hq_inventory_items' as never)
          .insert(snap.items.map((i) => ({ user_id: userId, location: snap.location, ...i })) as never);
        if (ins.error) throw ins.error;
      }
      await this.load();
      return !this.error();
    } catch (err) {
      this.error.set(toErrorKey('hq', 'inventory.restore', err));
      return false;
    }
  }

  /** "liegt in …": put `qty` of `item` into `location` (source `manual`). False on invalid input or failure. */
  async addManual(location: string, item: string, qty: number, unit: 'pcs' | 'scu'): Promise<boolean> {
    const loc = location.trim().slice(0, HQ_LOCATION_MAX);
    const name = item.trim().slice(0, HQ_ITEM_NAME_MAX);
    const q = Number(qty);
    if (!loc || !name || !Number.isFinite(q) || q <= 0 || q > HQ_QTY_MAX) return false;
    const userId = this.auth.user()?.id;
    if (!userId) return false;
    this.error.set(null);
    try {
      const c = this.sb.client;
      const now = new Date().toISOString();
      const existing = this.snapshots().find((s) => s.location === loc);
      const count = this.items().filter((i) => i.location === loc && i.name !== name).length + 1;
      const snap = await c.from('hq_inventory_snapshots' as never).upsert(
        {
          user_id: userId,
          location: loc,
          source: existing?.source ?? 'manual',
          taken_at: now,
          item_count: Math.min(400, count),
        } as never,
        { onConflict: 'user_id,location' },
      );
      if (snap.error) throw snap.error;
      const row = await c
        .from('hq_inventory_items' as never)
        .upsert({ user_id: userId, location: loc, name, qty: q, unit } as never, {
          onConflict: 'user_id,location,name',
        });
      if (row.error) throw row.error;
      await this.load();
      return !this.error();
    } catch (err) {
      this.error.set(toErrorKey('hq', 'inventory.add', err));
      return false;
    }
  }
}
