import { DestroyRef, Injectable, InjectionToken, Injector, Signal, computed, effect, inject, signal, untracked } from '@angular/core';
import { AuthService } from '../../auth/auth.service';
import { toErrorKey } from '../../core/describe-error';
import { logWarn } from '../../core/log';
import { StepKind } from '../../shared/step/sc-step.component';
import { HqLiveEventRow } from '../data/hq-db.types';
import { HqCommunityService } from '../data/hq-community.service';
import { HqEinsatzService } from '../data/hq-einsatz.service';
import { HqInventoryService } from '../data/hq-inventory.service';
import { HqSuppliesService } from '../hq-supplies.service';
import { HqLiveStore } from './hq-live.store';
import { CodexService, toLang } from '../../codex/codex.service';
import { hitTitle } from '../../codex/search/codex-search-model';
import { ItemPathService } from '../data/item-path.service';

/**
 * The write side the live events apply to: the supplies / Einsatz services (`tickByClassName`,
 * `untick`, `markStepDone`, `unmarkStep`). A token so specs can swap in a fake.
 */
export interface HqLiveApplyTargets {
  tickByClassName(className: string, qty: number): string | null;
  untick(id: string, qty: number): void;
  markStepDone(match: {
    kind: StepKind;
    className?: string;
    missionRef?: string;
    location?: string;
  }): { einsatzId: string; ord: number } | null;
  unmarkStep(einsatzId: string, ord: number): void;
  /** Puts a replaced inventory snapshot back (`inventory.snapshot` undo). */
  restoreSnapshot?(previous: unknown): Promise<boolean>;
  /**
   * `blueprint.received` (the game's "Received Blueprint: <name>"): find the blueprint by its display name and put it
   * into the Sammlung. Null when the name matches no blueprint or the Sammlung has it already (nothing to undo).
   */
  collectBlueprint?(name: string): Promise<{ className: string; name: string } | null>;
  /** Takes a blueprint collected by an event out of the Sammlung again (its undo). */
  uncollectBlueprint?(className: string, name: string): Promise<boolean>;
  /** False until the supplies and Einsatz services finished their first pull (auto-apply waits). */
  ready?: Signal<boolean>;
  /** Pull the newest server state, right before a live tick is applied on top of it. */
  pull?(): Promise<void>;
}

export const HQ_LIVE_APPLY_TARGETS = new InjectionToken<HqLiveApplyTargets>('HQ_LIVE_APPLY_TARGETS', {
  providedIn: 'root',
  factory: () => {
    const supplies = inject(HqSuppliesService);
    const einsatz = inject(HqEinsatzService);
    const inventory = inject(HqInventoryService);
    const codex = inject(CodexService);
    // ItemPathService reads this service itself: resolved on first use, never at construction.
    const injector = inject(Injector);
    const ready = computed(() => supplies.ready() && einsatz.ready());
    return {
      tickByClassName: (className, qty) => supplies.tickByClassName(className, qty),
      untick: (id, qty) => supplies.untick(id, qty),
      markStepDone: (match) => einsatz.markStepDone(match),
      unmarkStep: (einsatzId, ord) => einsatz.unmarkStep(einsatzId, ord),
      restoreSnapshot: (previous) => inventory.restoreSnapshot(previous),
      collectBlueprint: async (name) => {
        const hit = await findBlueprintByName(codex, name);
        if (!hit) return null;
        const path = injector.get(ItemPathService);
        if ([...path.ownedBlueprints()].some((c) => c.toLowerCase() === hit.className.toLowerCase())) return null;
        const res = await path.setBlueprintOwned(hit.className, hit.name, true);
        return res.ok ? hit : null;
      },
      uncollectBlueprint: async (className, name) => (await injector.get(ItemPathService).setBlueprintOwned(className, name, false)).ok,
      ready,
      pull: async () => {
        await Promise.all([supplies.sync(), einsatz.sync()]);
      },
    };
  },
});

