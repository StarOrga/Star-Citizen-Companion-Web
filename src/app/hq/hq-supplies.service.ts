import { DestroyRef, Injectable, computed, effect, inject, signal, untracked } from '@angular/core';
import { AuthService } from '../auth/auth.service';
import { formatQuantity } from '../codex/codex-format';
import { toErrorKey } from '../core/describe-error';
import { logWarn } from '../core/log';
import { SupabaseClientProvider } from '../core/supabase.client';
import type { StepKind } from '../shared/step/sc-step.component';
import type { HqGatherStop, HqSetKind, HqSupplyRow } from './data/hq-db.types';
import { GATHER_MAX_STOPS, orderByAmount, parseGather, withStopDone } from './data/hq-gather';
import {
  PullCursor,
  adoptRemote,
  afterCursorFilter,
  laggedCursor,
  markPushed,
  mergePulled,
  newClientId,
  nextWatermark,
} from './data/hq-supplies-sync';

/** Where a line came from (`hq_supplies.source`). */
export type SupplySource = HqSupplyRow['source'];
/** The unit of an exact amount (`hq_supplies.unit`); a line without amount counts pieces. */
export type SupplyUnit = 'scu';

/**
 * One line of the supplies list: a task you tick off, shaped like a cart line (name x quantity).
 * `done` reads "liegt bereit"; `wanted` is the user's mark "I want to get this" and drives the
 * set ring fraction on Planen (D28).
 */
export interface SupplyItem {
  readonly id: string;
  readonly name: string;
  readonly qty: number;
  readonly done: boolean;
  readonly entityKind: string | null;
  readonly className: string | null;
  readonly setKind: HqSetKind | null;
  readonly setId: string | null;
  readonly stepKind: StepKind | null;
  readonly wanted: boolean;
  readonly source: SupplySource;
  /**
   * Exact quantity in `unit` (0.36 SCU of a blueprint material), else null = whole pieces in `qty`.
   * On such a line `qty` counts portions (one blueprint's worth): the -/+ buttons move by one portion
   * and `amount` follows proportionally, so nothing is ever rounded.
   */
  readonly amount: number | null;
  readonly unit: SupplyUnit | null;
  /** Class name of the blueprint this material line was added for (removed together with it), else null. */
  readonly forClassName: string | null;
  /** Nachschub (`hq_supply_packages.id`) this line belongs to, else null = a loose line. */
  readonly packageId: string | null;
  /**
   * Gather line (migration 20261109000200): the stops where this ONE item is collected, in route order (the array
   * order is the route); each stop is ticked on its own. null = an ordinary line.
   */
  readonly gather?: readonly HqGatherStop[] | null;
  /** Client edit time (ISO) - the LWW key. */
  readonly updatedAt: string;
  /** Tombstone (ISO) while a deletion is on its way to the server; never listed in `items`. */
  readonly deletedAt: string | null;
  /** Not yet accepted by the server. */
  readonly dirty: boolean;
}

/** The optional new fields of {@link HqSuppliesService.add}. */
export interface SupplyMeta {
  entityKind?: string | null;
  className?: string | null;
  setKind?: HqSetKind | null;
  setId?: string | null;
  stepKind?: StepKind | null;
  wanted?: boolean;
  source?: SupplySource;
  /** Exact quantity: `qty` is then the portions count (default 1), `amount` the total in `unit`. */
  amount?: number | null;
  unit?: SupplyUnit | null;
  forClassName?: string | null;
  packageId?: string | null;
  /** Makes it a gather line over these places (`stepKind` becomes `pickup`); merged into an open gather line of the same item. */
  gather?: readonly HqGatherStop[] | null;
}

/** What {@link HqSuppliesService.addLine} changed: the line and its quantities before (0 / null = new). */
export interface AddedLine {
  id: string;
  prevQty: number;
  prevAmount: number | null;
}

/** The quantity a line stands for: the exact amount if it has one, else its pieces. */
export function lineAmount(i: Pick<SupplyItem, 'qty' | 'amount'>): number {
  return i.amount ?? i.qty;
}

/** A line's quantity as the reader reads it: "0,36 SCU" for an exact amount (locale-aware), else the pieces. */
export function supplyQtyText(i: Pick<SupplyItem, 'qty' | 'amount'>): string {
  return i.amount !== null ? `${formatQuantity(i.amount)} SCU` : String(i.qty);
}

