import { Injectable, computed, inject, signal } from '@angular/core';
import { AuthService } from '../../auth/auth.service';
import { humanizeClassName } from '../../codex/codex-format';
import { toErrorKey } from '../../core/describe-error';
import { logWarn } from '../../core/log';
import { SupabaseClientProvider } from '../../core/supabase.client';
import { HangarService } from '../../hangar/hangar.service';
import { HqSupplyPackageRow } from '../data/hq-db.types';
import { newClientId } from '../data/hq-supplies-sync';
import { HqInventoryService } from '../data/hq-inventory.service';
import { WishlistStore } from '../data/wishlist.store';
import { HqSuppliesService, SupplyItem } from '../hq-supplies.service';
import { NachschubNamingService } from './nachschub-naming';
import {
  EvalLine,
  Evaluation,
  NACHSCHUB_NAME_MAX,
  Nachschub,
  OpenLine,
  WishPick,
  WishPosition,
  archive,
  clampName,
  clearNachschub,
  evaluateNachschub,
  freeSlot,
  fulfilWish,
  newNachschubBlock,
  positionKey,
  reactivate,
  takeFromWishlist,
  type NachschubType,
} from './nachschub.model';
import { archiveAtEventEnd, isEventNachschub } from '../events/event-nachschub';
import type { ResolvedEnd } from '../events/event-logic';

/** Outcome of a Nachschub write. `key` is an i18n key (`hq.nachschub.done.*` on success, `errors.*` / `hq.nachschub.*` on failure). */
export interface NachschubResult {
  readonly ok: boolean;
  readonly key: string;
  readonly id?: string;
  readonly params?: Record<string, string | number>;
  /** Present where the checklist asks for an undo. Resolves to the result of the undo. */
  readonly undo?: () => Promise<NachschubResult>;
}

/** Binds a new Nachschub to an event (type event with rewards, sightseeing without). */
export interface EventBinding {
  readonly type: Exclude<NachschubType, 'normal'>;
  readonly eventId: string;
  readonly name: string;
  readonly rewards: readonly { name: string; className: string; ship: boolean }[];
}

const fail = (key: string): NachschubResult => ({ ok: false, key });

/**
 * The Nachschub slots (`hq_supply_packages`) and every transition between wishlist, Nachschub and stock
 * (concept 20261107-1410-nachschub-hq). Rules live in `nachschub.model.ts`; this service reads the stores, calls them
 * and persists the outcome. Owner-only RLS, up to 7 active slots (a partial unique index backs that up server-side).
 *
 *   ensureLoaded()                          load the user's Nachschuebe once
 *   createFromWishlist({ picks, name? })    take wishlist positions (full qty by default, split allowed) into a new Nachschub
 *   rename(id, name) / reactivate(id)
 *   empty(id, backToWishlist) / remove(id, backToWishlist)   open lines go back to the wishlist (counted up) or are dropped
 *   reconcile()                             close lines whose stock rose vs the snapshot, archive finished Nachschuebe
 *   evaluation(id)                          status per line / progress of one Nachschub
 *   fulfilWish(kind, className, gained)     owning fulfils the wish; result carries the undo
 */
@Injectable({ providedIn: 'root' })
export class NachschubService {
  private readonly sb = inject(SupabaseClientProvider);
  private readonly auth = inject(AuthService);
  private readonly supplies = inject(HqSuppliesService);
  private readonly wish = inject(WishlistStore);
  private readonly inventory = inject(HqInventoryService);
  private readonly hangar = inject(HangarService);
  private readonly naming = inject(NachschubNamingService);

  readonly packages = signal<readonly Nachschub[]>([]);
  readonly loaded = signal(false);
  /** i18n key of the last failed load, never raw text. */
  readonly error = signal<string | null>(null);

  readonly active = computed(() =>
    this.packages().filter((n) => n.status === 'active').sort((a, b) => (a.slot ?? 99) - (b.slot ?? 99)),
  );
  readonly archived = computed(() =>
    this.packages().filter((n) => n.status === 'archived').sort((a, b) => (b.archivedAt ?? '').localeCompare(a.archivedAt ?? '')),
  );
  /** i18n key explaining why "Neuer Nachschub" is blocked, else null. */
  readonly newBlock = computed(() => newNachschubBlock(this.packages()));

  private loadedFor: string | null = null;
  private inFlight: Promise<void> | null = null;

