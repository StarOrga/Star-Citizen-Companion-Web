import { DestroyRef, Injectable, computed, effect, inject, signal, untracked } from '@angular/core';
import { AuthService } from '../../auth/auth.service';
import { toErrorKey } from '../../core/describe-error';
import { logWarn } from '../../core/log';
import { SupabaseClientProvider } from '../../core/supabase.client';
import type { StepKind } from '../../shared/step/sc-step.component';
import type { HqActivity, HqEinsatzRow, HqEinsatzStepRow } from './hq-db.types';
import {
  PullCursor,
  adoptRemote,
  afterCursorFilter,
  laggedCursor,
  markPushed,
  mergePulled,
  ms,
  newClientId,
  nextWatermark,
} from './hq-supplies-sync';

export type EinsatzStatus = HqEinsatzRow['status'];

export interface EinsatzStep {
  readonly ord: number;
  readonly kind: StepKind;
  readonly label: string;
  readonly location: string | null;
  readonly system: string | null;
  readonly className: string | null;
  readonly qty: number | null;
  readonly supplyId: string | null;
  readonly missionRef: string | null;
  readonly state: 'todo' | 'done';
  readonly doneAt: string | null;
  readonly doneBy: 'user' | 'live' | null;
}

/** One Einsatz with its ordered steps; "Einsatz ×N" is `steps.length` ({@link einsatzBadge}). */
export interface Einsatz {
  readonly id: string;
  readonly title: string;
  readonly activity: HqActivity | null;
  readonly status: EinsatzStatus;
  readonly plannedAt: string | null;
  readonly startLocation: string | null;
  readonly steps: readonly EinsatzStep[];
  readonly updatedAt: string;
  readonly deletedAt: string | null;
  readonly dirty: boolean;
}

export type NewEinsatz = Pick<Einsatz, 'title'> &
  Partial<Pick<Einsatz, 'activity' | 'plannedAt' | 'startLocation'>> & {
    steps: readonly Omit<EinsatzStep, 'ord' | 'state' | 'doneAt' | 'doneBy'>[];
  };

/** What a live event tells about a step (the live agent builds this). */
export interface StepMatch {
  kind: StepKind;
  className?: string;
  missionRef?: string;
  location?: string;
}

/** Per-user offline cache lives under `<EINSATZ_CACHE_KEY>.<uid>`. */
export const EINSATZ_CACHE_KEY = 'sc.hq.einsaetze.sync';
export function einsatzCacheKey(uid: string): string {
  return `${EINSATZ_CACHE_KEY}.${uid}`;
}
export const EINSATZ_STEPS_MAX = 40;
const PUSH_DEBOUNCE_MS = 500;
const PULL_PAGE = 200;
const PUSH_BATCH = 50;
/** Einsatz ids per steps request, and rows per steps page (PostgREST caps a response at 1000). */
export const STEPS_ID_CHUNK = 50;
export const STEPS_PAGE = 1000;

/** A mission as an Einsatz step (`kind: 'mission'`, the contract's class name as `missionRef`). */
export function missionStep(className: string, title: string): NewEinsatz['steps'][number] {
  return { kind: 'mission', label: title.trim() || className, location: null, system: null, className: null, qty: null, supplyId: null, missionRef: className };
}

/** "Einsatz" for one step, "Einsatz ×N" (tooltip "N Schritte") for two or more (D17). */
export function einsatzBadge(e: Pick<Einsatz, 'steps'>): { multi: boolean; n: number } {
  return { multi: e.steps.length >= 2, n: e.steps.length };
}

