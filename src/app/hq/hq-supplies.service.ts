import { DestroyRef, Injectable, computed, effect, inject, signal, untracked } from '@angular/core';
import { AuthService } from '../auth/auth.service';
import { toErrorKey } from '../core/describe-error';
import { logWarn } from '../core/log';
import { SupabaseClientProvider } from '../core/supabase.client';
import type { StepKind } from '../shared/step/sc-step.component';
import type { HqSetKind, HqSupplyRow } from './data/hq-db.types';
import { markPushed, mergePulled, newClientId, nextWatermark } from './data/hq-supplies-sync';

/** Where a line came from (`hq_supplies.source`). */
export type SupplySource = HqSupplyRow['source'];

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
}

/** Legacy local list (before the server table). Read once after sign-in, then removed. */
export const SUPPLIES_STORAGE_KEY = 'sc.hq.supplies';
/** Per-user offline cache: `{ uid, wm, rows }`. */
export const SUPPLIES_CACHE_KEY = 'sc.hq.supplies.sync';
export const SUPPLIES_MAX_ITEMS = 100;
export const SUPPLY_NAME_MAX = 80;
export const SUPPLY_QTY_MAX = 999;

const STEP_KINDS_SET = new Set(['buy', 'mission', 'mine', 'refine', 'craft', 'transport', 'pickup']);
const PUSH_BATCH = 200;
const PULL_PAGE = 500;
const PUSH_DEBOUNCE_MS = 500;

interface CacheShape {
  uid: string;
  wm: string | null;
  rows: SupplyItem[];
}

/**
 * The "Nachschub" list (shell beta): what your ships, sets and ops still need, as a task list
 * that behaves like a shopping cart. Lives on the server (`hq_supplies`, owner-only RLS) and in
 * a per-user offline cache; edits are pushed when online and merged last-write-wins on
 * `updated_at` (the server trigger skips stale writes). Signed out, the list falls back to the
 * old local key; after sign-in that list is imported once and the key removed.
 */
@Injectable({ providedIn: 'root' })
export class HqSuppliesService {
  private readonly sb = inject(SupabaseClientProvider);
  private readonly auth = inject(AuthService);
  private readonly destroyRef = inject(DestroyRef);