  ensureLoaded(): Promise<void> {
    const uid = this.auth.user()?.id ?? null;
    if (!uid) {
      this.packages.set([]);
      this.loadedFor = null;
      this.loaded.set(false);
      return Promise.resolve();
    }
    if (this.loadedFor === uid) return this.inFlight ?? Promise.resolve();
    this.loadedFor = uid;
    this.inFlight = (async () => {
      try {
        const { data, error } = await this.sb.client
          .from('hq_supply_packages' as never)
          .select('*')
          .is('deleted_at', null)
          .order('created_at', { ascending: true });
        if (this.loadedFor !== uid) return;
        if (error) throw error;
        this.packages.set(((data ?? []) as unknown as HqSupplyPackageRow[]).map(fromRow));
        this.loaded.set(true);
        this.error.set(null);
      } catch (err) {
        if (this.loadedFor === uid) this.loadedFor = null;
        logWarn('nachschub', 'load failed', err);
        this.error.set(toErrorKey('nachschub', 'load', err));
      } finally {
        this.inFlight = null;
      }
    })();
    return this.inFlight;
  }

  // ------------------------------------------------------------------------------------------------ reading

  /** Everything on the wishlist as model positions: store rows plus the Hangar's wished ships. */
  wishPositions(): readonly WishPosition[] {
    const rows: WishPosition[] = this.wish.rows().map((r) => ({
      kind: r.kind,
      className: r.className,
      name: r.name,
      qty: r.qty,
      forClassName: r.forClassName || null,
    }));
    for (const s of this.hangar.ships()) {
      if (s.status === 'wishlist') rows.push({ kind: 'ship', className: s.shipClassName, name: s.customName, qty: s.qty ?? 1 });
    }
    return rows;
  }

  linesOf(id: string): SupplyItem[] {
    return this.supplies.linesOfPackage(id);
  }

  /** Status per line, baselines and progress of one Nachschub against the current stock. */
  evaluation(id: string): Evaluation | null {
    const n = this.packages().find((p) => p.id === id);
    if (!n) return null;
    return evaluateNachschub(this.linesOf(id).map(toEvalLine), n.snapshot, (l) => this.ownedOf(l));
  }

  /** Inventar quantity of a class over all places, or Hangar copies for a ship line. */
  ownedOf(l: Pick<EvalLine, 'ship' | 'className'>): number {
    const cls = (l.className ?? '').toLowerCase();
    if (!cls) return 0;
    if (l.ship) {
      const s = this.hangar.ships().find((x) => x.shipClassName.toLowerCase() === cls);
      return s && s.status === 'owned' ? (s.qty ?? 1) : 0;
    }
    return this.inventory.items().reduce((n, i) => ((i.class_name ?? '').toLowerCase() === cls ? n + Number(i.qty) : n), 0);
  }

  // ------------------------------------------------------------------------------------------------ writing

  /**
   * "Neuer Nachschub": take wishlist positions into a fresh Nachschub in the lowest free slot. A pick without `qty`
   * takes the full quantity; a smaller `qty` splits and the rest stays on the wishlist. Undo puts it all back.
   */
  async createFromWishlist(opts: { picks: readonly WishPick[]; name?: string; event?: EventBinding }): Promise<NachschubResult> {
    const uid = this.auth.user()?.id;
    if (!uid) return fail('errors.generic');
    await this.ensureLoaded();
    const slot = freeSlot(this.packages());
    if (slot === null) return fail('hq.nachschub.slotsFull');
    const before = this.wishPositions();
    const { taken, remaining } = takeFromWishlist(before, opts.picks);
    if (!taken.length && !opts.event) return fail('hq.nachschub.nothingPicked');

    const id = newClientId();
    const label = (p: WishPosition): string => p.name?.trim() || humanizeClassName(p.className);
    const name = clampName(opts.name?.trim() || (await this.naming.nachschubName(taken.map((p) => ({ name: label(p), qty: p.qty })))) || opts.event?.name || '', NACHSCHUB_NAME_MAX);

    const lineIds: string[] = [];
    const snapshot: Record<string, number> = {};
    for (const p of taken) {
      const added = this.supplies.addLine(label(p), p.qty, {
        entityKind: p.kind,
        className: p.className,
        forClassName: p.forClassName ?? null,
        packageId: id,
        source: 'search',
      });
      if (!added) continue;
      lineIds.push(added.id);
      snapshot[added.id] = this.ownedOf({ ship: p.kind === 'ship', className: p.className });
    }
    // Rewards of the chosen event are lines of their own (they close when the claimed reward lands in Bestand).
    for (const r of opts.event?.rewards ?? []) {
      const added = this.supplies.addLine(r.name, 1, { entityKind: r.ship ? 'ship' : 'item', className: r.className, packageId: id, source: 'search' });
      if (!added) continue;
      lineIds.push(added.id);
      snapshot[added.id] = this.ownedOf({ ship: r.ship, className: r.className });
    }
    const now = new Date().toISOString();
    const pkg: Nachschub = { id, name, status: 'active', slot, snapshot, createdAt: now, archivedAt: null, ...(opts.event ? { type: opts.event.type, eventId: opts.event.eventId } : {}) };
    if (!(await this.save(pkg, uid))) {
      this.supplies.removeMany(lineIds);
      return fail(this.error() ?? 'errors.generic');
    }
    this.packages.update((ps) => [...ps, pkg]);
    await this.applyRemaining(before, remaining);
    return {
      ok: true,
      key: 'hq.nachschub.done.created',
      id,
      params: { name },
      undo: async () => {
        for (const l of lineIds) this.supplies.remove(l);
        await this.drop(id, uid);
        await this.restoreWishlist(before);
        return { ok: true, key: 'hq.nachschub.done.undone' };
      },
    };
  }