/** Does a live event describe this step? Every given identifying field that the step has must agree. */
export function stepMatches(step: EinsatzStep, m: StepMatch): boolean {
  if (step.kind !== m.kind || step.state === 'done') return false;
  const eq = (a: string | null, b: string | undefined) => (a ?? '').trim().toLowerCase() === (b ?? '').trim().toLowerCase();
  const given: boolean[] = [];
  if (m.className) given.push(eq(step.className, m.className));
  if (m.missionRef) given.push(eq(step.missionRef, m.missionRef));
  if (m.location) given.push(eq(step.location, m.location));
  // With identifying fields at least one must hit and none of the step's own fields may contradict.
  if (given.length === 0) return true;
  const contradicts =
    (m.className && step.className && !eq(step.className, m.className)) ||
    (m.missionRef && step.missionRef && !eq(step.missionRef, m.missionRef));
  return given.some(Boolean) && !contradicts;
}

interface CacheShape {
  uid: string;
  wm: string | null;
  rows: Einsatz[];
}

/**
 * Einsaetze and their steps (`hq_einsaetze` / `hq_einsatz_steps`, owner-only RLS). Same sync model
 * as the supplies: a per-user offline cache, dirty rows pushed (the Einsatz first, then its step
 * list rewritten as a whole), pulled by `synced_at`, merged last-write-wins on the Einsatz's
 * `updated_at`. A step change bumps the Einsatz's `updated_at`, so it travels with it.
 */
@Injectable({ providedIn: 'root' })
export class HqEinsatzService {
  private readonly sb = inject(SupabaseClientProvider);
  private readonly auth = inject(AuthService);
  private readonly destroyRef = inject(DestroyRef);

  private readonly rows = signal<readonly Einsatz[]>([]);
  private uid: string | null = null;
  private watermark: string | null = null;
  private inFlight: Promise<void> | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;

  readonly items = computed(() => this.rows().filter((e) => !e.deletedAt));
  /** Planned or active Einsaetze, soonest first (undated last). */
  readonly upcoming = computed(() =>
    this.items()
      .filter((e) => e.status === 'planned' || e.status === 'active')
      .sort((a, b) => (a.plannedAt ? ms(a.plannedAt) : Infinity) - (b.plannedAt ? ms(b.plannedAt) : Infinity)),
  );
  /** True once the signed-in account's first pull finished (live auto-apply waits for it). */
  readonly ready = signal(false);
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

  /** Save a new Einsatz (planned). Returns it, or null for an empty title / no steps. */
  create(input: NewEinsatz): Einsatz | null {
    const title = input.title.trim().slice(0, 120);
    const steps = input.steps.slice(0, EINSATZ_STEPS_MAX);
    if (!title || steps.length === 0) return null;
    const e: Einsatz = {
      id: newClientId(),
      title,
      activity: input.activity ?? null,
      status: 'planned',
      plannedAt: input.plannedAt ?? null,
      startLocation: input.startLocation ?? null,
      steps: steps.map((s, ord) => ({ ...s, label: s.label.slice(0, 160), ord, state: 'todo', doneAt: null, doneBy: null })),
      updatedAt: nowIso(),
      deletedAt: null,
      dirty: true,
    };
    this.commit([...this.rows(), e]);
    return e;
  }

  /**
   * Append one step to an existing Einsatz (search CTA "Zum Einsatz"). False
   * when the Einsatz is gone or already holds {@link EINSATZ_STEPS_MAX} steps.
   * A finished Einsatz reopens as active: it has an open step again.
   */
  addStep(id: string, step: NewEinsatz['steps'][number]): boolean {
    const e = this.items().find((x) => x.id === id);
    if (!e || e.steps.length >= EINSATZ_STEPS_MAX) return false;
    const ord = e.steps.reduce((m, s) => Math.max(m, s.ord), -1) + 1;
    const added: EinsatzStep = { ...step, label: step.label.slice(0, 160), ord, state: 'todo', doneAt: null, doneBy: null };
    this.patch(id, { steps: [...e.steps, added], status: e.status === 'done' ? 'active' : e.status });
    return true;
  }

  rename(id: string, title: string): void {
    const t = title.trim().slice(0, 120);
    if (t) this.patch(id, { title: t });
  }

  setStatus(id: string, status: EinsatzStatus): void {
    this.patch(id, { status });
  }

