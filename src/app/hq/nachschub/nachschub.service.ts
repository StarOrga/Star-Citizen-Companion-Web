import { Injectable, computed, inject, signal } from '@angular/core';
import { AuthService } from '../../auth/auth.service';
import { humanizeClassName } from '../../codex/codex-format';
import { toErrorKey } from '../../core/describe-error';
import { logWarn } from '../../core/log';
import { SupabaseClientProvider } from '../../core/supabase.client';
import { SearchWishlistService } from '../../codex/search/search-wishlist.service';
import { HangarService } from '../../hangar/hangar.service';
import { HqSupplyPackageRow } from '../data/hq-db.types';
import { newClientId } from '../data/hq-supplies-sync';
import { HqInventoryService } from '../data/hq-inventory.service';
import { WishlistStore } from '../data/wishlist.store';
import { AddedLine, HqSuppliesService, SupplyItem } from '../hq-supplies.service';
import { NachschubNamingService } from './nachschub-naming';
import { stockQtyOf } from './nachschub-stock';
import {
  EvalLine,
  Evaluation,
  NACHSCHUB_NAME_MAX,
  Nachschub,
  OpenLine,
  RisePool,
  WISH_QTY_MAX,
  WishPick,
  WishPosition,
  archive,
  clampName,
  clearNachschub,
  evaluateNachschub,
  freeSlot,
  newNachschubBlock,
  positionKey,
  reactivate,
  takeFromWishlist,
  type NachschubLineInput,
  type NachschubType,
  parseSellGoal,
} from './nachschub.model';
import { archiveAtEventEnd, clearEventNachschub, isEventNachschub, rewardWishes, wishlistAfterClaim } from '../events/event-nachschub';
import type { EventReward } from '../events/event-sheet';
import type { ResolvedEnd } from '../events/event-logic';

/** Outcome of a Nachschub write. `key` is an i18n key (`hq.nachschub.done.*` on success, `errors.*` / `hq.nachschub.*` on failure). */
export interface NachschubResult {
  readonly ok: boolean;
  readonly key: string;
  readonly id?: string;
  readonly params?: Record<string, string | number>;
  /** A success that comes with a caveat the reader must see (a wish capped at 999, lines that did not fit). */
  readonly warn?: { readonly key: string; readonly params?: Record<string, string | number> };
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
const UNDONE: NachschubResult = { ok: true, key: 'hq.nachschub.done.undone' };

/** What a package write came to: `conflict` = unique violation (the slot was taken elsewhere), `gone` = the row is deleted. */
type Outcome = 'ok' | 'conflict' | 'gone' | 'failed';

/** One wishlist change that really happened (`delta` is what the position's quantity moved by). */
interface Shift {
  readonly p: WishPosition;
  readonly delta: number;
}

interface ShiftResult {
  readonly ok: boolean;
  /** Wished quantity that did not fit under the 999 cap (merging back to the wishlist). */
  readonly lost: number;
  /** The changes made - the exact inverse of these is the undo. */
  readonly applied: readonly Shift[];
}

/** A wishlist position that became (or grew) a line. */
interface AddedPick {
  readonly p: WishPosition;
  readonly line: AddedLine;
}

const asPicks = (lines: readonly AddedLine[]): Pick<AddedPick, 'line'>[] => lines.map((line) => ({ line }));
const capWarn = (lost: number): NachschubResult['warn'] => (lost > 0 ? { key: 'hq.nachschub.wishCapped', params: { count: lost } } : undefined);
const inverse = (applied: readonly Shift[]): Shift[] => [...applied].reverse().map((a) => ({ p: a.p, delta: -a.delta }));

/**
 * The Nachschub slots (`hq_supply_packages`) and every transition between wishlist, Nachschub and stock
 * (concept 20261107-1410-nachschub-hq). Rules live in `nachschub.model.ts`; this service reads the stores, calls them
 * and persists the outcome. Owner-only RLS, up to 7 active slots (a partial unique index backs that up server-side).
 *
 *   ensureLoaded()                          load the user's Nachschuebe once; reload() refreshes them
 *   createFromWishlist({ picks, name? })    take wishlist positions (full qty by default, split allowed) into a new Nachschub
 *   rename(id, name) / reactivate(id)
 *   empty(id, backToWishlist) / remove(id, backToWishlist)   open lines go back to the wishlist (counted up) or are dropped
 *   reconcile()                             close lines whose stock rose vs the snapshot, archive finished Nachschuebe
 *   evaluation(id)                          status per line / progress of one Nachschub
 *
 * Rules every write follows (audit bundle B2):
 *  - Wishlist changes are DELTAS (take out what moved, add back what returned), never "restore the old full list", so
 *    an undo only reverts its own change and a wish added meanwhile survives. A failed wishlist write rolls the rest back.
 *  - A package write sends only the columns that changed and never revives a deleted row; a stale tab learns about it
 *    ('gone') instead of resurrecting the row. A slot taken elsewhere (unique violation) is retried with the next free one.
 *  - A baseline is never taken from stock that has not loaded; reconcile waits for it.
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
  private readonly searchWish = inject(SearchWishlistService);

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

  /** Status of every active Nachschub, evaluated oldest first with ONE shared rise pool (a stock gain closes one line per class). */
  private readonly evals = computed(() => {
    const out = new Map<string, Evaluation>();
    const pool: RisePool = new Map();
    const oldestFirst = [...this.active()].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    for (const n of oldestFirst) out.set(n.id, evaluateNachschub(this.linesOf(n.id).map(toEvalLine), n.snapshot, (l) => this.ownedOf(l), pool));
    return out;
  });