  /**
   * "Bearbeiten" > add: take more wishlist positions into an existing active Nachschub (same rules as
   * {@link createFromWishlist}). Undo takes them out again and restores the wishlist.
   */
  async addFromWishlist(id: string, picks: readonly WishPick[]): Promise<NachschubResult> {
    const uid = this.auth.user()?.id;
    const n = this.packages().find((p) => p.id === id && p.status === 'active');
    if (!uid || !n) return fail('errors.generic');
    const before = this.wishPositions();
    const { taken, remaining } = takeFromWishlist(before, picks);
    if (!taken.length) return fail('hq.nachschub.nothingPicked');
    const label = (p: WishPosition): string => p.name?.trim() || humanizeClassName(p.className);
    const lineIds: string[] = [];
    const snapshot: Record<string, number> = { ...n.snapshot };
    for (const p of taken) {
      const added = this.supplies.addLine(label(p), p.qty, {
        entityKind: p.kind,
        className: p.className,
        forClassName: p.forClassName ?? null,
        packageId: id,
        source: 'search',
      });
      if (!added) continue;
      lineIds.push(added.id);
      snapshot[added.id] = this.ownedOf({ ship: p.kind === 'ship', className: p.className });
    }
    if (!(await this.replace({ ...n, snapshot }, uid))) {
      this.supplies.removeMany(lineIds);
      return fail(this.error() ?? 'errors.generic');
    }
    await this.applyRemaining(before, remaining);
    return {
      ok: true,
      key: 'hq.nachschub.done.added',
      id,
      undo: async () => {
        this.supplies.removeMany(lineIds);
        await this.restoreWishlist(before);
        return { ok: true, key: 'hq.nachschub.done.undone' };
      },
    };
  }

  /** "Bearbeiten" > remove one line: it goes back to the wishlist (counted up there) or is dropped. */
  async removeLine(lineId: string, backToWishlist: boolean): Promise<NachschubResult> {
    const l = this.supplies.items().find((x) => x.id === lineId);
    if (!l) return fail('errors.generic');
    const owner = this.packages().find((p) => p.id === l.packageId);
    if (owner && isEventNachschub(owner)) backToWishlist = false;
    const before = this.wishPositions();
    const out = clearNachschub(
      l.className ? [{ id: l.id, kind: l.entityKind ?? 'item', className: l.className, name: l.name, qty: l.qty, forClassName: l.forClassName, closed: l.done }] : [],
      before,
      backToWishlist,
    );
    this.supplies.removeMany([l.id]);
    if (backToWishlist) await this.restoreWishlist(out.wishlist);
    return {
      ok: true,
      key: 'hq.nachschub.done.lineRemoved',
      undo: async () => {
        this.supplies.restore(l.id);
        if (backToWishlist) await this.restoreWishlist(before);
        return { ok: true, key: 'hq.nachschub.done.undone' };
      },
    };
  }

  async rename(id: string, name: string): Promise<boolean> {
    const uid = this.auth.user()?.id;
    const n = this.packages().find((p) => p.id === id);
    const clean = clampName(name, NACHSCHUB_NAME_MAX);
    if (!uid || !n || !clean) return false;
    return this.replace({ ...n, name: clean }, uid);
  }

  /** Bring an archived Nachschub back when a slot is free. */
  async reactivate(id: string): Promise<NachschubResult> {
    const uid = this.auth.user()?.id;
    const back = reactivate(this.packages(), id);
    if (!uid) return fail('errors.generic');
    if (!back) return fail('hq.nachschub.slotsFull');
    return (await this.replace(back, uid)) ? { ok: true, key: 'hq.nachschub.done.reactivated', id } : fail(this.error() ?? 'errors.generic');
  }