  remove(id: string): void {
    const now = nowIso();
    this.commit(this.rows().map((e) => (e.id === id ? { ...e, deletedAt: now, updatedAt: now, dirty: true } : e)));
  }

  /** The user ticks a step by hand (or unticks it). */
  toggleStep(id: string, ord: number): void {
    const e = this.items().find((x) => x.id === id);
    const s = e?.steps.find((x) => x.ord === ord);
    if (!e || !s) return;
    this.setStep(id, ord, s.state === 'done' ? 'todo' : 'done', 'user');
  }

  /**
   * Live agent: an event finished a step. Marks the first matching open step (active Einsaetze
   * before planned ones, then the soonest, lowest step first) done by `live` and returns where,
   * or null. {@link unmarkStep} reverts exactly this.
   */
  markStepDone(match: StepMatch): { einsatzId: string; ord: number } | null {
    const rank = (e: Einsatz) => (e.status === 'active' ? 0 : 1);
    const candidates = this.items()
      .filter((e) => e.status === 'planned' || e.status === 'active')
      .sort((a, b) => rank(a) - rank(b) || (a.plannedAt ? ms(a.plannedAt) : Infinity) - (b.plannedAt ? ms(b.plannedAt) : Infinity));
    for (const e of candidates) {
      const step = [...e.steps].sort((a, b) => a.ord - b.ord).find((s) => stepMatches(s, match));
      if (step) {
        this.setStep(e.id, step.ord, 'done', 'live');
        return { einsatzId: e.id, ord: step.ord };
      }
    }
    return null;
  }

  /** Undo of {@link markStepDone}. */
  unmarkStep(einsatzId: string, ord: number): void {
    this.setStep(einsatzId, ord, 'todo', null);
  }

  /** Push dirty Einsaetze (with steps), then pull what changed. Never throws; failures land in `syncError`. */
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

  private setStep(id: string, ord: number, state: 'todo' | 'done', by: 'user' | 'live' | null): void {
    const now = nowIso();
    this.commit(
      this.rows().map((e) => {
        if (e.id !== id || e.deletedAt) return e;
        const steps = e.steps.map((s) =>
          s.ord === ord ? { ...s, state, doneAt: state === 'done' ? now : null, doneBy: state === 'done' ? by : null } : s,
        );
        const allDone = steps.length > 0 && steps.every((s) => s.state === 'done');
        const status: EinsatzStatus = allDone ? 'done' : e.status === 'done' ? 'active' : e.status;
        return { ...e, steps, status, updatedAt: now, dirty: true };
      }),
    );
  }

  private patch(id: string, change: Partial<Einsatz>): void {
    this.commit(this.rows().map((e) => (e.id === id ? { ...e, ...change, updatedAt: nowIso(), dirty: true } : e)));
  }

  private commit(next: readonly Einsatz[]): void {
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
    void this.sync();
  }

  /** Sign-out on a shared browser: one last push attempt, then the account's cache is gone. */
  private async finalPush(prev: string, rows: readonly Einsatz[]): Promise<void> {
    try {
      await this.pushDirty(prev, rows.filter((r) => r.dirty).slice(0, PUSH_BATCH), () => true);
    } catch (err) {
      logWarn('hq', 'einsatz final push failed', err);
    } finally {
      if (this.uid !== prev) {
        try {
          localStorage.removeItem(einsatzCacheKey(prev));
        } catch (err) {
          logWarn('hq', 'einsatz cache removal failed', err);
        }
      }
    }
  }