/** Floats from sums and ratios of recipe amounts, trimmed to what the numeric column can hold sensibly. */
export function roundAmount(n: number): number {
  return Math.round(n * 1e6) / 1e6;
}


/** Key of the long-dead signed-out list. Nothing reads or writes it any more (no guests); it is only cleared. */
export const SUPPLIES_STORAGE_KEY = 'sc.hq.supplies';
/** Per-user offline cache `{ uid, wm, rows }` lives under `<SUPPLIES_CACHE_KEY>.<uid>` (a shared browser must not mix accounts). */
export const SUPPLIES_CACHE_KEY = 'sc.hq.supplies.sync';
export function suppliesCacheKey(uid: string): string {
  return `${SUPPLIES_CACHE_KEY}.${uid}`;
}
export const SUPPLIES_MAX_ITEMS = 100;
export const SUPPLY_NAME_MAX = 80;
export const SUPPLY_QTY_MAX = 999;

const STEP_KINDS_SET = new Set(['buy', 'mission', 'mine', 'refine', 'craft', 'transport', 'pickup', 'event']);
const PUSH_BATCH = 200;
const PULL_PAGE = 500;
const PUSH_DEBOUNCE_MS = 500;
const REMOVED_SNAPSHOT_MAX = 200;

interface CacheShape {
  uid: string;
  wm: string | null;
  rows: SupplyItem[];
}

/**
 * The "Nachschub" list (shell beta): what your ships, sets and ops still need, as a task list
 * that behaves like a shopping cart. Lives on the server (`hq_supplies`, owner-only RLS) and in
 * a per-user offline cache; edits are pushed when online and merged last-write-wins on
 * `updated_at` (the server trigger skips stale writes). Signed out the list is empty: there are no
 * guests (the login wall gates every route).
 */
@Injectable({ providedIn: 'root' })
export class HqSuppliesService {
  private readonly sb = inject(SupabaseClientProvider);
  private readonly auth = inject(AuthService);
  private readonly destroyRef = inject(DestroyRef);

  /** True once the signed-in account's first pull finished (live auto-apply waits for it). */
  readonly ready = signal(false);

  /** Every row incl. tombstones (the sync state). */
  private readonly rows = signal<readonly SupplyItem[]>([]);
  private uid: string | null = null;
  private watermark: string | null = null;
  private inFlight: Promise<void> | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  /** Undo source for {@link restore}, oldest first; bounded. */
  private readonly removedSnapshots = new Map<string, SupplyItem>();

  readonly items = computed(() => this.rows().filter((i) => !i.deletedAt));
  readonly open = computed(() => this.items().filter((i) => !i.done));
  readonly done = computed(() => this.items().filter((i) => i.done));
  /** Units still to get (sum of the open lines' quantities). */
  readonly openUnits = computed(() => this.open().reduce((n, i) => n + i.qty, 0));
  /** Lines grouped by set: key `ship:<id>` / `fps:<id>`. */
  readonly bySet = computed(() => {
    const map = new Map<string, SupplyItem[]>();
    for (const i of this.items()) {
      if (!i.setKind || !i.setId) continue;
      const k = setKey(i.setKind, i.setId);
      const list = map.get(k);
      if (list) list.push(i);
      else map.set(k, [i]);
    }
    return map;
  });
  /** i18n key of the last failed sync, else null. */
  readonly syncError = signal<string | null>(null);
  readonly syncing = signal(false);

  constructor() {
    effect(() => {
      const id = this.auth.user()?.id ?? null;
      untracked(() => this.onUser(id));
    });
    if (typeof window !== 'undefined') {
      const kick = () => void this.sync();
      const onVisible = () => {
        if (document.visibilityState === 'visible') kick();
      };
      window.addEventListener('online', kick);
      document.addEventListener('visibilitychange', onVisible);
      this.destroyRef.onDestroy(() => {
        window.removeEventListener('online', kick);
        document.removeEventListener('visibilitychange', onVisible);
        if (this.timer) clearTimeout(this.timer);
      });
    }
  }

  add(name: string, qty: number, meta: SupplyMeta = {}): boolean {
    return this.addLine(name, qty, meta) !== null;
  }

