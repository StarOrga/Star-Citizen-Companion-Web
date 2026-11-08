import { Injectable, computed, inject, signal } from '@angular/core';
import { AuthService } from '../../auth/auth.service';
import { toErrorKey } from '../../core/describe-error';
import { logWarn } from '../../core/log';
import { SupabaseClientProvider } from '../../core/supabase.client';
import { readLocation } from '../now/hq-live.util';
import { RESERVATIONS_MAX, RESERVATION_NOTE_MAX, availableOf, reservationsOf, takeOut } from '../stock/hq-stock-counter';
import { type BestandKind, kindsByClass } from './hq-codex-kind';
import type {
  HqCodexKindRow,
  HqFriendReservationRow,
  HqInventoryItemRow,
  HqInventoryRemovalRow,
  HqInventorySnapshotRow,
  HqLiveEventRow,
  HqRemovalKind,
  HqReservationRow,
  HqShipStorageRow,
  HqStockReservation,
} from './hq-db.types';
import { LAST_REMOVALS, type Removal, lastRemovals } from './hq-removals';
import { parsePreviousSnapshot, parseQuality } from './hq-snapshot';

export { parsePreviousSnapshot, parseQuality, type PreviousSnapshot } from './hq-snapshot';

/** From this age (days) a snapshot's margin note turns `--sc-warning` (D39). */
export const HQ_STOCK_STALE_DAYS = 7;
export const HQ_LOCATION_MAX = 200;
export const HQ_ITEM_NAME_MAX = 160;
export const HQ_QTY_MAX = 1_000_000_000;

const DAY_MS = 86_400_000;

/** Stock amounts are SCU fractions too: sums and differences are trimmed to 6 decimals (float noise). */
const roundQty = (n: number): number => Math.round(n * 1e6) / 1e6;

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

/** The stack a row belongs to: place + item + quality. `quality` undefined = "the first stack of that name" (old callers). */
export type HqStackRef = Pick<HqInventoryItemRow, 'location' | 'name'> & { quality?: number | null };

/** Who / what a reservation is for, and until when. At least a friend or a text. */
export interface HqReserveTarget {
  /** Free text ("Verkauf", "für die Crew"); may be empty when a friend is named. */
  note?: string;
  /** FriendEdgeRow.user_id of a current friend. */
  friendId?: string | null;
  /** ISO time from which the reservation frees its amount by itself; null/absent = open-ended. */
  expiresAt?: string | null;
}

/** The place the player was last seen at (hq_live_state.state.location). */
export interface HqLastLocation {
  name: string;
  system: string | null;
}

const KINDS_CHUNK = 400;

/** Reservation rows grouped by their stack key. */
function reservationsByStack(rows: readonly HqReservationRow[]): Map<string, HqStockReservation[]> {
  const out = new Map<string, HqStockReservation[]>();
  for (const r of rows) {
    const k = `${r.location}\u0000${r.name}\u0000${r.quality_key}`;
    const list = out.get(k) ?? [];
    list.push({ id: r.id, amount: Number(r.amount), note: r.note, at: r.created_at, friendId: r.friend_id, expiresAt: r.expires_at });
    out.set(k, list);
  }
  for (const list of out.values()) list.sort((a, b) => a.at.localeCompare(b.at));
  return out;
}

const stackKey = (i: Pick<HqInventoryItemRow, 'location' | 'name' | 'quality'>): string => `${i.location}\u0000${i.name}\u0000${i.quality ?? 0}`;

/**
 * Lager (D38/D39): inventory snapshots per place, their items, and where ships are stored.
 * Reads are RLS self-only. A manual entry ("liegt in …") writes source `manual`, touches only
 * its own item row and bumps the snapshot's `taken_at`.
 *
 * Bestand (migration 20261109000100): a row is one STACK per place, item and quality (`quality` null = unknown);
 * reservations live in `hq_inventory_reservations` and are merged into `row.reservations` on load; manual
 * removals are written to `hq_inventory_removals` and feed {@link lastRemovals}.
 */