  /** Upsert the Einsaetze, rewrite the steps of the accepted ones; returns the ids the server did not accept. */
  private async pushDirty(uid: string, dirty: readonly Einsatz[], stillCurrent: () => boolean): Promise<string[]> {
    if (!dirty.length) return [];
    const { data, error } = await this.sb.client
      .from('hq_einsaetze')
      .upsert(dirty.map((e) => toRow(e, uid)), { onConflict: 'id' })
      .select('id');
    if (error) throw error;
    // The trigger skips a stale write: only Einsaetze it accepted may rewrite their steps.
    const accepted = new Set(((data ?? []) as { id: string }[]).map((r) => r.id));
    for (const e of dirty) {
      if (!accepted.has(e.id) || e.deletedAt || !stillCurrent()) continue;
      const res = await this.sb.client.rpc('hq_replace_einsatz_steps', {
        p_einsatz_id: e.id,
        p_steps: e.steps.map(stepToJson),
      });
      if (res.error) throw res.error;
    }
    return dirty.filter((e) => !accepted.has(e.id)).map((e) => e.id);
  }

  private persist(): void {
    if (!this.uid) return;
    try {
      const cache: CacheShape = { uid: this.uid, wm: this.watermark, rows: [...this.rows()] };
      localStorage.setItem(einsatzCacheKey(this.uid), JSON.stringify(cache));
    } catch (err) {
      logWarn('hq', 'einsatz storage write failed', err);
    }
  }

  private async run(uid: string): Promise<void> {
    this.syncing.set(true);
    try {
      const dirty = this.rows().filter((r) => r.dirty).slice(0, PUSH_BATCH);
      if (dirty.length) {
        const rejected = await this.pushDirty(uid, dirty, () => this.uid === uid);
        if (this.uid !== uid) return;
        const pushed = new Map(dirty.filter((e) => !rejected.includes(e.id)).map((e) => [e.id, e.updatedAt] as const));
        this.rows.update((rows) => markPushed(rows, pushed));
        if (rejected.length) {
          const res = await this.sb.client.from('hq_einsaetze').select('*').in('id', rejected);
          if (res.error) throw res.error;
          const batch = (res.data ?? []) as HqEinsatzRow[];
          const steps = await this.fetchSteps(batch.filter((r) => !r.deleted_at).map((r) => r.id));
          if (this.uid !== uid) return;
          const remote = batch.map((r) => fromRow(r, steps.filter((s) => s.einsatz_id === r.id)));
          this.rows.update((rows) => adoptRemote(rows, remote));
        }
      }
      let cursor: PullCursor | null = laggedCursor(this.watermark);
      for (let guard = 0; guard < 20; guard++) {
        let q = this.sb.client
          .from('hq_einsaetze')
          .select('*')
          .order('synced_at', { ascending: true })
          .order('id', { ascending: true })
          .limit(PULL_PAGE);
        if (cursor) q = q.or(afterCursorFilter(cursor));
        const { data, error } = await q;
        if (error) throw error;
        if (this.uid !== uid) return;
        const batch = (data ?? []) as HqEinsatzRow[];
        if (!batch.length) break;
        const stepRows = await this.fetchSteps(batch.filter((r) => !r.deleted_at).map((r) => r.id));
        if (this.uid !== uid) return;
        this.rows.update((rows) => mergePulled(rows, batch.map((r) => fromRow(r, stepRows.filter((s) => s.einsatz_id === r.id)))));
        this.watermark = nextWatermark(this.watermark, batch.map((r) => r.synced_at));
        const last = batch[batch.length - 1];
        cursor = { at: last.synced_at, id: last.id };
        if (batch.length < PULL_PAGE) break;
      }
      this.ready.set(true);
      this.persist();
      this.syncError.set(null);
    } catch (err) {
      logWarn('hq', 'einsatz sync failed', err);
      this.syncError.set(toErrorKey('hq', 'syncEinsatz', err));
    } finally {
      this.syncing.set(false);
    }
  }