  private loadedFor: string | null = null;
  private inFlight: Promise<void> | null = null;
  private stockOk = false;
  private stockLoad: Promise<boolean> | null = null;
  private reconciling = false;
  private reconcileAgain = false;

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
        if (!(await this.fetchPackages(uid, true)) && this.loadedFor === uid) this.loadedFor = null;
      } finally {
        this.inFlight = null;
      }
    })();
    return this.inFlight;
  }

  /** Pull the user's Nachschuebe again (another tab or device may have changed them). False when it failed; the list stays as it was. */
  reload(): Promise<boolean> {
    const uid = this.auth.user()?.id ?? null;
    return uid ? this.fetchPackages(uid, false) : Promise.resolve(false);
  }

  private async fetchPackages(uid: string, reportError: boolean): Promise<boolean> {
    try {
      const { data, error } = await this.sb.client
        .from('hq_supply_packages' as never)
        .select('*')
        .is('deleted_at', null)
        .order('created_at', { ascending: true });
      if (this.auth.user()?.id !== uid) return false;
      if (error) throw error;
      this.packages.set(((data ?? []) as unknown as HqSupplyPackageRow[]).map(fromRow));
      this.loaded.set(true);
      this.error.set(null);
      return true;
    } catch (err) {
      logWarn('nachschub', 'load failed', err);
      if (reportError) this.error.set(toErrorKey('nachschub', 'load', err));
      return false;
    }
  }

  /**
   * Inventar and Hangar loaded without an error. A baseline taken from stock that is not there yet would be 0 and
   * the line would close the moment the stock arrives, so every baseline (and reconcile) waits for this.
   */
  ensureStock(): Promise<boolean> {
    if (this.stockOk) return Promise.resolve(true);
    this.stockLoad ??= (async () => {
      try {
        await Promise.all([this.inventory.load(), this.hangar.loadAll()]);
        this.stockOk = this.inventory.loaded() && !this.inventory.error() && !this.hangar.error();
        return this.stockOk;
      } catch (err) {
        logWarn('nachschub', 'stock load failed', err);
        return false;
      } finally {
        this.stockLoad = null;
      }
    })();
    return this.stockLoad;
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
    const shared = this.evals().get(id);
    if (shared) return shared;
    const n = this.packages().find((p) => p.id === id);
    return n ? evaluateNachschub(this.linesOf(id).map(toEvalLine), n.snapshot, (l) => this.ownedOf(l)) : null;
  }

  /** Inventar quantity of a class over all places (see {@link stockQtyOf}), or Hangar copies for a ship line. */
  ownedOf(l: Pick<EvalLine, 'ship' | 'className'>): number {
    const cls = (l.className ?? '').toLowerCase();
    if (!cls) return 0;
    if (l.ship) {
      const s = this.hangar.ships().find((x) => x.shipClassName.toLowerCase() === cls);
      return s && s.status === 'owned' ? (s.qty ?? 1) : 0;
    }
    return stockQtyOf(this.inventory.items(), cls);
  }

  // ------------------------------------------------------------------------------------------------ writing

  /**
   * "Neuer Nachschub": take wishlist positions into a fresh Nachschub in the lowest free slot. A pick without `qty`
   * takes the full quantity; a smaller `qty` splits and the rest stays on the wishlist. Only positions that really
   * got a line leave the wishlist; with no line at all nothing is saved. Undo puts back exactly what was taken.
   */
  async createFromWishlist(opts: { picks: readonly WishPick[]; name?: string; event?: EventBinding }): Promise<NachschubResult> {
    const uid = this.auth.user()?.id;
    if (!uid) return fail('errors.generic');
    await this.ensureLoaded();
    await this.reload(); // another tab may have taken a slot or freed one
    const slot = freeSlot(this.packages());
    if (slot === null) return fail('hq.nachschub.slotsFull');
    const { taken } = takeFromWishlist(this.wishPositions(), opts.picks);
    if (!taken.length && !opts.event) return fail('hq.nachschub.nothingPicked');
    const stock = await this.ensureStock();

    const id = newClientId();
    const label = (p: WishPosition): string => p.name?.trim() || humanizeClassName(p.className);
    const name = clampName(opts.name?.trim() || (await this.naming.nachschubName(taken.map((p) => ({ name: label(p), qty: p.qty })))) || opts.event?.name || '', NACHSCHUB_NAME_MAX);

    const lines: AddedPick[] = [];
    const snapshot: Record<string, number> = {};
    let skipped = 0;
    for (const p of taken) {
      const added = this.addPick(p, id, label(p));
      if (!added) {
        skipped++;
        continue;
      }
      lines.push(added);
      // No baseline from unloaded stock: a line without one is filled by the first reconcile after the stock loaded.
      if (stock) snapshot[added.line.id] = this.ownedOf({ ship: p.kind === 'ship', className: p.className });
    }
    // Rewards of the chosen event are lines of their own (they close when the claimed reward lands in Bestand).
    const rewardLines = this.addRewardLines(opts.event?.rewards ?? [], id, snapshot);
    // Nothing fit (the line list is full): no empty Nachschub that would hold a slot for ever. An event Nachschub
    // may have no line at all (sightseeing, or only rewards).
    if (taken.length && !lines.length && !rewardLines.length) return fail('hq.nachschub.linesFull');
    const lineIds = [...lines.map((x) => x.line.id), ...rewardLines.map((l) => l.id)];

    const now = new Date().toISOString();
    const saved = await this.insertNew(
      { id, name, status: 'active', slot, snapshot, createdAt: now, archivedAt: null, ...(opts.event ? { type: opts.event.type, eventId: opts.event.eventId } : {}) },
      uid,
    );
    if (!saved) {
      this.undoPicks([...lines, ...asPicks(rewardLines)]);
      return fail(this.error() ?? 'errors.generic');
    }
    const took = await this.shiftWishes(lines.map((x) => ({ p: x.p, delta: -x.p.qty })));
    if (!took.ok) {
      this.undoPicks([...lines, ...asPicks(rewardLines)]);
      await this.drop(id, uid);
      return fail('hq.nachschub.wishlistFailed');
    }
    return {
      ok: true,
      key: 'hq.nachschub.done.created',
      id,
      params: { name },
      warn: skipped > 0 ? { key: 'hq.nachschub.partial', params: { count: skipped } } : undefined,
      undo: async () => {
        if (!(await this.drop(id, uid))) return fail(this.error() ?? 'errors.generic');
        this.supplies.removeMany(lineIds);
        const back = await this.shiftWishes(inverse(took.applied));
        return back.ok ? { ...UNDONE, warn: capWarn(back.lost) } : fail('hq.nachschub.wishlistFailed');
      },
    };
  }

  /**
   * "Bearbeiten" > add: take more wishlist positions into an existing active Nachschub (same rules as
   * {@link createFromWishlist}). A pick that lands on a line already there raises it and keeps its baseline; undo
   * lowers it back to its previous quantity and only removes lines this call created.
   */
  async addFromWishlist(id: string, picks: readonly WishPick[], eventRewards: EventBinding['rewards'] = []): Promise<NachschubResult> {
    const uid = this.auth.user()?.id;
    const n = this.packages().find((p) => p.id === id && p.status === 'active');
    if (!uid || !n) return fail('errors.generic');
    const { taken } = takeFromWishlist(this.wishPositions(), picks);
    if (!taken.length && !eventRewards.length) return fail('hq.nachschub.nothingPicked');
    const stock = await this.ensureStock();
    const label = (p: WishPosition): string => p.name?.trim() || humanizeClassName(p.className);
    const lines: AddedPick[] = [];
    const snapshot: Record<string, number> = { ...n.snapshot };
    let skipped = 0;
    let newBaselines = false;
    for (const p of taken) {
      const added = this.addPick(p, id, label(p));
      if (!added) {
        skipped++;
        continue;
      }
      lines.push(added);
      // Only a NEW line gets a baseline; a line that was already there keeps its own (its progress stays).
      if (added.line.prevQty === 0 && stock) {
        snapshot[added.line.id] = this.ownedOf({ ship: p.kind === 'ship', className: p.className });
        newBaselines = true;
      }
    }
    // Rewards of an event added while editing become reward lines too, exactly like on creation.
    const rewardLines = this.addRewardLines(eventRewards, id, snapshot);
    if (rewardLines.length) newBaselines = true;
    const all = [...lines, ...asPicks(rewardLines)];
    if (taken.length && !lines.length && !rewardLines.length) return fail('hq.nachschub.linesFull');
    const took = await this.shiftWishes(lines.map((x) => ({ p: x.p, delta: -x.p.qty })));
    if (!took.ok) {
      this.undoPicks(all);
      return fail('hq.nachschub.wishlistFailed');
    }
    if (newBaselines) {
      if ((await this.patch(id, uid, { snapshot })) !== 'ok') {
        this.undoPicks(all);
        await this.shiftWishes(inverse(took.applied));
        return fail(this.error() ?? 'errors.generic');
      }
      this.packages.update((ps) => ps.map((p) => (p.id === id ? { ...p, snapshot } : p)));
    }
    return {
      ok: true,
      key: 'hq.nachschub.done.added',
      id,
      warn: skipped > 0 ? { key: 'hq.nachschub.partial', params: { count: skipped } } : undefined,
      undo: async () => {
        const back = await this.shiftWishes(inverse(took.applied));
        if (!back.ok) return fail('hq.nachschub.wishlistFailed');
        this.undoPicks(all);
        return { ...UNDONE, warn: capWarn(back.lost) };
      },
    };
  }

  // ------------------------------------------------------------------------------------------ from the Bestand (D4-D6)

  /**
   * "Abholen planen" / "Verkaufen" in the Bestand: puts `lines` into the existing active Nachschub `target` (as often
   * as you like - each call adds more, a line already there for the same item grows and its pick-up places merge), or
   * into a NEW normal Nachschub with `'new'`. A line with `stops` is a gather line (route ordered by amount, tickable
   * per stop). No cross-Nachschub merging: the lines stay in the one Nachschub you named. Undo takes back exactly what
   * this call added.
   */
  async addToNachschub(target: string | 'new', lines: readonly NachschubLineInput[], opts: { name?: string } = {}): Promise<NachschubResult> {
    if (target === 'new') return this.createWithLines(lines, { name: opts.name });
    const n = this.packages().find((p) => p.id === target && p.status === 'active');
    if (!n) return fail('errors.generic');
    return this.putLines(n.id, lines, 'hq.nachschub.done.added');
  }

  /**
   * "Geld verdienen": a new Nachschub of type `verkauf` with an aUEC goal and `lines` from the Bestand (the items to
   * sell, each with the places they lie at). Progress comes from sales the app reports ({@link reportSale}) or is set
   * by hand ({@link setSellProgress}). `goalAuec` must be a whole aUEC amount of at least 1.
   */
  async createSellNachschub(goalAuec: number, lines: readonly NachschubLineInput[], opts: { name?: string } = {}): Promise<NachschubResult> {
    const goal = parseSellGoal(goalAuec);
    if (goal === null) return fail('hq.nachschub.sellGoalInvalid');
    return this.createWithLines(lines, { name: opts.name, sell: goal });
  }

  /** Sets the earned aUEC of a Verkauf Nachschub by hand (never below 0). */
  async setSellProgress(id: string, earnedAuec: number): Promise<boolean> {
    const uid = this.auth.user()?.id;
    const n = this.packages().find((p) => p.id === id && p.type === 'verkauf');
    if (!uid || !n || !Number.isFinite(earnedAuec) || earnedAuec < 0) return false;
    const earned = Math.round(earnedAuec);
    if ((await this.patch(id, uid, { progress_auec: earned })) !== 'ok') return false;
    this.packages.update((ps) => ps.map((p) => (p.id === id ? { ...p, progressAuec: earned } : p)));
    return true;
  }

  /**
   * A sale the app reported: adds `auec` to the Verkauf Nachschub atomically (`hq_nachschub_report_sale`); `ref` (the
   * sale's log event id) makes a re-sent report a no-op. Returns the new progress, null when nothing matched.
   */
  async reportSale(id: string, auec: number, ref: string | null = null): Promise<number | null> {
    try {
      const { data, error } = await this.sb.client.rpc('hq_nachschub_report_sale' as never, { p_package_id: id, p_auec: auec, p_ref: ref } as never);
      if (error) throw error;
      const next = data === null || data === undefined ? null : Number(data);
      if (next === null || !Number.isFinite(next)) return null;
      this.packages.update((ps) => ps.map((p) => (p.id === id ? { ...p, progressAuec: next } : p)));
      return next;
    } catch (err) {
      logWarn('nachschub', 'report sale failed', err);
      return null;
    }
  }

  private async createWithLines(lines: readonly NachschubLineInput[], opts: { name?: string; sell?: number }): Promise<NachschubResult> {
    const uid = this.auth.user()?.id;
    if (!uid) return fail('errors.generic');
    if (!lines.length) return fail('hq.nachschub.nothingPicked');
    await this.ensureLoaded();
    await this.reload();
    const slot = freeSlot(this.packages());
    if (slot === null) return fail('hq.nachschub.slotsFull');
    const id = newClientId();
    const items = lines.map((l) => ({ name: l.name, qty: Math.max(1, Math.round(l.amount)) }));
    const name = clampName(opts.name?.trim() || (await this.naming.nachschubName(items)) || '', NACHSCHUB_NAME_MAX);
    const now = new Date().toISOString();
    const base: Nachschub = { id, name, status: 'active', slot, snapshot: {}, createdAt: now, archivedAt: null };
    const saved = await this.insertNew(opts.sell ? { ...base, type: 'verkauf', goalAuec: opts.sell, progressAuec: 0 } : base, uid);
    if (!saved) return fail(this.error() ?? 'errors.generic');
    const put = await this.putLines(id, lines, 'hq.nachschub.done.created', { name });
    if (!put.ok) {
      await this.drop(id, uid);
      return put;
    }
    const undoLines = put.undo;
    return {
      ...put,
      undo: async () => {
        if (!(await this.drop(id, uid))) return fail(this.error() ?? 'errors.generic');
        await undoLines?.();
        return UNDONE;
      },
    };
  }

  /** Adds the lines to Nachschub `id` with baselines; undo restores quantities / gather and removes the lines it created. */
  private async putLines(id: string, lines: readonly NachschubLineInput[], key: string, params?: Record<string, string | number>): Promise<NachschubResult> {
    const uid = this.auth.user()?.id;
    const n = this.packages().find((p) => p.id === id);
    if (!uid || !n) return fail('errors.generic');
    const stock = await this.ensureStock();
    const before = new Map(this.supplies.linesOfPackage(id).map((l) => [l.id, l]));
    const snapshot: Record<string, number> = { ...n.snapshot };
    const added: AddedLine[] = [];
    let skipped = 0;
    for (const l of lines) {
      const stops = l.stops?.length ? l.stops : undefined;
      const scu = l.unit === 'scu';
      const line = this.supplies.addLine(l.name, scu ? 1 : Math.max(1, Math.round(l.amount)), {
        entityKind: 'item',
        className: l.className,
        packageId: id,
        source: 'search',
        ...(scu ? { amount: l.amount, unit: 'scu' as const } : {}),
        ...(stops ? { gather: stops, stepKind: 'pickup' as const } : {}),
      });
      if (!line) {
        skipped++;
        continue;
      }
      added.push(line);
      if (line.prevQty === 0 && stock) snapshot[line.id] = this.ownedOf({ ship: false, className: l.className ?? '' });
    }
    if (!added.length) return fail('hq.nachschub.linesFull');
    if (JSON.stringify(snapshot) !== JSON.stringify(n.snapshot)) {
      if ((await this.patch(id, uid, { snapshot })) !== 'ok') {
        this.revertLines(added, before);
        return fail(this.error() ?? 'errors.generic');
      }
      this.packages.update((ps) => ps.map((p) => (p.id === id ? { ...p, snapshot } : p)));
    }
    return {
      ok: true,
      key,
      id,
      params,
      warn: skipped > 0 ? { key: 'hq.nachschub.partial', params: { count: skipped } } : undefined,
      undo: async () => {
        this.revertLines(added, before);
        return UNDONE;
      },
    };
  }

  private revertLines(added: readonly AddedLine[], before: ReadonlyMap<string, SupplyItem>): void {
    const fresh = added.filter((a) => a.prevQty === 0).map((a) => a.id);
    if (fresh.length) this.supplies.removeMany(fresh);
    for (const a of added) {
      if (a.prevQty === 0) continue;
      this.supplies.setLine(a.id, a.prevQty, a.prevAmount);
      const g = before.get(a.id)?.gather;
      if (g) this.supplies.setGather(a.id, g);
    }
  }

  /** Reward lines of chosen events: one line per reward; they close when the claimed reward lands in Bestand. */
  private addRewardLines(rewards: EventBinding['rewards'], packageId: string, snapshot: Record<string, number>): AddedLine[] {
    const out: AddedLine[] = [];
    for (const r of rewards) {
      const added = this.supplies.addLine(r.name, 1, { entityKind: r.ship ? 'ship' : 'item', className: r.className, packageId, source: 'search' });
      if (!added) continue;
      out.push(added);
      snapshot[added.id] = this.ownedOf({ ship: r.ship, className: r.className });
    }
    return out;
  }

  /** "Bearbeiten" > remove one line: it goes back to the wishlist (counted up there) or is dropped. */
  async removeLine(lineId: string, backToWishlist: boolean): Promise<NachschubResult> {
    const l = this.supplies.items().find((x) => x.id === lineId);
    if (!l) return fail('errors.generic');
    const owner = this.packages().find((p) => p.id === l.packageId);
    // A line of an event Nachschub never goes back to the wishlist.
    const toWishlist = backToWishlist && !(owner && isEventNachschub(owner));
    const goes =
      toWishlist && !l.done && l.className
        ? [{ kind: l.entityKind ?? 'item', className: l.className, name: l.name, qty: l.qty, forClassName: l.forClassName }]
        : [];
    const put = await this.shiftWishes(goes.map((p) => ({ p, delta: +p.qty })));
    if (!put.ok) return fail('hq.nachschub.wishlistFailed');
    this.supplies.removeMany([l.id]);
    return {
      ok: true,
      key: 'hq.nachschub.done.lineRemoved',
      warn: capWarn(put.lost),
      undo: async () => {
        const back = await this.shiftWishes(inverse(put.applied));
        if (!back.ok) return fail('hq.nachschub.wishlistFailed');
        this.supplies.restore(l.id);
        return UNDONE;
      },
    };
  }

  async rename(id: string, name: string): Promise<boolean> {
    const uid = this.auth.user()?.id;
    const n = this.packages().find((p) => p.id === id);
    const clean = clampName(name, NACHSCHUB_NAME_MAX);
    if (!uid || !n || !clean) return false;
    if ((await this.patch(id, uid, { name: clean })) !== 'ok') return false;
    this.packages.update((ps) => ps.map((p) => (p.id === id ? { ...p, name: clean } : p)));
    return true;
  }

  /** Bring an archived Nachschub back when a slot is free (the slots are read fresh; a slot taken meanwhile is retried). */
  async reactivate(id: string): Promise<NachschubResult> {
    const uid = this.auth.user()?.id;
    if (!uid) return fail('errors.generic');
    for (let attempt = 0; attempt < 3; attempt++) {
      await this.reload();
      const back = reactivate(this.packages(), id);
      if (!back) return fail(this.packages().some((p) => p.id === id) ? 'hq.nachschub.slotsFull' : 'hq.nachschub.gone');
      const out = await this.patch(id, uid, { status: 'active', slot: back.slot, archived_at: null });
      if (out === 'ok') {
        this.packages.update((ps) => ps.map((p) => (p.id === id ? back : p)));
        return { ok: true, key: 'hq.nachschub.done.reactivated', id };
      }
      if (out !== 'conflict') return fail(this.error() ?? 'errors.generic');
    }
    return fail('hq.nachschub.slotsFull');
  }

  /** "Nachschub leeren": open lines leave (back to the wishlist when asked), closed ones stay as history. */
  async empty(id: string, backToWishlist: boolean): Promise<NachschubResult> {
    const plan = this.planClear(id, backToWishlist);
    if (!plan) return fail('errors.generic');
    const put = await this.shiftWishes(plan.returned.map((p) => ({ p, delta: +p.qty })));
    if (!put.ok) return fail('hq.nachschub.wishlistFailed');
    this.supplies.removeMany(plan.removeIds);
    return {
      ok: true,
      key: 'hq.nachschub.done.emptied',
      id,
      warn: capWarn(put.lost),
      undo: async () => {
        const back = await this.shiftWishes(inverse(put.applied));
        if (!back.ok) return fail('hq.nachschub.wishlistFailed');
        for (const l of plan.removeIds) this.supplies.restore(l);
        return UNDONE;
      },
    };
  }

  /**
   * Delete a Nachschub with its open lines; with `backToWishlist` they are counted up on the wishlist first. The
   * wishlist is written first and rolled back when the delete fails, so no empty Nachschub is left behind.
   */
  async remove(id: string, backToWishlist: boolean): Promise<NachschubResult> {
    const uid = this.auth.user()?.id;
    const plan = this.planClear(id, backToWishlist);
    if (!uid || !plan) return fail('errors.generic');
    const n = plan.n;
    const put = await this.shiftWishes(plan.returned.map((p) => ({ p, delta: +p.qty })));
    if (!put.ok) return fail('hq.nachschub.wishlistFailed');
    if (!(await this.drop(id, uid))) {
      await this.shiftWishes(inverse(put.applied));
      return fail(this.error() ?? 'errors.generic');
    }
    // The closed lines of a deleted Nachschub go too (they belong to it).
    const all = this.linesOf(id).map((l) => l.id);
    this.supplies.removeMany(all);
    return {
      ok: true,
      key: 'hq.nachschub.done.removed',
      id,
      warn: capWarn(put.lost),
      undo: async () => {
        // The slot may have been taken meanwhile: the Nachschub comes back in the next free one, or not at all.
        const back = await this.restorePackage(n, uid);
        if (!back) return fail(this.error() ?? 'errors.generic');
        const out = await this.shiftWishes(inverse(put.applied));
        if (!out.ok) {
          await this.drop(id, uid);
          return fail('hq.nachschub.wishlistFailed');
        }
        for (const l of all) this.supplies.restore(l);
        return UNDONE;
      },
    };
  }

  /** Persist a changed Nachschub (the event services use this). */
  async update(next: Nachschub): Promise<boolean> {
    const uid = this.auth.user()?.id;
    if (!uid) return false;
    const out = await this.patch(next.id, uid, {
      name: next.name,
      status: next.status,
      slot: next.slot,
      snapshot: next.snapshot,
      archived_at: next.archivedAt,
      type: next.type ?? 'normal',
      event_id: next.eventId ?? null,
    });
    if (out !== 'ok') return false;
    this.packages.update((ps) => ps.map((p) => (p.id === next.id ? next : p)));
    return true;
  }

  /** An event Nachschub archives itself at its OFFICIAL end (C12); an estimate never does. */
  async applyEventEnds(ends: ReadonlyMap<string, ResolvedEnd>, nowMs: number, idsOf?: (n: Nachschub) => readonly string[]): Promise<void> {
    const at = new Date(nowMs).toISOString();
    const next = archiveAtEventEnd(this.packages(), ends, nowMs, at, idsOf);
    for (const n of next) {
      const before = this.packages().find((p) => p.id === n.id);
      if (before && before !== n) await this.update(n);
    }
  }

  /**
   * One pass over all active Nachschuebe: lines whose stock rose past the snapshot are ticked, baselines are stored
   * (and lowered when the stock fell below them), a Nachschub with every line closed archives itself and frees its slot.
   * Call after inventory / hangar changes. Waits for the stock to be loaded: a missing baseline (a migrated line) is
   * filled from the stock as it is at the FIRST pass after load - never from an unloaded stock, and not from the
   * purchase that happens to trigger a later pass, because the first pass runs when the stock loads.
   */
  async reconcile(): Promise<void> {
    const uid = this.auth.user()?.id;
    if (!uid || !this.loaded()) return;
    if (this.reconciling) {
      this.reconcileAgain = true;
      return;
    }
    this.reconciling = true;
    try {
      do {
        this.reconcileAgain = false;
        if (!(await this.ensureStock())) return;
        await this.reconcileOnce(uid);
      } while (this.reconcileAgain);
    } finally {
      this.reconciling = false;
    }
  }

  private async reconcileOnce(uid: string): Promise<void> {
    const evals = this.evals();
    for (const n of this.active()) {
      const ev = evals.get(n.id);
      if (!ev) continue;
      for (const lid of ev.closeIds) this.supplies.setDone(lid, true);
      let next: Nachschub = ev.snapshotChanged ? { ...n, snapshot: ev.snapshot } : n;
      if (ev.finished) next = archive(next, new Date().toISOString());
      if (next === n) continue;
      const cols: Record<string, unknown> = {};
      if (next.snapshot !== n.snapshot) cols['snapshot'] = next.snapshot;
      if (next.status !== n.status) Object.assign(cols, { status: next.status, slot: next.slot, archived_at: next.archivedAt });
      if ((await this.patch(n.id, uid, cols)) === 'ok') this.packages.update((ps) => ps.map((p) => (p.id === n.id ? next : p)));
    }
  }

  /**
   * An event reward landed: only a wish that IS this reward (exact class) shrinks, never the base item (C11).
   * Returns 1 when a wish was touched, 0 when nothing was wished.
   */
  async fulfilEventReward(reward: Pick<EventReward, 'className'>, gained: number): Promise<number> {
    const before = this.wishPositions();
    const wished = rewardWishes(before, reward);
    if (!wished.length) return 0;
    const after = wishlistAfterClaim(before, reward, gained);
    const shifts = wished.map((p) => ({ p, delta: (after.find((a) => positionKey(a) === positionKey(p))?.qty ?? 0) - p.qty }));
    await this.shiftWishes(shifts);
    return 1;
  }

  // ------------------------------------------------------------------------------------------------ internals

  /** Put one wishlist position onto a line of the Nachschub `packageId`. */
  private addPick(p: WishPosition, packageId: string, label: string): AddedPick | null {
    const line = this.supplies.addLine(label, p.qty, {
      entityKind: p.kind,
      className: p.className,
      forClassName: p.forClassName ?? null,
      packageId,
      source: 'search',
    });
    return line ? { p, line } : null;
  }

  /** Revert {@link addPick}s: a line that existed before goes back to its quantity, a line created by them is removed. */
  private undoPicks(lines: readonly Pick<AddedPick, 'line'>[]): void {
    for (const { line } of [...lines].reverse()) {
      if (line.prevQty === 0) this.supplies.remove(line.id);
      else this.supplies.setLine(line.id, line.prevQty, line.prevAmount);
    }
  }

  /** Which lines leave a Nachschub and what goes back to the wishlist (nothing is changed yet). */
  private planClear(id: string, backToWishlist: boolean): { n: Nachschub; removeIds: readonly string[]; returned: readonly WishPosition[] } | null {
    const n = this.packages().find((p) => p.id === id);
    if (!n) return null;
    const ev = this.evaluation(id);
    const open: OpenLine[] = this.linesOf(id)
      .filter((l) => l.className)
      .map((l) => ({
        id: l.id,
        kind: l.entityKind ?? 'item',
        className: l.className ?? '',
        name: l.name,
        qty: l.qty,
        forClassName: l.forClassName,
        closed: l.done || (ev?.statuses.get(l.id)?.closed ?? false),
      }));
    // An event Nachschub keeps its progress and NEVER sends lines back to the wishlist (C9).
    const isEvent = isEventNachschub(n);
    const out = isEvent ? clearEventNachschub(open, []) : clearNachschub(open, [], false);
    const gone = new Set(out.removeIds);
    const returned = backToWishlist && !isEvent
      ? open.filter((l) => gone.has(l.id)).map((l) => ({ kind: l.kind, className: l.className, name: l.name, qty: l.qty, forClassName: l.forClassName }))
      : [];
    return { n, removeIds: out.removeIds, returned };
  }

  private wishQtyOf(p: WishPosition): number {
    const k = positionKey(p);
    return this.wishPositions().find((w) => positionKey(w) === k)?.qty ?? 0;
  }

  /**
   * Move wishlist positions by a delta each (never to an absolute copy of an older list). Anything above 999 is
   * reported as `lost`. A failed write puts the already changed positions back and reports `ok: false`.
   */
  private async shiftWishes(items: readonly Shift[]): Promise<ShiftResult> {
    const applied: Shift[] = [];
    let lost = 0;
    for (const { p, delta } of items) {
      const have = this.wishQtyOf(p);
      const raw = have + delta;
      const next = Math.min(WISH_QTY_MAX, Math.max(0, raw));
      if (raw > WISH_QTY_MAX) lost += raw - WISH_QTY_MAX;
      if (next === have) continue;
      if (!(await this.setWishQty(p, next))) {
        for (const a of [...applied].reverse()) await this.setWishQty(a.p, Math.max(0, this.wishQtyOf(a.p) - a.delta));
        return { ok: false, lost: 0, applied: [] };
      }
      applied.push({ p, delta: next - have });
    }
    return { ok: true, lost, applied };
  }

  /**
   * Set a wishlist position to an absolute quantity (0 removes it), whichever store holds it. False when the write
   * failed.
   */
  private async setWishQty(p: WishPosition, qty: number): Promise<boolean> {
    // Ship wishes live in two places (a not-owned ship's hangar row, an owned ship's extra copies in the store);
    // SearchWishlistService knows which and 0 removes the wish.
    if (p.kind === 'ship') return this.searchWish.setQty('ship', p.className, p.name, qty);
    return this.wish.setQty({ kind: p.kind, className: p.className, name: p.name, forClassName: p.forClassName }, qty);
  }

  /** Insert a new Nachschub; a slot taken elsewhere (unique violation) is retried with the next free one. */
  private async insertNew(n: Nachschub, uid: string): Promise<Nachschub | null> {
    let cur = n;
    for (let attempt = 0; attempt < 3; attempt++) {
      const out = await this.write(
        {
          user_id: uid,
          id: cur.id,
          name: cur.name,
          status: cur.status,
          slot: cur.slot,
          snapshot: cur.snapshot,
          archived_at: cur.archivedAt,
          type: cur.type ?? 'normal',
          event_id: cur.eventId ?? null,
          ...(cur.type === 'verkauf' ? { goal_auec: cur.goalAuec ?? null, progress_auec: cur.progressAuec ?? 0 } : {}),
          deleted_at: null,
          updated_at: new Date().toISOString(),
        },
        'save',
      );
      if (out === 'ok') {
        this.packages.update((ps) => [...ps.filter((p) => p.id !== cur.id), cur]);
        return cur;
      }
      if (out !== 'conflict') return null;
      await this.reload();
      const slot = freeSlot(this.packages());
      if (slot === null) {
        this.error.set('hq.nachschub.slotsFull');
        return null;
      }
      cur = { ...cur, slot };
    }
    return null;
  }

  /** Bring a deleted Nachschub back (undo of "Loeschen"): its old slot if still free, else the next one, else not at all. */
  private async restorePackage(n: Nachschub, uid: string): Promise<Nachschub | null> {
    for (let attempt = 0; attempt < 3; attempt++) {
      await this.reload();
      let slot: number | null = null;
      if (n.status === 'active') {
        const taken = this.packages().some((p) => p.status === 'active' && p.slot === n.slot);
        slot = !taken && n.slot !== null ? n.slot : freeSlot(this.packages());
        if (slot === null) {
          this.error.set('hq.nachschub.slotsFull');
          return null;
        }
      }
      const back: Nachschub = { ...n, slot };
      const out = await this.patch(n.id, uid, { name: back.name, status: back.status, slot: back.slot, snapshot: back.snapshot, archived_at: back.archivedAt, type: back.type ?? 'normal', event_id: back.eventId ?? null }, true);
      if (out === 'ok') {
        this.packages.update((ps) => [...ps.filter((p) => p.id !== back.id), back]);
        return back;
      }
      if (out !== 'conflict') return null;
    }
    return null;
  }

  /**
   * Update ONLY `cols` of a live row. A row that was deleted on another device is not revived (a stale rename must not
   * bring a deleted Nachschub back): the call reports 'gone' and the local copy is dropped. `revive` clears the
   * tombstone on purpose (undo of a delete).
   */
  private async patch(id: string, uid: string, cols: Record<string, unknown>, revive = false): Promise<Outcome> {
    try {
      const now = new Date().toISOString();
      const base = this.sb.client
        .from('hq_supply_packages' as never)
        .update({ ...cols, ...(revive ? { deleted_at: null } : {}), updated_at: now } as never)
        .eq('user_id', uid)
        .eq('id', id);
      const { data, error } = await (revive ? base : base.is('deleted_at', null)).select('id');
      if (error) throw error;
      if (!(data as unknown[] | null)?.length) {
        this.packages.update((ps) => ps.filter((p) => p.id !== id));
        this.error.set('hq.nachschub.gone');
        return 'gone';
      }
      return 'ok';
    } catch (err) {
      return this.failed(err, 'save');
    }
  }

  private async write(row: Record<string, unknown>, op: string): Promise<Outcome> {
    try {
      const { error } = await this.sb.client.from('hq_supply_packages' as never).upsert(row as never, { onConflict: 'user_id,id' });
      if (error) throw error;
      return 'ok';
    } catch (err) {
      return this.failed(err, op);
    }
  }

  private failed(err: unknown, op: string): Outcome {
    logWarn('nachschub', `${op} failed`, err);
    const e = (err ?? {}) as { code?: unknown; message?: unknown };
    const code = typeof e.code === 'string' ? e.code : '';
    if (code === '23505') return 'conflict';
    // The server's per-user row cap (hq_enforce_cap): say so instead of a generic failure.
    const capped = code === '23514' && /row limit/i.test(typeof e.message === 'string' ? e.message : '');
    this.error.set(capped ? 'hq.nachschub.capReached' : toErrorKey('nachschub', op, err));
    return 'failed';
  }

  /** Tombstone a Nachschub (the row stays for the purge job and other devices). False when the write failed. */
  private async drop(id: string, uid: string): Promise<boolean> {
    try {
      const now = new Date().toISOString();
      const { error } = await this.sb.client
        .from('hq_supply_packages' as never)
        .update({ deleted_at: now, updated_at: now } as never)
        .eq('user_id', uid)
        .eq('id', id);
      if (error) throw error;
      this.packages.update((ps) => ps.filter((p) => p.id !== id));
      return true;
    } catch (err) {
      logWarn('nachschub', 'delete failed', err);
      this.error.set(toErrorKey('nachschub', 'delete', err));
      return false;
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
    type: r.type === 'event' || r.type === 'sightseeing' || r.type === 'verkauf' ? r.type : 'normal',
    eventId: r.event_id ?? null,
    ...(r.type === 'verkauf' ? { goalAuec: r.goal_auec ?? null, progressAuec: Number(r.progress_auec ?? 0) } : {}),
  };
}