@Injectable({ providedIn: 'root' })
export class HqInventoryService {
  private readonly sb = inject(SupabaseClientProvider);
  private readonly auth = inject(AuthService);

  readonly snapshots = signal<readonly HqInventorySnapshotRow[]>([]);
  readonly items = signal<readonly HqInventoryItemRow[]>([]);
  readonly shipStorage = signal<readonly HqShipStorageRow[]>([]);
  /** The caller's manual removals, newest first (feeds {@link lastRemovals}). */
  readonly removals = signal<readonly HqInventoryRemovalRow[]>([]);
  /** Reservations friends made FOR the caller (the friend's side of D2). */
  readonly friendReservations = signal<readonly HqFriendReservationRow[]>([]);
  /** Codex lane / sub-kind / ship role per lower-cased class name, filled by {@link ensureKinds}. */
  readonly kinds = signal<ReadonlyMap<string, BestandKind>>(new Map());
  readonly loading = signal(false);
  readonly loaded = signal(false);
  /** i18n key of the last failed load/save, never raw text. */
  readonly error = signal<string | null>(null);

  readonly locations = computed(() => groupLocations(this.snapshots(), this.items()));

  private inFlight: Promise<void> | null = null;
  private readonly kindsAsked = new Set<string>();

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
      const [s, i, st, rs, rm] = await Promise.all([
        c.from('hq_inventory_snapshots' as never).select('*').order('taken_at', { ascending: false }),
        c.from('hq_inventory_items' as never).select('*').order('name', { ascending: true }),
        c.from('hq_ship_storage' as never).select('*').order('taken_at', { ascending: false }),
        c.from('hq_inventory_reservations' as never).select('*').order('created_at', { ascending: true }),
        c.from('hq_inventory_removals' as never).select('*').order('at', { ascending: false }).limit(LAST_REMOVALS * 5),
      ]);
      if (s.error) throw s.error;
      if (i.error) throw i.error;
      if (st.error) throw st.error;
      // The two newer tables degrade to "nothing": a build running ahead of the migration still shows the stock.
      if (rs?.error) logWarn('hq', 'reservations load failed', rs.error);
      if (rm?.error) logWarn('hq', 'removals load failed', rm.error);
      const byStack = reservationsByStack(rs?.error ? [] : ((rs?.data ?? []) as unknown as HqReservationRow[]));
      this.snapshots.set((s.data ?? []) as unknown as HqInventorySnapshotRow[]);
      this.items.set(
        ((i.data ?? []) as unknown as HqInventoryItemRow[]).map((row) => ({
          ...row,
          quality: row.quality ?? null,
          reservations: byStack.get(stackKey(row)) ?? [],
        })),
      );
      this.shipStorage.set((st.data ?? []) as unknown as HqShipStorageRow[]);
      this.removals.set(rm?.error ? [] : ((rm?.data ?? []) as unknown as HqInventoryRemovalRow[]));
      this.loaded.set(true);
    } catch (err) {
      this.error.set(toErrorKey('hq', 'inventory.load', err));
    } finally {
      this.loading.set(false);
    }
  }

  /**
   * The last ten removals (manual ones included), newest first, independent of sessions: manual removals from
   * `hq_inventory_removals` plus the drops the desktop's replaced snapshots show in `events` (`HqLiveService.events()`).
   */
  lastRemovals(events: readonly Pick<HqLiveEventRow, 'id' | 'type' | 'at' | 'applied' | 'undone'>[] = [], limit: number = LAST_REMOVALS): Removal[] {
    return lastRemovals(this.removals(), events, this.items(), limit);
  }

  /** The place the player was last seen at (live state), null without a live signal. Entry default for manual rows. */
  async lastKnownLocation(): Promise<HqLastLocation | null> {
    try {
      const { data, error } = await this.sb.client.from('hq_live_state' as never).select('state').maybeSingle();
      if (error) throw error;
      return readLocation(((data as { state?: Record<string, unknown> } | null)?.state ?? null) as Record<string, unknown> | null);
    } catch (err) {
      logWarn('hq', 'last known location failed', err);
      return null;
    }
  }

  /**
   * Looks up the Codex lane (weapons / armor / ship / other), sub-kind and ship role of `classNames` once and keeps
   * them in {@link kinds}. Already asked names are not asked again; a failure is logged and retried on the next call.
   */
  async ensureKinds(classNames: readonly string[]): Promise<void> {
    const todo = [...new Set(classNames.map((c) => c.trim()).filter((c) => c && !this.kindsAsked.has(c.toLowerCase())))];
    if (!todo.length) return;
    for (const c of todo) this.kindsAsked.add(c.toLowerCase());
    try {
      const merged = new Map(this.kinds());
      for (let o = 0; o < todo.length; o += KINDS_CHUNK) {
        const { data, error } = await this.sb.client.rpc('hq_codex_kinds' as never, { p_class_names: todo.slice(o, o + KINDS_CHUNK) } as never);
        if (error) throw error;
        for (const [k, v] of kindsByClass((data ?? []) as unknown as HqCodexKindRow[])) merged.set(k, v);
      }
      this.kinds.set(merged);
    } catch (err) {
      for (const c of todo) this.kindsAsked.delete(c.toLowerCase());
      logWarn('hq', 'codex kinds failed', err);
    }
  }

  /** Reservations friends made for the caller (newest first); an empty list while the migration is missing. */
  async loadFriendReservations(): Promise<void> {
    try {
      const { data, error } = await this.sb.client.rpc('hq_reservations_for_me' as never);
      if (error) throw error;
      this.friendReservations.set(((data ?? []) as unknown as HqFriendReservationRow[]).map((r) => ({ ...r, amount: Number(r.amount) })));
    } catch (err) {
      logWarn('hq', 'friend reservations failed', err);
      this.friendReservations.set([]);
    }
  }

  /** The friend acknowledges reservations made for them (clears the "new" mark). */
  async markFriendReservationsSeen(ids: readonly string[]): Promise<boolean> {
    if (!ids.length) return true;
    try {
      const { error } = await this.sb.client.rpc('hq_reservations_mark_seen' as never, { p_ids: [...ids] } as never);
      if (error) throw error;
      this.friendReservations.update((l) => l.map((r) => (ids.includes(r.id) ? { ...r, seen: true } : r)));
      return true;
    } catch (err) {
      logWarn('hq', 'mark seen failed', err);
      return false;
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
          .insert(
            snap.items.map(({ quality, ...i }) => ({ user_id: userId, location: snap.location, ...i, ...(quality !== null ? { quality } : {}) })) as never,
          );
        if (ins.error) throw ins.error;
      }
      await this.load();
      return !this.error();
    } catch (err) {
      this.error.set(toErrorKey('hq', 'inventory.restore', err));
      return false;
    }
  }

  /** The stack `item` names at `location`. `quality` undefined = the first stack of that name/class. */
  private stackOf(location: string, item: string, classRef: string | null, quality?: number | null): HqInventoryItemRow | undefined {
    return this.items().find(
      (i) =>
        i.location === location &&
        (i.name === item.trim() || (!!classRef && i.class_name === classRef)) &&
        (quality === undefined || (i.quality ?? null) === quality),
    );
  }

  /** Adds `qty` to what already lies at `location` in the stack of that quality (addManual overwrites). */
  async addStock(location: string, item: string, qty: number, unit: 'pcs' | 'scu', classRef: string | null = null, origin: 'pledge' | 'ingame' | null = null, quality?: number | null): Promise<boolean> {
    const loc = location.trim();
    const have = this.stackOf(loc, item, classRef, quality);
    // One row holds one unit: an exact SCU amount must not land in a row counted in pieces. (A piece
    // count on an SCU row stays the stepper's old behaviour: it adds to the row's own unit.)
    if (have && unit === 'scu' && have.unit !== 'scu') return false;
    return this.addManual(loc, have?.name ?? item, roundQty((have?.qty ?? 0) + qty), have?.unit ?? unit, classRef ?? have?.class_name ?? null, origin, quality === undefined ? (have?.quality ?? null) : quality);
  }

  /** Takes `qty` back out of a place (undo of {@link addStock}); the row goes at zero. False on failure. No removal is logged. */
  async removeStock(location: string, item: string, qty: number, classRef: string | null = null, quality?: number | null): Promise<boolean> {
    const loc = location.trim();
    const have = this.stackOf(loc, item, classRef, quality);
    const userId = this.auth.user()?.id;
    if (!have || !userId) return false;
    if (roundQty(have.qty - qty) > 0) return this.addManual(loc, have.name, roundQty(have.qty - qty), have.unit, have.class_name, null, have.quality ?? null);
    this.error.set(null);
    try {
      const { error } = await this.sb.client
        .from('hq_inventory_items' as never)
        .delete()
        .eq('user_id', userId)
        .eq('location', loc)
        .eq('name', have.name)
        .eq('quality_key', have.quality ?? 0);
      if (error) throw error;
      await this.load();
      return !this.error();
    } catch (err) {
      this.error.set(toErrorKey('hq', 'inventory.remove', err));
      return false;
    }
  }

  // --- Counter (feedback #304): take out, correct, delete, reserve -------------------------------

  /** The row as loaded, by its key. Without `quality` the first stack of that name. */
  private rowOf(r: HqStackRef): HqInventoryItemRow | undefined {
    return this.items().find((i) => i.location === r.location && i.name === r.name && (r.quality === undefined || (i.quality ?? null) === r.quality));
  }

  /**
   * Writes a stack's new amount; `reservations` (when given) is the new list of its reservations - removed ones are
   * deleted, shrunk ones updated - before the amount changes, so the DB guard never sees more reserved than held;
   * new ones (no id) are inserted afterwards. qty 0 deletes the stack (its reservations go with it). A `removal` is
   * logged after the write (best effort).
   */
  private async writeRow(
    have: HqInventoryItemRow,
    qty: number,
    reservations: HqStockReservation[] | null,
    op: string,
    removal?: { kind: HqRemovalKind; amount: number },
  ): Promise<boolean> {
    const userId = this.auth.user()?.id;
    if (!userId || !Number.isFinite(qty) || qty < 0 || qty > HQ_QTY_MAX) return false;
    this.error.set(null);
    try {
      const c = this.sb.client;
      if (reservations && qty > 0) {
        const keep = new Map(reservations.filter((r) => r.id).map((r) => [r.id as string, r]));
        for (const old of reservationsOf(have)) {
          if (!old.id) continue;
          const next = keep.get(old.id);
          const res = !next
            ? await c.from('hq_inventory_reservations' as never).delete().eq('user_id', userId).eq('id', old.id)
            : next.amount !== old.amount
              ? await c.from('hq_inventory_reservations' as never).update({ amount: roundQty(next.amount) } as never).eq('user_id', userId).eq('id', old.id)
              : null;
          if (res?.error) throw res.error;
        }
      }
      const t = c.from('hq_inventory_items' as never);
      const { error } =
        qty <= 0
          ? await t.delete().eq('user_id', userId).eq('location', have.location).eq('name', have.name).eq('quality_key', have.quality ?? 0)
          : qty === have.qty
            ? { error: null }
            : await t.update({ qty: roundQty(qty) } as never).eq('user_id', userId).eq('location', have.location).eq('name', have.name).eq('quality_key', have.quality ?? 0);
      if (error) throw error;
      if (reservations && qty > 0) {
        for (const r of reservations.filter((x) => !x.id)) {
          const ins = await c.from('hq_inventory_reservations' as never).insert(this.reservationInsert(have, userId, r) as never);
          if (ins.error) throw ins.error;
        }
      }
      if (removal && removal.amount > 0) await this.logRemoval(userId, have, removal.amount, removal.kind);
      await this.load();
      return !this.error();
    } catch (err) {
      this.error.set(toErrorKey('hq', `inventory.${op}`, err));
      return false;
    }
  }

  private reservationInsert(have: HqInventoryItemRow, userId: string, r: HqStockReservation): Record<string, unknown> {
    return {
      user_id: userId,
      location: have.location,
      name: have.name,
      quality_key: have.quality ?? 0,
      amount: roundQty(r.amount),
      note: r.note.slice(0, RESERVATION_NOTE_MAX),
      friend_id: r.friendId ?? null,
      expires_at: r.expiresAt ?? null,
    };
  }

  /** D3: one row per manual removal so "zuletzt aufgebraucht" counts it. A failed log never fails the removal. */
  private async logRemoval(userId: string, have: HqInventoryItemRow, amount: number, kind: HqRemovalKind): Promise<void> {
    try {
      const { error } = await this.sb.client.from('hq_inventory_removals' as never).insert({
        user_id: userId,
        location: have.location,
        name: have.name,
        class_name: have.class_name,
        qty: roundQty(amount),
        unit: have.unit,
        quality: have.quality ?? null,
        kind,
      } as never);
      if (error) throw error;
    } catch (err) {
      logWarn('hq', 'removal log failed', err);
    }
  }

  /** Takes `amount` out of a row: free stock first, then the newest reservations shrink. 0 left = the row goes. */
  async takeOut(row: HqStackRef, amount: number, kind: Extract<HqRemovalKind, 'take' | 'reduce'> = 'take'): Promise<boolean> {
    const have = this.rowOf(row);
    if (!have || !(amount > 0)) return false;
    const before = reservationsOf(have);
    const next = takeOut(have.qty, before, amount);
    const changed = next.reservations.length !== before.length || next.reservations.some((r, i) => r.amount !== before[i].amount);
    return this.writeRow(have, next.qty, changed ? next.reservations : null, 'take', { kind, amount: Math.min(amount, have.qty) });
  }

  /** Correction: sets the row's amount; reservations above the new amount shrink (newest first). A reduction is logged as a removal. */
  async setAmount(row: HqStackRef, qty: number): Promise<boolean> {
    const have = this.rowOf(row);
    if (!have || !Number.isFinite(qty) || qty <= 0) return false;
    if (qty >= have.qty) return this.writeRow(have, qty, null, 'correct');
    return this.takeOut(row, roundQty(have.qty - qty), 'reduce');
  }

  /** Deletes the row from the list, its reservations with it. Logged as a removal of the whole amount. */
  async deleteRow(row: HqStackRef): Promise<boolean> {
    const have = this.rowOf(row);
    return have ? this.writeRow(have, 0, null, 'remove', { kind: 'delete', amount: have.qty }) : false;
  }

  /**
   * Reserves `amount` of the free stock. `target` is a free text (old form) or {@link HqReserveTarget} (friend, text,
   * expiry). False when neither a friend nor a text is given, the amount exceeds the free stock or the list is full.
   */
  async reserve(row: HqStackRef, amount: number, target: string | HqReserveTarget): Promise<boolean> {
    const have = this.rowOf(row);
    const t: HqReserveTarget = typeof target === 'string' ? { note: target } : target;
    const note = (t.note ?? '').trim().slice(0, RESERVATION_NOTE_MAX);
    if (!have || (!note && !t.friendId) || !(amount > 0) || amount > availableOf(have)) return false;
    const list = reservationsOf(have);
    if (list.length >= RESERVATIONS_MAX) return false;
    return this.writeRow(have, have.qty, [...list, { amount: roundQty(amount), note, at: new Date().toISOString(), friendId: t.friendId ?? null, expiresAt: t.expiresAt ?? null }], 'reserve');
  }

  /** Edits a stored reservation (amount, text, friend, expiry); `null` clears friend / expiry. The DB re-checks the stack and the friendship. */
  async updateReservation(row: HqStackRef, id: string, patch: { amount?: number } & HqReserveTarget): Promise<boolean> {
    const have = this.rowOf(row);
    const userId = this.auth.user()?.id;
    const cur = have ? reservationsOf(have).find((r) => r.id === id) : undefined;
    if (!have || !userId || !cur) return false;
    const amount = patch.amount ?? cur.amount;
    const note = patch.note !== undefined ? patch.note.trim().slice(0, RESERVATION_NOTE_MAX) : cur.note;
    const friendId = patch.friendId !== undefined ? patch.friendId : (cur.friendId ?? null);
    if (!(amount > 0) || amount > roundQty(availableOf(have) + cur.amount) || (!note && !friendId)) return false;
    this.error.set(null);
    try {
      const { error } = await this.sb.client
        .from('hq_inventory_reservations' as never)
        .update({ amount: roundQty(amount), note, friend_id: friendId, expires_at: patch.expiresAt !== undefined ? patch.expiresAt : (cur.expiresAt ?? null) } as never)
        .eq('user_id', userId)
        .eq('id', id);
      if (error) throw error;
      await this.load();
      return !this.error();
    } catch (err) {
      this.error.set(toErrorKey('hq', 'inventory.reserve', err));
      return false;
    }
  }

  /**
   * Ends reservation `index`: `handedOut` = it left the store (the amount goes out of the row, logged as a `handout`
   * removal), otherwise it is released back into the free stock.
   */
  async endReservation(row: HqStackRef, index: number, handedOut: boolean): Promise<boolean> {
    const have = this.rowOf(row);
    const list = have ? reservationsOf(have) : [];
    const r = list[index];
    if (!have || !r) return false;
    const rest = list.filter((_, i) => i !== index);
    return this.writeRow(have, handedOut ? roundQty(have.qty - r.amount) : have.qty, rest, handedOut ? 'handOut' : 'release', handedOut ? { kind: 'handout', amount: r.amount } : undefined);
  }

  /**
   * "liegt in …": put `qty` of `item` into `location` (source `manual`) as the stack of `quality` (null/absent =
   * unknown). Same place + item + quality overwrites that stack. False on invalid input or failure.
   */
  async addManual(location: string, item: string, qty: number, unit: 'pcs' | 'scu', classRef: string | null = null, origin: 'pledge' | 'ingame' | null = null, quality: number | null = null): Promise<boolean> {
    const loc = location.trim().slice(0, HQ_LOCATION_MAX);
    const name = item.trim().slice(0, HQ_ITEM_NAME_MAX);
    const q = Number(qty);
    const ql = parseQuality(quality);
    if (!loc || !name || !Number.isFinite(q) || q <= 0 || q > HQ_QTY_MAX) return false;
    const userId = this.auth.user()?.id;
    if (!userId) return false;
    this.error.set(null);
    try {
      const c = this.sb.client;
      const now = new Date().toISOString();
      const existing = this.snapshots().find((s) => s.location === loc);
      const stacks = new Set(this.items().filter((i) => i.location === loc).map(stackKey));
      stacks.add(`${loc}\u0000${name}\u0000${ql ?? 0}`);
      const snap = await c.from('hq_inventory_snapshots' as never).upsert(
        {
          user_id: userId,
          location: loc,
          source: existing?.source ?? 'manual',
          taken_at: now,
          item_count: Math.min(400, stacks.size),
        } as never,
        { onConflict: 'user_id,location' },
      );
      if (snap.error) throw snap.error;
      const row = await c
        .from('hq_inventory_items' as never)
        .upsert({ user_id: userId, location: loc, name, qty: q, unit, quality: ql, class_name: classRef?.trim().slice(0, 200) || null, ...(origin ? { origin } : {}) } as never, {
          onConflict: 'user_id,location,name,quality_key',
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