/**
 * The blueprint a "Received Blueprint: <name>" line names: an exact display-name match first, then the base name without
 * a "(…)" qualifier when exactly one blueprint carries it (localizations rename items between patches).
 */
export async function findBlueprintByName(codex: Pick<CodexService, 'searchAll'>, raw: string): Promise<{ className: string; name: string } | null> {
  const name = raw.replace(/:\s*$/, '').trim();
  if (!name) return null;
  const fold = (v: string): string => v.toLowerCase().replace(/\s+/g, ' ').trim();
  const base = (v: string): string => fold(v.replace(/\([^)]*\)/g, ''));
  const res = await codex.searchAll(name, 12);
  const bps = res.hits.filter((h) => h.kind === 'blueprint' && !!h.classNameSlug);
  const titled = bps.map((h) => ({ className: h.classNameSlug, names: [hitTitle(h, toLang('en')), hitTitle(h, toLang('de'))] }));
  const exact = titled.find((h) => h.names.some((n) => fold(n) === fold(name)));
  if (exact) return { className: exact.className, name: exact.names[0] };
  const byBase = titled.filter((h) => h.names.some((n) => base(n) === base(name)));
  return byBase.length === 1 ? { className: byBase[0].className, name: byBase[0].names[0] } : null;
}

/**
 * What an auto-apply did, stored in `applied` so undo reverts exactly that. A desktop-written
 * `inventory.snapshot` event carries `{replaced, previous}` without a `kind`: it reads as `snapshot`.
 */
export type HqLiveApplied =
  | { kind: 'supply'; id: string; qty: number }
  | { kind: 'step'; einsatzId: string; ord: number }
  | { kind: 'snapshot'; previous: unknown }
  | { kind: 'blueprint'; className: string; name: string; einsatzId?: string; ord?: number }
  | { kind: 'none' }
  | { kind: 'pending'; at?: string };

/** A claim left `pending` longer than this is a crashed tab's: it gets claimed again. */
export const LIVE_PENDING_STALE_MS = 2 * 60 * 1000;

/** The kind of an `applied` marker, mapping the kind-less desktop snapshot shape. */
export function appliedKind(applied: Record<string, unknown> | null): HqLiveApplied['kind'] | null {
  if (!applied) return null;
  const k = applied['kind'];
  if (k === 'supply' || k === 'step' || k === 'snapshot' || k === 'blueprint' || k === 'none' || k === 'pending') return k;
  return 'previous' in applied ? 'snapshot' : null;
}

export const LIVE_POLL_MS = 30_000;
export const LIVE_PAGE_SIZE = 30;
/** Events older than this are history: shown, never auto-applied (a page load must not replay a session). */
export const LIVE_APPLY_WINDOW_MS = 60 * 60 * 1000;
const FIRST_LOAD = 100;
const MAX_KEPT = 500;

/** Live feed of the SCC desktop app: state + events, Realtime with a 30 s polling fallback. */
@Injectable({ providedIn: 'root' })
export class HqLiveService {
  private readonly auth = inject(AuthService);
  private readonly store = inject(HqLiveStore);
  private readonly targets = inject(HQ_LIVE_APPLY_TARGETS);
  private readonly community = inject(HqCommunityService);

  readonly state = signal<Record<string, unknown> | null>(null);
  /** When the desktop app last wrote `state`. The app writes on change only, so this is no heartbeat. */
  readonly stateUpdatedAt = signal<string | null>(null);
  /** Newest first. */
  readonly events = signal<readonly HqLiveEventRow[]>([]);
  readonly connected = signal(false);
  readonly loaded = signal(false);
  readonly hasMore = signal(true);
  readonly error = signal<string | null>(null);
  /** The newest event this tab auto-applied (drives the toast); cleared by `dismissToast`. */
  readonly toast = signal<HqLiveEventRow | null>(null);