  /**
   * Like {@link add}, but names the line it landed on: `prevQty` is the quantity before (0 for a
   * new line), so a caller can undo exactly this. Null when the list is full or the name empty.
   */
  addLine(name: string, qty: number, meta: SupplyMeta = {}): AddedLine | null {
    const clean = name.trim().slice(0, SUPPLY_NAME_MAX);
    if (!clean || this.items().length >= SUPPLIES_MAX_ITEMS) return null;
    const q = clampQty(qty);
    const setId = meta.setId ?? null;
    const amount = validAmount(meta.amount, meta.unit);
    const forClassName = meta.forClassName?.trim() || null;
    const packageId = meta.packageId ?? null;
    const gather = meta.gather?.length ? parseGather(meta.gather) : null;
    // Same name (case-insensitive), same set, same origin (a blueprint's own material or a line of its
    // own), same kind of quantity and still open: raise its quantity like a cart does.
    const same = this.items().find(
      (i) =>
        !i.done &&
        i.setId === setId &&
        i.name.toLowerCase() === clean.toLowerCase() &&
        (i.forClassName ?? '').toLowerCase() === (forClassName ?? '').toLowerCase() &&
        i.packageId === packageId &&
        (i.amount !== null) === (amount !== null),
    );
    if (same) {
      this.patch(same.id, {
        qty: clampQty(same.qty + q),
        amount: same.amount !== null && amount !== null ? roundAmount(same.amount + amount) : same.amount,
        ...(gather ? { gather: mergeGather(same.gather, gather), stepKind: 'pickup' as StepKind } : {}),
      });
      return { id: same.id, prevQty: same.qty, prevAmount: same.amount };
    }
    {
      const setKind = setId ? (meta.setKind ?? null) : null;
      const row: SupplyItem = {
        id: newClientId(),
        name: clean,
        qty: q,
        done: false,
        entityKind: meta.entityKind ?? null,
        className: meta.className ?? null,
        setKind: setId && setKind ? setKind : null,
        setId: setId && setKind ? setId : null,
        stepKind: gather ? 'pickup' : (meta.stepKind ?? null),
        wanted: meta.wanted ?? true,
        source: meta.source ?? 'manual',
        amount,
        unit: amount !== null ? 'scu' : null,
        forClassName,
        packageId,
        gather,
        updatedAt: nowIso(),
        deletedAt: null,
        dirty: true,
      };
      this.commit([...this.rows(), row]);
      return { id: row.id, prevQty: 0, prevAmount: null };
    }
  }

  /** Replaces a gather line's stops (reorder, edit amounts); the line closes by itself when every stop is ticked. */
  setGather(id: string, stops: readonly HqGatherStop[]): void {
    const i = this.items().find((x) => x.id === id);
    const next = parseGather(stops);
    if (!i || !i.gather || !next) return;
    this.patch(id, { gather: next, done: next.every((s) => s.done) });
  }

  /** Ticks / unticks one stop of a gather line (Jetzt does this when the player picked it up). All ticked = the line is done. */
  tickGatherStop(id: string, index: number, done = true): void {
    const i = this.items().find((x) => x.id === id);
    if (!i?.gather || index < 0 || index >= i.gather.length) return;
    const next = withStopDone(i.gather, index, done);
    this.patch(id, { gather: next, done: next.every((s) => s.done) });
  }

  toggle(id: string): void {
    const i = this.items().find((x) => x.id === id);
    if (i) this.patch(id, { done: !i.done });
  }

  /** Close (`done`) or reopen a line explicitly - a toggle cannot say which way it went. */
  setDone(id: string, done: boolean): void {
    const i = this.items().find((x) => x.id === id);
    if (i && i.done !== done) this.patch(id, { done });
  }

  /** Open lines of a catalog item (by class name), manual lines first. */
  openLinesFor(className: string): SupplyItem[] {
    const key = className.trim().toLowerCase();
    if (!key) return [];
    return this.open()
      .filter((i) => (i.className ?? '').toLowerCase() === key)
      .sort((a, b) => Number(!!a.setId) - Number(!!b.setId));
  }

  /** Mark a line as wanted / not wanted for its set (drives the ring fraction). */
  setWanted(id: string, wanted: boolean): void {
    this.patch(id, { wanted });
  }