  /**
   * All steps of the given Einsaetze, in chunks of {@link STEPS_ID_CHUNK} ids and explicit pages
   * with a row count. A list that came back short of its count throws: a truncated step list
   * must never be merged (it would read as "the steps were removed").
   */
  private async fetchSteps(einsatzIds: readonly string[]): Promise<HqEinsatzStepRow[]> {
    const out: HqEinsatzStepRow[] = [];
    for (let i = 0; i < einsatzIds.length; i += STEPS_ID_CHUNK) {
      const chunk = einsatzIds.slice(i, i + STEPS_ID_CHUNK);
      let got = 0;
      for (let guard = 0; guard < 50; guard++) {
        const res = await this.sb.client
          .from('hq_einsatz_steps')
          .select('*', { count: 'exact' })
          .in('einsatz_id', chunk)
          .order('einsatz_id', { ascending: true })
          .order('ord', { ascending: true })
          .range(got, got + STEPS_PAGE - 1);
        if (res.error) throw res.error;
        const rows = (res.data ?? []) as HqEinsatzStepRow[];
        out.push(...rows);
        got += rows.length;
        const total = res.count ?? got;
        if (got >= total) break;
        if (!rows.length) throw new Error('einsatz steps page came back empty before the count was reached');
      }
    }
    return out;
  }
}

function nowIso(): string {
  return new Date().toISOString();
}

function toRow(e: Einsatz, uid: string): Partial<HqEinsatzRow> {
  return {
    user_id: uid,
    id: e.id,
    title: e.title,
    activity: e.activity,
    status: e.status,
    planned_at: e.plannedAt,
    start_location: e.startLocation,
    deleted_at: e.deletedAt,
    updated_at: e.updatedAt,
  };
}

/** A step as the `hq_replace_einsatz_steps` payload (the RPC supplies einsatz_id and user_id). */
function stepToJson(s: EinsatzStep): Record<string, unknown> {
  return {
    ord: s.ord,
    kind: s.kind,
    label: s.label,
    location: s.location,
    system: s.system,
    class_name: s.className,
    qty: s.qty,
    supply_id: s.supplyId,
    mission_ref: s.missionRef,
    state: s.state,
    done_at: s.doneAt,
    done_by: s.doneBy,
  };
}

function fromRow(r: HqEinsatzRow, steps: readonly HqEinsatzStepRow[]): Einsatz {
  return {
    id: r.id,
    title: r.title,
    activity: r.activity,
    status: r.status,
    plannedAt: r.planned_at,
    startLocation: r.start_location,
    steps: [...steps].sort((a, b) => a.ord - b.ord).map(stepFromRow),
    updatedAt: r.updated_at,
    deletedAt: r.deleted_at,
    dirty: false,
  };
}

function stepFromRow(s: HqEinsatzStepRow): EinsatzStep {
  return {
    ord: s.ord,
    kind: s.kind,
    label: s.label,
    location: s.location,
    system: s.system,
    className: s.class_name,
    qty: s.qty,
    supplyId: s.supply_id,
    missionRef: s.mission_ref,
    state: s.state,
    doneAt: s.done_at,
    doneBy: s.done_by,
  };
}

function readCache(uid: string): CacheShape | null {
  try {
    let raw = localStorage.getItem(einsatzCacheKey(uid));
    if (!raw) {
      // Old shared key: adopt it only for the account it was written for, then drop it.
      const old = localStorage.getItem(EINSATZ_CACHE_KEY);
      if (old && (JSON.parse(old) as { uid?: unknown } | null)?.uid === uid) {
        raw = old;
        localStorage.removeItem(EINSATZ_CACHE_KEY);
      }
    }
    const parsed: unknown = raw ? JSON.parse(raw) : null;
    if (!parsed || typeof parsed !== 'object') return null;
    const o = parsed as Record<string, unknown>;
    if (o['uid'] !== uid || !Array.isArray(o['rows'])) return null;
    const rows = (o['rows'] as Einsatz[]).filter(
      (e) => e && typeof e.id === 'string' && typeof e.title === 'string' && Array.isArray(e.steps),
    );
    return { uid, wm: typeof o['wm'] === 'string' ? o['wm'] : null, rows };
  } catch (err) {
    logWarn('hq', 'einsatz cache read failed', err);
    return null;
  }
}
