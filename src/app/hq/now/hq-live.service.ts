import { DestroyRef, Injectable, InjectionToken, effect, inject, signal, untracked } from '@angular/core';
import { AuthService } from '../../auth/auth.service';
import { toErrorKey } from '../../core/describe-error';
import { logWarn } from '../../core/log';
import { StepKind } from '../../shared/step/sc-step.component';
import { HqLiveEventRow } from '../data/hq-db.types';
import { HqEinsatzService } from '../data/hq-einsatz.service';
import { HqSuppliesService } from '../hq-supplies.service';
import { HqLiveStore } from './hq-live.store';

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
}

export const HQ_LIVE_APPLY_TARGETS = new InjectionToken<HqLiveApplyTargets>('HQ_LIVE_APPLY_TARGETS', {
  providedIn: 'root',
  factory: () => {
    const supplies = inject(HqSuppliesService);
    const einsatz = inject(HqEinsatzService);
    return {
      tickByClassName: (className, qty) => supplies.tickByClassName(className, qty),
      untick: (id, qty) => supplies.untick(id, qty),
      markStepDone: (match) => einsatz.markStepDone(match),
      unmarkStep: (einsatzId, ord) => einsatz.unmarkStep(einsatzId, ord),
    };
  },
});

/** What an auto-apply did, stored in `applied` so undo reverts exactly that. */
export type HqLiveApplied =
  | { kind: 'supply'; id: string; qty: number }
  | { kind: 'step'; einsatzId: string; ord: number }
  | { kind: 'none' }
  | { kind: 'pending' };

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

  readonly state = signal<Record<string, unknown> | null>(null);
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
    inject(DestroyRef).onDestroy(() => this.start(null));
  }

  private start(uid: string | null): void {
    if (uid === this.uid) return;
    this.teardown();
    this.uid = uid;
    this.state.set(null);
    this.events.set([]);
    this.loaded.set(false);
    this.hasMore.set(true);
    this.toast.set(null);
    this.handled.clear();
    if (!uid) return;
    void this.refresh().then(() => {
      if (this.uid !== uid) return;
      this.stop = this.store.subscribe(uid, {
        onState: (row) => this.state.set(row.state),
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
    // Oldest first, so a burst applies in the order it happened.
    for (const row of [...rows].sort((a, b) => (a.at < b.at ? -1 : 1))) {
      if (row.applied !== null || row.undone || this.handled.has(row.id)) continue;
      this.handled.add(row.id);
      if (Date.now() - new Date(row.at).getTime() > LIVE_APPLY_WINDOW_MS) continue;
      void this.apply(row);
    }
  }

  private async apply(row: HqLiveEventRow): Promise<void> {
    const uid = this.uid;
    if (!uid) return;
    try {
      // Claim first so a second tab or device never applies the same event twice.
      if (!(await this.store.claim(uid, row.id, { kind: 'pending' } satisfies HqLiveApplied))) return;
      const applied = this.doApply(row);
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

  /** Reverts exactly what the event applied and marks it `undone`. */
  async undo(eventId: string): Promise<void> {
    const uid = this.uid;
    const row = this.events().find((e) => e.id === eventId);
    if (!uid || !row || row.undone) return;
    const a = row.applied as HqLiveApplied | null;
    if (a?.kind === 'supply') this.targets.untick(a.id, a.qty);
    else if (a?.kind === 'step') this.targets.unmarkStep(a.einsatzId, a.ord);
    this.setLocal(eventId, { undone: true });
    if (this.toast()?.id === eventId) this.toast.set(null);
    try {
      await this.store.patch(uid, eventId, { undone: true });
    } catch (err) {
      logWarn('hq-live', 'undo write failed', err);
      this.error.set(toErrorKey('hq-live', 'undo', err));
    }
  }

  /** True when an event changed something that can be taken back. */
  undoable(row: HqLiveEventRow): boolean {
    const k = (row.applied as HqLiveApplied | null)?.kind;
    return !row.undone && (k === 'supply' || k === 'step');
  }

  dismissToast(): void {
    this.toast.set(null);
  }

  private setLocal(id: string, patch: Partial<HqLiveEventRow>): void {
    this.events.update((evs) => evs.map((e) => (e.id === id ? { ...e, ...patch } : e)));
  }
}