  /** "Nachschub leeren": open lines leave (back to the wishlist when asked), closed ones stay as history. */
  async empty(id: string, backToWishlist: boolean): Promise<NachschubResult> {
    const n = this.packages().find((p) => p.id === id);
    if (!n) return fail('errors.generic');
    // An event Nachschub keeps its progress and NEVER sends lines back to the wishlist (C9).
    if (isEventNachschub(n)) backToWishlist = false;
    const ev = this.evaluation(id);
    const lines = this.linesOf(id);
    const open: OpenLine[] = lines.map((l) => ({
      id: l.id,
      kind: l.entityKind ?? 'item',
      className: l.className ?? '',
      name: l.name,
      qty: l.qty,
      forClassName: l.forClassName,
      closed: l.done || (ev?.statuses.get(l.id)?.closed ?? false),
    }));
    const before = this.wishPositions();
    const out = clearNachschub(open.filter((l) => l.className), before, backToWishlist);
    this.supplies.removeMany(out.removeIds);
    if (backToWishlist) await this.restoreWishlist(out.wishlist);
    return {
      ok: true,
      key: 'hq.nachschub.done.emptied',
      id,
      undo: async () => {
        for (const l of out.removeIds) this.supplies.restore(l);
        if (backToWishlist) await this.restoreWishlist(before);
        return { ok: true, key: 'hq.nachschub.done.undone' };
      },
    };
  }

  /** Delete a Nachschub with its open lines; with `backToWishlist` they are counted up on the wishlist first. */
  async remove(id: string, backToWishlist: boolean): Promise<NachschubResult> {
    const uid = this.auth.user()?.id;
    const n = this.packages().find((p) => p.id === id);
    if (!uid || !n) return fail('errors.generic');
    const emptied = await this.empty(id, backToWishlist);
    // The closed lines of a deleted Nachschub go too (they belong to it).
    const rest = this.linesOf(id).map((l) => l.id);
    this.supplies.removeMany(rest);
    await this.drop(id, uid);
    return {
      ok: true,
      key: 'hq.nachschub.done.removed',
      id,
      undo: async () => {
        for (const l of rest) this.supplies.restore(l);
        await emptied.undo?.();
        await this.save(n, uid);
        this.packages.update((ps) => [...ps, n]);
        return { ok: true, key: 'hq.nachschub.done.undone' };
      },
    };
  }

  /** Persist a changed Nachschub (the event services use this). */
  async update(next: Nachschub): Promise<boolean> {
    const uid = this.auth.user()?.id;
    return uid ? this.replace(next, uid) : false;
  }

  /** An event Nachschub archives itself at its OFFICIAL end (C12); an estimate never does. */
  async applyEventEnds(ends: ReadonlyMap<string, ResolvedEnd>, nowMs: number): Promise<void> {
    const at = new Date(nowMs).toISOString();
    const next = archiveAtEventEnd(this.packages(), ends, nowMs, at);
    for (const n of next) {
      const before = this.packages().find((p) => p.id === n.id);
      if (before && before !== n) await this.update(n);
    }
  }

  /**
   * One pass over all active Nachschuebe: lines whose stock rose past the snapshot are ticked, baselines are stored,
   * a Nachschub with every line closed archives itself and frees its slot. Call after inventory / hangar changes.
   */
  async reconcile(): Promise<void> {
    const uid = this.auth.user()?.id;
    if (!uid || !this.loaded()) return;
    for (const n of this.active()) {
      const ev = this.evaluation(n.id);
      if (!ev) continue;
      for (const lid of ev.closeIds) this.supplies.setDone(lid, true);
      let next: Nachschub = ev.snapshotChanged ? { ...n, snapshot: ev.snapshot } : n;
      if (ev.finished) next = archive(next, new Date().toISOString());
      if (next !== n) await this.replace(next, uid);
    }
  }

  /**
   * Owning fulfils the wish: `gained` copies landed in Inventar / Hangar, so the wished quantity of that class shrinks
   * (to zero = the wish goes). The result carries the undo.
   */
  async fulfilWish(kind: string, className: string, gained: number): Promise<NachschubResult> {
    const wished = this.wishPositions().find((p) => p.kind === kind && p.className.toLowerCase() === className.toLowerCase() && !p.forClassName);
    if (!wished) return { ok: true, key: 'hq.nachschub.done.nothingWished' };
    const r = fulfilWish(wished.qty, gained);
    await this.setWishQty(wished, r.qty);
    return {
      ok: true,
      key: 'hq.nachschub.done.fulfilled',
      undo: async () => {
        await this.setWishQty(wished, r.previous);
        return { ok: true, key: 'hq.nachschub.done.undone' };
      },
    };
  }