  private uid: string | null = null;
  private stop: (() => void) | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private readonly handled = new Set<string>();

  constructor() {
    effect(() => {
      const id = this.auth.user()?.id ?? null;
      untracked(() => this.start(id));
    });
    // Events that arrived before the supplies / Einsatz first pull are applied once that is done.
    effect(() => {
      const ready = this.targets.ready?.() ?? true;
      if (ready) untracked(() => this.scan(this.events()));
    });
    inject(DestroyRef).onDestroy(() => this.start(null));
  }

  private start(uid: string | null): void {
    if (uid === this.uid) return;
    this.teardown();
    this.uid = uid;
    this.state.set(null);
    this.stateUpdatedAt.set(null);
    this.events.set([]);
    this.loaded.set(false);
    this.hasMore.set(true);
    this.toast.set(null);
    this.handled.clear();
    if (!uid) return;
    void this.refresh().then(() => {
      if (this.uid !== uid) return;
      this.stop = this.store.subscribe(uid, {
        onState: (row) => {
          this.state.set(row.state);
          this.stateUpdatedAt.set(row.updated_at ?? null);
        },
        onEvent: (row) => this.ingest([row]),
        onStatus: (s) => this.connected.set(s === 'SUBSCRIBED'),
      });
    });
    this.timer = setInterval(() => {
      if (!this.connected()) void this.refresh();
    }, LIVE_POLL_MS);
  }

  private teardown(): void {
    this.stop?.();
    this.stop = null;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.connected.set(false);
  }

  /** One pull of state and the newest events (first load and polling fallback). */
  async refresh(): Promise<void> {
    const uid = this.uid;
    if (!uid) return;
    try {
      const [st, evs] = await Promise.all([this.store.fetchState(uid), this.store.fetchEvents(uid, FIRST_LOAD)]);
      if (this.uid !== uid) return;
      this.state.set(st?.state ?? null);
      this.stateUpdatedAt.set(st?.updated_at ?? null);
      const first = !this.loaded();
      this.ingest(evs);
      if (first && evs.length < FIRST_LOAD) this.hasMore.set(false);
      this.error.set(null);
      this.loaded.set(true);
    } catch (err) {
      logWarn('hq-live', 'refresh failed', err);
      this.error.set(toErrorKey('hq-live', 'load', err));
      this.loaded.set(true);
    }
  }

  /** Lazy "Mehr laden" of the log: one page of older events. */
  async loadMore(): Promise<void> {
    const uid = this.uid;
    const oldest = this.events().at(-1);
    if (!uid || !oldest) return;
    try {
      const page = await this.store.fetchEvents(uid, LIVE_PAGE_SIZE, oldest.at);
      if (this.uid !== uid) return;
      this.merge(page);
      this.hasMore.set(page.length >= LIVE_PAGE_SIZE);
    } catch (err) {
      logWarn('hq-live', 'load more failed', err);
      this.error.set(toErrorKey('hq-live', 'loadMore', err));
    }
  }