  /** Every row incl. tombstones (the sync state). */
  private readonly rows = signal<readonly SupplyItem[]>(readLegacy());
  private uid: string | null = null;
  private watermark: string | null = null;
  private inFlight: Promise<void> | null = null;
  private again = false;
  private timer: ReturnType<typeof setTimeout> | null = null;

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
    const clean = name.trim().slice(0, SUPPLY_NAME_MAX);
    if (!clean || this.items().length >= SUPPLIES_MAX_ITEMS) return false;
    const q = clampQty(qty);
    const setId = meta.setId ?? null;
    // Same name (case-insensitive), same set and still open: raise its quantity like a cart does.
    const same = this.items().find(
      (i) => !i.done && i.setId === setId && i.name.toLowerCase() === clean.toLowerCase(),
    );
    if (same) {
      this.patch(same.id, { qty: clampQty(same.qty + q) });
    } else {
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
        stepKind: meta.stepKind ?? null,
        wanted: meta.wanted ?? true,
        source: meta.source ?? 'manual',
        updatedAt: nowIso(),
        deletedAt: null,
        dirty: true,
      };
      this.commit([...this.rows(), row]);
    }
    return true;
  }

  toggle(id: string): void {
    const i = this.items().find((x) => x.id === id);
    if (i) this.patch(id, { done: !i.done });
  }

  /** Mark a line as wanted / not wanted for its set (drives the ring fraction). */
  setWanted(id: string, wanted: boolean): void {
    this.patch(id, { wanted });
  }

  setQty(id: string, qty: number): void {
    this.patch(id, { qty: clampQty(qty) });
  }

  remove(id: string): void {
    const now = nowIso();
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
    else this.patch(hit.id, { qty: hit.qty - n });
    return hit.id;
  }

  /** Undo of {@link tickByClassName}: a ticked line is open again, a reduced one gets `qty` back. */
  untick(id: string, qty: number): void {
    const i = this.items().find((x) => x.id === id);
    if (!i) return;
    if (i.done) this.patch(id, { done: false });
    else this.patch(id, { qty: clampQty(i.qty + qty) });
  }

  /** Push dirty rows, then pull what changed on the server. Never throws; failures land in `syncError`. */
  sync(): Promise<void> {
    if (!this.uid) return Promise.resolve();
    if (this.inFlight) {
      this.again = true;
      return this.inFlight;
    }
    const uid = this.uid;
    this.inFlight = this.run(uid).finally(() => {
      this.inFlight = null;
      if (this.again) {
        this.again = false;
        this.schedule();
      }
    });
    return this.inFlight;
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
    this.uid = id;
    this.watermark = null;
    this.syncError.set(null);
    if (!id) {
      this.rows.set(readLegacy());
      return;
    }
    const cache = readCache(id);
    this.watermark = cache?.wm ?? null;
    let rows: SupplyItem[] = cache?.rows ?? [];
    // One-time import of the old local list: every line the account does not know yet.
    const legacy = readLegacy();
    if (legacy.length) {
      const known = new Set(rows.map((r) => r.id));
      const now = nowIso();
      rows = [...rows, ...legacy.filter((l) => !known.has(l.id)).map((l) => ({ ...l, updatedAt: now, dirty: true }))];
    }
    this.rows.set(rows);
    this.persist();
    if (legacy.length) {
      try {
        localStorage.removeItem(SUPPLIES_STORAGE_KEY);
      } catch (err) {
        logWarn('hq', 'supplies legacy key removal failed', err);
      }
    }
    void this.sync();
  }

  private persist(): void {
    try {
      if (this.uid) {
        const cache: CacheShape = { uid: this.uid, wm: this.watermark, rows: [...this.rows()] };
        localStorage.setItem(SUPPLIES_CACHE_KEY, JSON.stringify(cache));
      } else {
        localStorage.setItem(SUPPLIES_STORAGE_KEY, JSON.stringify(this.rows().filter((i) => !i.deletedAt)));
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
        const { error } = await this.sb.client
          .from('hq_supplies')
          .upsert(dirty.map((r) => toRow(r, uid)), { onConflict: 'user_id,id' });
        if (error) throw error;
        if (this.uid !== uid) return;
        const pushed = new Map(dirty.map((r) => [r.id, r.updatedAt] as const));
        this.rows.update((rows) => markPushed(rows, pushed));
      }
      for (let guard = 0; guard < 20; guard++) {
        let q = this.sb.client.from('hq_supplies').select('*').order('synced_at', { ascending: true }).limit(PULL_PAGE);
        if (this.watermark) q = q.gt('synced_at', this.watermark);
        const { data, error } = await q;
        if (error) throw error;
        if (this.uid !== uid) return;
        const batch = (data ?? []) as HqSupplyRow[];
        if (!batch.length) break;
        this.rows.update((rows) => mergePulled(rows, batch.map(fromRow)));
        this.watermark = nextWatermark(this.watermark, batch.map((r) => r.synced_at));
        if (batch.length < PULL_PAGE) break;
      }
      this.persist();
      this.syncError.set(null);
      if (this.rows().some((r) => r.dirty) && dirty.length === PUSH_BATCH) this.again = true;
    } catch (err) {
      logWarn('hq', 'supplies sync failed', err);
      this.syncError.set(toErrorKey('hq', 'syncSupplies', err));
    } finally {
      this.syncing.set(false);
    }
  }
}

export function setKey(kind: HqSetKind, id: string): string {
  return `${kind}:${id}`;
}

function nowIso(): string {
  return new Date().toISOString();
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
    updatedAt: r.updated_at,
    deletedAt: r.deleted_at,
    dirty: false,
  };
}

function readCache(uid: string): CacheShape | null {
  try {
    const raw = localStorage.getItem(SUPPLIES_CACHE_KEY);
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

function readLegacy(): readonly SupplyItem[] {
  try {
    const raw = localStorage.getItem(SUPPLIES_STORAGE_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : null;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .slice(0, SUPPLIES_MAX_ITEMS)
      .map((r) => sanitize(r, false))
      .filter((r): r is SupplyItem => r !== null);
  } catch (err) {
    logWarn('hq', 'supplies storage read failed', err);
    return [];
  }
}

/** Defensive parse of a stored line (legacy lines only have id, name, qty, done). */
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
    updatedAt: str('updatedAt') ?? nowIso(),
    deletedAt: keepSync ? str('deletedAt') : null,
    dirty: keepSync ? o['dirty'] === true : false,
  };
}