  // ------------------------------------------------------------------------------------------------ internals

  /** Set a wishlist position to an absolute quantity (0 removes it), whichever store holds it. */
  private async setWishQty(p: WishPosition, qty: number): Promise<void> {
    if (p.kind === 'ship') {
      const s = this.hangar.shipByClassName(p.className);
      if (qty <= 0) {
        if (s?.status === 'wishlist') await this.hangar.removeShip(s.id);
      } else if (s?.status === 'wishlist') {
        await this.hangar.updateShip(s.id, { qty });
      } else if (!s) {
        const added = await this.hangar.addShip(p.className, 'wishlist');
        if (added && qty > 1) await this.hangar.updateShip(added.id, { qty });
      }
      return;
    }
    await this.wish.setQty({ kind: p.kind, className: p.className, name: p.name, forClassName: p.forClassName }, qty);
  }

  /** Make the wishlist show `target`: every position of it gets its quantity, positions not in it go. */
  private async restoreWishlist(target: readonly WishPosition[]): Promise<void> {
    const want = new Map(target.map((p) => [positionKey(p), p] as const));
    const have = this.wishPositions();
    for (const h of have) if (!want.has(positionKey(h))) await this.setWishQty(h, 0);
    for (const [, p] of want) {
      if (have.find((h) => positionKey(h) === positionKey(p))?.qty !== p.qty) await this.setWishQty(p, p.qty);
    }
  }

  private async applyRemaining(before: readonly WishPosition[], remaining: readonly WishPosition[]): Promise<void> {
    const left = new Map(remaining.map((p) => [positionKey(p), p.qty] as const));
    for (const b of before) {
      const q = left.get(positionKey(b)) ?? 0;
      if (q !== b.qty) await this.setWishQty(b, q);
    }
  }

  private async replace(next: Nachschub, uid: string): Promise<boolean> {
    if (!(await this.save(next, uid))) return false;
    this.packages.update((ps) => ps.map((p) => (p.id === next.id ? next : p)));
    return true;
  }

  private async save(n: Nachschub, uid: string): Promise<boolean> {
    try {
      const { error } = await this.sb.client
        .from('hq_supply_packages' as never)
        .upsert(
          {
            user_id: uid,
            id: n.id,
            name: n.name,
            status: n.status,
            slot: n.slot,
            snapshot: n.snapshot,
            archived_at: n.archivedAt,
            type: n.type ?? 'normal',
            event_id: n.eventId ?? null,
            deleted_at: null,
            updated_at: new Date().toISOString(),
          } as never,
          { onConflict: 'user_id,id' },
        );
      if (error) throw error;
      return true;
    } catch (err) {
      logWarn('nachschub', 'save failed', err);
      this.error.set(toErrorKey('nachschub', 'save', err));
      return false;
    }
  }

  /** Tombstone a Nachschub (the row stays for the purge job and other devices). */
  private async drop(id: string, uid: string): Promise<void> {
    try {
      const now = new Date().toISOString();
      const { error } = await this.sb.client
        .from('hq_supply_packages' as never)
        .update({ deleted_at: now, updated_at: now } as never)
        .eq('user_id', uid)
        .eq('id', id);
      if (error) throw error;
      this.packages.update((ps) => ps.filter((p) => p.id !== id));
    } catch (err) {
      logWarn('nachschub', 'delete failed', err);
      this.error.set(toErrorKey('nachschub', 'delete', err));
    }
  }
}

function toEvalLine(l: SupplyItem): EvalLine {
  return { id: l.id, need: l.amount ?? l.qty, ticked: l.done, ship: l.entityKind === 'ship', className: l.className };
}

function fromRow(r: HqSupplyPackageRow): Nachschub {
  const snap: Record<string, number> = {};
  for (const [k, v] of Object.entries(r.snapshot ?? {})) if (typeof v === 'number' && Number.isFinite(v)) snap[k] = v;
  return {
    id: r.id,
    name: r.name,
    status: r.status === 'archived' ? 'archived' : 'active',
    slot: r.status === 'archived' ? null : r.slot,
    snapshot: snap,
    createdAt: r.created_at,
    archivedAt: r.archived_at,
    type: r.type === 'event' || r.type === 'sightseeing' ? r.type : 'normal',
    eventId: r.event_id ?? null,
  };
}