  /** A pieces line takes `qty`; an amount line takes `qty` portions and its amount follows proportionally. */
  setQty(id: string, qty: number): void {
    const i = this.items().find((x) => x.id === id);
    if (i) this.patch(id, withQty(i, clampQty(qty)));
  }

  /** Exact restore of a line's quantities (undo): no scaling, no rounding. */
  setLine(id: string, qty: number, amount: number | null): void {
    this.patch(id, { qty: clampQty(qty), amount: amount === null ? null : roundAmount(amount) });
  }

  /**
   * Brings back a removed line (undo of {@link remove}); a newer edit clears the tombstone. A tombstone the sync
   * already dropped (clean + pushed, ~500 ms after the removal) is re-inserted from the snapshot taken at removal,
   * as a dirty row with the same id, so it pushes again and the server tombstone is overwritten.
   */
  restore(id: string): void {
    const i = this.rows().find((x) => x.id === id);
    if (i) {
      if (i.deletedAt) this.patch(id, { deletedAt: null });
      this.removedSnapshots.delete(id);
      return;
    }
    const snap = this.removedSnapshots.get(id);
    if (!snap) return;
    this.removedSnapshots.delete(id);
    this.commit([...this.rows(), { ...snap, deletedAt: null, updatedAt: nowIso(), dirty: true }]);
  }

  /** Lines of one Nachschub (open and closed). */
  linesOfPackage(packageId: string): SupplyItem[] {
    return this.items().filter((i) => i.packageId === packageId);
  }

  /** Move lines into a Nachschub (or out of it with null). */
  assignPackage(ids: readonly string[], packageId: string | null): void {
    const set = new Set(ids);
    const now = nowIso();
    this.commit(this.rows().map((i) => (set.has(i.id) ? { ...i, packageId, updatedAt: now, dirty: true } : i)));
  }

  /** Tombstone several lines at once (clearing a Nachschub); undo each with {@link restore}. */
  removeMany(ids: readonly string[]): void {
    const set = new Set(ids);
    const now = nowIso();
    this.rememberRemoved(this.rows().filter((i) => set.has(i.id) && !i.deletedAt));
    this.commit(this.rows().map((i) => (set.has(i.id) && !i.deletedAt ? { ...i, deletedAt: now, updatedAt: now, dirty: true } : i)));
  }

  /** Open lines a blueprint brought along (its material), see `forClassName`. */
  openLinesForBlueprint(blueprintClassName: string): SupplyItem[] {
    const key = blueprintClassName.trim().toLowerCase();
    if (!key) return [];
    return this.open().filter((i) => (i.forClassName ?? '').toLowerCase() === key);
  }

  remove(id: string): void {
    const now = nowIso();
    this.rememberRemoved(this.rows().filter((i) => i.id === id && !i.deletedAt));
    this.commit(this.rows().map((i) => (i.id === id ? { ...i, deletedAt: now, updatedAt: now, dirty: true } : i)));
  }

  clearDone(): void {
    const now = nowIso();
    this.commit(this.rows().map((i) => (i.done && !i.deletedAt ? { ...i, deletedAt: now, updatedAt: now, dirty: true } : i)));
  }

  /**
   * Live agent: a purchase of `qty` x `className` was detected. Ticks the first open line of that
   * class (a wanted one first) and returns its id, or null when nothing matches. A line whose
   * quantity is covered becomes "liegt bereit"; a bigger line only loses `qty`.
   * {@link untick} reverts exactly this.
   */
  tickByClassName(className: string, qty: number): string | null {
    const key = className.trim().toLowerCase();
    if (!key) return null;
    const n = clampQty(qty);
    const hits = this.items().filter(
      (i) => !i.done && ((i.className ?? '').toLowerCase() === key || (!i.className && i.name.toLowerCase() === key)),
    );
    const hit = hits.find((i) => i.wanted) ?? hits[0];
    if (!hit) return null;
    if (n >= hit.qty) this.patch(hit.id, { done: true });
    else this.patch(hit.id, withQty(hit, hit.qty - n));
    return hit.id;
  }

  /** Undo of {@link tickByClassName}: a ticked line is open again, a reduced one gets `qty` back. */
  untick(id: string, qty: number): void {
    const i = this.items().find((x) => x.id === id);
    if (!i) return;
    if (i.done) this.patch(id, { done: false });
    else this.patch(id, withQty(i, clampQty(i.qty + qty)));
  }