  private merge(rows: readonly HqLiveEventRow[]): void {
    const byId = new Map(this.events().map((e) => [e.id, e]));
    for (const r of rows) byId.set(r.id, { ...byId.get(r.id), ...r });
    const next = [...byId.values()].sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));
    this.events.set(next.slice(0, MAX_KEPT));
  }

  private ingest(rows: readonly HqLiveEventRow[]): void {
    this.merge(rows);
    this.scan(rows);
  }

  /** Auto-apply what is new. Waits (without marking anything handled) until the targets finished their first pull. */
  private scan(rows: readonly HqLiveEventRow[]): void {
    if (this.targets.ready && !this.targets.ready()) return;
    // Oldest first, so a burst applies in the order it happened.
    for (const row of [...rows].sort((a, b) => (a.at < b.at ? -1 : 1))) {
      if (row.undone || this.handled.has(row.id)) continue;
      const stale = this.stalePending(row);
      if (row.applied !== null && !stale) continue;
      this.handled.add(row.id);
      if (Date.now() - new Date(row.at).getTime() > LIVE_APPLY_WINDOW_MS) continue;
      void this.apply(row, stale);
    }
  }

  /** A claim a crashed tab left behind: `pending` for longer than {@link LIVE_PENDING_STALE_MS}. */
  private stalePending(row: HqLiveEventRow): boolean {
    if (!row.applied || appliedKind(row.applied) !== 'pending') return false;
    const at = Date.parse(String(row.applied['at'] ?? ''));
    return Number.isFinite(at) && Date.now() - at > LIVE_PENDING_STALE_MS;
  }

  private async apply(row: HqLiveEventRow, reclaim: boolean): Promise<void> {
    const uid = this.uid;
    if (!uid) return;
    try {
      // Claim first so a second tab or device never applies the same event twice.
      const marker = { kind: 'pending', at: new Date().toISOString() } satisfies HqLiveApplied;
      const claimed = reclaim
        ? await this.store.reclaimPending(uid, row.id, marker, new Date(Date.now() - LIVE_PENDING_STALE_MS).toISOString())
        : await this.store.claim(uid, row.id, marker);
      if (!claimed) return;
      // Apply on top of the newest server state, not on what this tab pulled minutes ago.
      await this.targets.pull?.();
      if (this.uid !== uid) return;
      this.reportPrice(row);
      const applied = row.type === 'blueprint.received' ? await this.applyBlueprint(row) : this.doApply(row);
      await this.store.patch(uid, row.id, { applied: applied as unknown as Record<string, unknown> });
      this.setLocal(row.id, { applied: applied as unknown as Record<string, unknown> });
      if (applied.kind !== 'none') this.toast.set({ ...row, applied: applied as unknown as Record<string, unknown> });
    } catch (err) {
      logWarn('hq-live', 'apply failed', err);
    }
  }

  /** Maps an event to the write it causes. Pure of I/O apart from the apply targets. */
  doApply(row: Pick<HqLiveEventRow, 'type' | 'data'>): HqLiveApplied {
    const d = row.data ?? {};
    const text = (k: string): string | undefined => (typeof d[k] === 'string' && d[k] ? (d[k] as string) : undefined);
    switch (row.type) {
      case 'shop.purchase': {
        const kind = text('kind');
        const result = text('result');
        const item = text('item');
        if (!item || (kind && kind !== 'buy') || (result && !/^(ok|success|bought|purchased)/i.test(result))) return { kind: 'none' };
        const qty = typeof d['quantity'] === 'number' && d['quantity'] > 0 ? Math.floor(d['quantity']) : 1;
        const id = this.targets.tickByClassName(item, qty);
        return id ? { kind: 'supply', id, qty } : { kind: 'none' };
      }
      case 'refinery.complete': {
        const hit = this.targets.markStepDone({ kind: 'refine', location: text('location') });
        return hit ? { kind: 'step', ...hit } : { kind: 'none' };
      }
      case 'contract.completed': {
        const hit = this.targets.markStepDone({ kind: 'mission', missionRef: text('missionId') });
        return hit ? { kind: 'step', ...hit } : { kind: 'none' };
      }
      default:
        return { kind: 'none' };
    }
  }

  /**
   * A received blueprint goes into the Sammlung (the companion app reports the pickup, no hand entry needed) and closes
   * the mission step a Nachschub planned to earn it.
   */
  async applyBlueprint(row: Pick<HqLiveEventRow, 'type' | 'data'>): Promise<HqLiveApplied> {
    const raw = row.data?.['name'];
    if (typeof raw !== 'string' || !raw.trim() || !this.targets.collectBlueprint) return { kind: 'none' };
    const hit = await this.targets.collectBlueprint(raw);
    if (!hit) return { kind: 'none' };
    const step = this.targets.markStepDone({ kind: 'mission', missionRef: hit.className });
    return { kind: 'blueprint', className: hit.className, name: hit.name, ...(step ?? {}) };
  }

  /**
   * Reverts exactly what the event applied and marks it `undone`. The undo is a conditional claim
   * (`undone = false`) first, so two tabs never revert twice; local state is reverted only once
   * the server accepted it.
   */
  async undo(eventId: string): Promise<void> {
    const uid = this.uid;
    const row = this.events().find((e) => e.id === eventId);
    if (!uid || !row || row.undone) return;
    const a = row.applied;
    const kind = appliedKind(a);
    try {
      if (!(await this.store.claimUndo(uid, eventId))) {
        // Another tab or device undid it first: nothing to revert here.
        this.setLocal(eventId, { undone: true });
        return;
      }
    } catch (err) {
      logWarn('hq-live', 'undo write failed', err);
      this.error.set(toErrorKey('hq-live', 'undo', err));
      return;
    }
    if (this.uid !== uid) return;
    if (kind === 'snapshot') {
      // The restore is itself a server write: when it fails, hand the claim back so the user can retry.
      const ok = (await this.targets.restoreSnapshot?.(a?.['previous'])) ?? false;
      if (!ok) {
        try {
          await this.store.patch(uid, eventId, { undone: false });
        } catch (err) {
          logWarn('hq-live', 'undo release failed', err);
        }
        this.error.set(toErrorKey('hq-live', 'undo', new Error('snapshot restore failed')));
        return;
      }
    } else if (kind === 'blueprint') {
      await this.targets.uncollectBlueprint?.(String(a?.['className'] ?? ''), String(a?.['name'] ?? ''));
      if (a?.['einsatzId']) this.targets.unmarkStep(String(a['einsatzId']), Number(a['ord']));
    } else if (kind === 'supply') this.targets.untick(String(a?.['id']), Number(a?.['qty']));
    else if (kind === 'step') this.targets.unmarkStep(String(a?.['einsatzId']), Number(a?.['ord']));
    this.setLocal(eventId, { undone: true });
    if (this.toast()?.id === eventId) this.toast.set(null);
  }

  /** True when an event changed something that can be taken back. */
  undoable(row: HqLiveEventRow): boolean {
    const k = appliedKind(row.applied);
    return !row.undone && (k === 'supply' || k === 'step' || k === 'snapshot' || k === 'blueprint');
  }

  /** Opt-in community data: an applied buy is a price report (class, shop, unit price). */
  private reportPrice(row: HqLiveEventRow): void {
    if (row.type !== 'shop.purchase') return;
    const d = row.data ?? {};
    const kind = typeof d['kind'] === 'string' ? d['kind'] : 'buy';
    const result = typeof d['result'] === 'string' ? d['result'] : '';
    const item = typeof d['item'] === 'string' ? d['item'].trim() : '';
    const shop = typeof d['shop'] === 'string' ? d['shop'].trim() : '';
    if (kind !== 'buy' || !item || !shop || (result && !/^(ok|success|bought|purchased)/i.test(result))) return;
    const qty = typeof d['quantity'] === 'number' && d['quantity'] > 0 ? d['quantity'] : 1;
    const unit = Number(d['unitPrice']);
    const total = Number(d['price']);
    const value = Number.isFinite(unit) && d['unitPrice'] != null ? unit : total / qty;
    if (!Number.isFinite(value) || value < 0) return;
    void this.community
      .report([{ kind: 'price', class_name: item, location: shop, value }])
      .catch((err) => logWarn('hq-live', 'community report failed', err));
  }

  dismissToast(): void {
    this.toast.set(null);
  }

  private setLocal(id: string, patch: Partial<HqLiveEventRow>): void {
    this.events.update((evs) => evs.map((e) => (e.id === id ? { ...e, ...patch } : e)));
  }
}