  /** Push dirty rows, then pull what changed on the server. Never throws; failures land in `syncError`. */
  sync(): Promise<void> {
    if (!this.uid) return Promise.resolve();
    // A caller that awaits sync() expects its own edits to be pushed: queue one more pass behind a running one.
    if (this.inFlight) return this.inFlight.then(() => this.sync());
    const uid = this.uid;
    this.inFlight = this.run(uid).finally(() => {
      this.inFlight = null;
    });
    return this.inFlight;
  }

  /** Full copies of just-removed lines: the tombstone itself is dropped by the sync once the server has it. */
  private rememberRemoved(rows: readonly SupplyItem[]): void {
    for (const r of rows) {
      this.removedSnapshots.delete(r.id);
      this.removedSnapshots.set(r.id, r);
    }
    while (this.removedSnapshots.size > REMOVED_SNAPSHOT_MAX) {
      const oldest = this.removedSnapshots.keys().next().value;
      if (oldest === undefined) break;
      this.removedSnapshots.delete(oldest);
    }
  }

  private patch(id: string, change: Partial<SupplyItem>): void {
    const now = nowIso();
    this.commit(this.rows().map((i) => (i.id === id ? { ...i, ...change, updatedAt: now, dirty: true } : i)));
  }

  private commit(next: readonly SupplyItem[]): void {
    this.rows.set(next);
    this.persist();
    this.schedule();
  }

  private schedule(): void {
    if (!this.uid) return;
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.sync();
    }, PUSH_DEBOUNCE_MS);
  }

  private onUser(id: string | null): void {
    if (id === this.uid) return;
    const prev = this.uid;
    const prevRows = this.rows();
    this.uid = id;
    this.removedSnapshots.clear();
    this.watermark = null;
    this.ready.set(false);
    this.syncError.set(null);
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    if (prev) void this.finalPush(prev, prevRows);
    if (!id) {
      this.rows.set([]);
      return;
    }
    const cache = readCache(id);
    this.watermark = cache?.wm ?? null;
    this.rows.set(cache?.rows ?? []);
    this.persist();
    dropGuestList();
    void this.sync();
  }

  /** Sign-out on a shared browser: one last push attempt, then the account's cache is gone. */
  private async finalPush(prev: string, rows: readonly SupplyItem[]): Promise<void> {
    try {
      const dirty = rows.filter((r) => r.dirty).slice(0, PUSH_BATCH);
      if (dirty.length) {
        const { error } = await this.sb.client
          .from('hq_supplies')
          .upsert(dirty.map((r) => toRow(r, prev)), { onConflict: 'user_id,id' });
        if (error) throw error;
      }
    } catch (err) {
      logWarn('hq', 'supplies final push failed', err);
    } finally {
      if (this.uid !== prev) {
        try {
          localStorage.removeItem(suppliesCacheKey(prev));
        } catch (err) {
          logWarn('hq', 'supplies cache removal failed', err);
        }
      }
    }
  }

  private persist(): void {
    try {
      if (this.uid) {
        const cache: CacheShape = { uid: this.uid, wm: this.watermark, rows: [...this.rows()] };
        localStorage.setItem(suppliesCacheKey(this.uid), JSON.stringify(cache));
      }
    } catch (err) {
      logWarn('hq', 'supplies storage write failed', err);
    }
  }

  private async run(uid: string): Promise<void> {
    this.syncing.set(true);
    try {
      const dirty = this.rows().filter((r) => r.dirty).slice(0, PUSH_BATCH);
      if (dirty.length) {
        const { data, error } = await this.sb.client
          .from('hq_supplies')
          .upsert(dirty.map((r) => toRow(r, uid)), { onConflict: 'user_id,id' })
          .select('id');
        if (error) throw error;
        if (this.uid !== uid) return;
        // The trigger skips a stale write and returns no row for it: only accepted rows are pushed.
        const accepted = new Set(((data ?? []) as { id: string }[]).map((r) => r.id));
        const pushed = new Map(dirty.filter((r) => accepted.has(r.id)).map((r) => [r.id, r.updatedAt] as const));
        this.rows.update((rows) => markPushed(rows, pushed));
        const rejected = dirty.filter((r) => !accepted.has(r.id)).map((r) => r.id);
        if (rejected.length) {
          const res = await this.sb.client.from('hq_supplies').select('*').in('id', rejected);
          if (res.error) throw res.error;
          if (this.uid !== uid) return;
          const remote = ((res.data ?? []) as HqSupplyRow[]).map(fromRow);
          this.rows.update((rows) => adoptRemote(rows, remote));
        }
      }
      await this.pull(uid);
      if (this.uid !== uid) return;
      this.ready.set(true);
      this.persist();
      this.syncError.set(null);
      if (dirty.length === PUSH_BATCH) this.schedule();
    } catch (err) {
      logWarn('hq', 'supplies sync failed', err);
      this.syncError.set(toErrorKey('hq', 'syncSupplies', err));
    } finally {
      this.syncing.set(false);
    }
  }

  /** Keyset pull on `(synced_at, id)`, starting a few seconds before the watermark (late commits). */
  private async pull(uid: string): Promise<void> {
    let cursor: PullCursor | null = laggedCursor(this.watermark);
    for (let guard = 0; guard < 20; guard++) {
      let q = this.sb.client
        .from('hq_supplies')
        .select('*')
        .order('synced_at', { ascending: true })
        .order('id', { ascending: true })
        .limit(PULL_PAGE);
      if (cursor) q = q.or(afterCursorFilter(cursor));
      const { data, error } = await q;
      if (error) throw error;
      if (this.uid !== uid) return;
      const batch = (data ?? []) as HqSupplyRow[];
      if (!batch.length) break;
      this.rows.update((rows) => mergePulled(rows, batch.map(fromRow)));
      this.watermark = nextWatermark(this.watermark, batch.map((r) => r.synced_at));
      const last = batch[batch.length - 1];
      cursor = { at: last.synced_at, id: last.id };
      if (batch.length < PULL_PAGE) break;
    }
  }
}

export function setKey(kind: HqSetKind, id: string): string {
  return `${kind}:${id}`;
}

function nowIso(): string {
  return new Date().toISOString();
}

/** The amount of a line when it is a usable SCU figure, else null (a pieces line). */
function validAmount(amount: unknown, unit: unknown): number | null {
  const n = typeof amount === 'string' ? Number(amount) : amount;
  if (unit !== 'scu' || typeof n !== 'number' || !Number.isFinite(n) || n <= 0 || n > 1_000_000_000) return null;
  return roundAmount(n);
}

/** `amount` + `unit` from a server row or a stored line (numeric may arrive as a string). */
function fromAmount(amount: unknown, unit: unknown): Pick<SupplyItem, 'amount' | 'unit'> {
  const a = validAmount(amount, unit);
  return { amount: a, unit: a !== null ? 'scu' : null };
}

/** The change that gives a line `qty` pieces / portions; an amount follows by proportion. */
function withQty(i: SupplyItem, qty: number): Partial<SupplyItem> {
  if (i.amount === null || i.qty <= 0) return { qty };
  return { qty, amount: roundAmount((i.amount / i.qty) * qty) };
}

/** Adds the places of `add` to an existing gather: same place = amounts add up, new places go to the end by amount. */
function mergeGather(have: readonly HqGatherStop[] | null | undefined, add: readonly HqGatherStop[]): HqGatherStop[] {
  const out = [...(have ?? [])];
  const fresh: HqGatherStop[] = [];
  for (const a of add) {
    const at = out.findIndex((s) => s.location === a.location && (s.quality ?? null) === (a.quality ?? null));
    if (at >= 0) out[at] = { ...out[at], amount: roundAmount(out[at].amount + a.amount), done: false };
    else fresh.push(a);
  }
  return [...out, ...orderByAmount(fresh)].slice(0, GATHER_MAX_STOPS);
}

function clampQty(n: number): number {
  return Number.isFinite(n) ? Math.min(SUPPLY_QTY_MAX, Math.max(1, Math.round(n))) : 1;
}

function toRow(i: SupplyItem, uid: string): Partial<HqSupplyRow> {
  return {
    user_id: uid,
    id: i.id,
    name: i.name,
    qty: i.qty,
    done: i.done,
    entity_kind: i.entityKind,
    class_name: i.className,
    set_kind: i.setKind,
    set_id: i.setId,
    step_kind: i.stepKind,
    wanted: i.wanted,
    source: i.source,
    // The new columns only travel when set: a line without them writes exactly what it always did.
    ...(i.amount !== null && i.unit ? { amount: i.amount, unit: i.unit } : {}),
    ...(i.forClassName ? { for_class_name: i.forClassName } : {}),
    ...(i.packageId ? { package_id: i.packageId } : {}),
    ...(i.gather?.length ? { gather: [...i.gather] } : {}),
    deleted_at: i.deletedAt,
    updated_at: i.updatedAt,
  };
}

function fromRow(r: HqSupplyRow): SupplyItem {
  return {
    id: r.id,
    name: r.name,
    qty: clampQty(r.qty),
    done: r.done,
    entityKind: r.entity_kind,
    className: r.class_name,
    setKind: r.set_kind,
    setId: r.set_id,
    stepKind: r.step_kind,
    wanted: r.wanted,
    source: r.source,
    ...fromAmount(r.amount, r.unit),
    forClassName: r.for_class_name?.trim() || null,
    packageId: r.package_id ?? null,
    gather: parseGather(r.gather),
    updatedAt: r.updated_at,
    deletedAt: r.deleted_at,
    dirty: false,
  };
}

function readCache(uid: string): CacheShape | null {
  try {
    let raw = localStorage.getItem(suppliesCacheKey(uid));
    if (!raw) {
      // Old shared key: adopt it only for the account it was written for, then drop it.
      const old = localStorage.getItem(SUPPLIES_CACHE_KEY);
      if (old && (JSON.parse(old) as { uid?: unknown } | null)?.uid === uid) {
        raw = old;
        localStorage.removeItem(SUPPLIES_CACHE_KEY);
      }
    }
    const parsed: unknown = raw ? JSON.parse(raw) : null;
    if (!parsed || typeof parsed !== 'object') return null;
    const o = parsed as Record<string, unknown>;
    if (o['uid'] !== uid || !Array.isArray(o['rows'])) return null;
    const rows = (o['rows'] as unknown[]).map((r) => sanitize(r, true)).filter((r): r is SupplyItem => r !== null);
    return { uid, wm: typeof o['wm'] === 'string' ? o['wm'] : null, rows };
  } catch (err) {
    logWarn('hq', 'supplies cache read failed', err);
    return null;
  }
}

/** Housekeeping: the old signed-out list is not imported any more (the login wall means it cannot be in use). */
function dropGuestList(): void {
  try {
    localStorage.removeItem(SUPPLIES_STORAGE_KEY);
  } catch {
    /* storage unavailable: nothing to clear */
  }
}

/** Defensive parse of a cached line. */
function sanitize(r: unknown, keepSync: boolean): SupplyItem | null {
  if (!r || typeof r !== 'object') return null;
  const o = r as Record<string, unknown>;
  if (typeof o['id'] !== 'string' || typeof o['name'] !== 'string' || !o['name'].trim()) return null;
  const str = (k: string): string | null => (typeof o[k] === 'string' && o[k] ? (o[k] as string) : null);
  const setKind = o['setKind'] === 'ship' || o['setKind'] === 'fps' ? o['setKind'] : null;
  const setId = str('setId');
  const stepKind = typeof o['stepKind'] === 'string' && STEP_KINDS_SET.has(o['stepKind']) ? (o['stepKind'] as StepKind) : null;
  const source = o['source'] === 'set' || o['source'] === 'search' || o['source'] === 'live' ? o['source'] : 'manual';
  return {
    id: o['id'],
    name: o['name'].slice(0, SUPPLY_NAME_MAX),
    qty: clampQty(Number(o['qty'])),
    done: o['done'] === true,
    entityKind: str('entityKind'),
    className: str('className'),
    setKind: setKind && setId ? setKind : null,
    setId: setKind && setId ? setId : null,
    stepKind,
    wanted: o['wanted'] !== false,
    source,
    ...fromAmount(o['amount'], o['unit']),
    forClassName: str('forClassName'),
    packageId: str('packageId'),
    gather: parseGather(o['gather']),
    updatedAt: str('updatedAt') ?? nowIso(),
    deletedAt: keepSync ? str('deletedAt') : null,
    dirty: keepSync ? o['dirty'] === true : false,
  };
}
