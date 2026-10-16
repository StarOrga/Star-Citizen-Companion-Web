import { Injectable, InjectionToken, Injector, NgZone, inject } from '@angular/core';
import { SupabaseClientProvider } from '../core/supabase.client';
import { logWarn } from '../core/log';
import { CodexKind, CodexService, CompatibleItem } from './codex.service';
import { ammoClassNamesFor } from './codex-equipped-stats';
import { isConfigurableSection } from './ship-module-sections';
import type { LayoutSection } from './codex-hardpoint-layout.component';

/**
 * What the swap picker needs to list a hardpoint's alternatives (admin
 * feedback #244): the candidates that fit, the payload of every candidate and
 * of the installed item, and the ammunition payload of every candidate's round.
 */
export interface SwapSourceData {
  /** The compatible candidates, in the order the database returned them. */
  items: CompatibleItem[];
  /** Entity payloads by class name — every candidate plus the installed item. */
  payloads: Map<string, { kind: CodexKind; payload: unknown }>;
  /** Ammunition payloads by AMMO class name. */
  ammo: Map<string, unknown>;
}

/** The slot a list is asked for — exactly the inputs that decide its content. */
export interface SwapSourceQuery {
  /** The installed item; its own attach type/size win over `types`/`size`. */
  installed: string | null;
  /** What an unfitted bay accepts (the host's `attachTypes`). */
  types: readonly string[];
  size: number | null;
}

/**
 * Schedules one low-priority preload step. The default waits for the browser
 * to be idle — and before the FIRST step of a batch also a moment longer, so
 * the ship page's own reads (hull, KPI cohort, model) go first. Specs swap in
 * a synchronous or manual scheduler.
 */
export type SwapPreloadScheduler = (run: () => void, first: boolean) => void;

/** Head start the host page's own reads get before the first preload step. */
export const SWAP_PRELOAD_START_DELAY_MS = 1500;

const defaultScheduler: SwapPreloadScheduler = (run, first) => {
  const ric = (globalThis as { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number })
    .requestIdleCallback;
  const idle = () => (typeof ric === 'function' ? ric(run, { timeout: 4000 }) : setTimeout(run, 250));
  if (first) setTimeout(idle, SWAP_PRELOAD_START_DELAY_MS);
  else idle();
};

/**
 * Background work runs OUTSIDE the Angular zone: a preload is never a reason
 * for the page (or a spec's `whenStable()`) to count as busy, and it triggers
 * no change detection of its own — the cache is read when a picker opens.
 */
export const SWAP_PRELOAD_SCHEDULER = new InjectionToken<SwapPreloadScheduler>('SWAP_PRELOAD_SCHEDULER', {
  providedIn: 'root',
  factory: () => {
    const zone = inject(NgZone);
    return (run, first) => zone.runOutsideAngular(() => defaultScheduler(run, first));
  },
});

/**
 * Background lists in flight at once. The ship page loads its own data in
 * parallel, and a cold page once drained PostgREST's connection pool with ~75
 * parallel payload reads (PGRST003 → /unavailable, memory
 * sc-unavailable-pool-exhaustion) — so the preload stays far below the
 * client-wide PAYLOAD_READS_IN_FLIGHT budget. A picker the user opens is never
 * queued behind it.
 */
export const SWAP_PRELOAD_IN_FLIGHT = 2;

/** Lists kept per build — a capital ship has a few dozen distinct slot keys. */
export const SWAP_CACHE_MAX = 120;

/** Supabase rejects very long `in.()` lists — the fallback hydrates in batches. */
const HYDRATE_CHUNK = 100;

/**
 * Loads, caches and preloads the swap picker's candidate lists.
 *
 * - ONE call per list through the `codex_swap_candidates` RPC (lean payloads,
 *   ammo joined server-side) instead of the old seed → compatible → payloads →
 *   ammo chain. While the RPC is missing (deploy order: the site can go live
 *   before `db push`) the chain is the fallback, and preloading stops.
 * - Cached per build in memory, deduplicated by (build, installed item,
 *   accepted types, size): two identical hardpoints share one list, and the
 *   second opening of a picker never refetches.
 * - `preload()` warms the lists of a ship's swappable slots in the background,
 *   at most SWAP_PRELOAD_IN_FLIGHT at a time, each step on an idle callback.
 */
@Injectable({ providedIn: 'root' })
export class CodexSwapCandidatesService {
  // Resolved on first use: every hardpoint layout holds this service, and a
  // layout that never loads a list should not construct the data layer.
  private readonly injector = inject(Injector);
  private get sb(): SupabaseClientProvider {
    return this.injector.get(SupabaseClientProvider);
  }
  private get codex(): CodexService {
    return this.injector.get(CodexService);
  }
  private readonly schedule = inject(SWAP_PRELOAD_SCHEDULER);
  /** Views currently interested in preloading — see `retainPreload()`. */
  private holders = 0;

  private buildId: string | null = null;
  private readonly cache = new Map<string, Promise<SwapSourceData>>();
  /** Set once PostgREST reports the RPC as unknown — the session stops asking. */
  private rpcMissing = false;

  private readonly queue: SwapSourceQuery[] = [];
  private readonly queued = new Set<string>();
  private inFlight = 0;
  private pumpScheduled = false;
  /** A batch has started — later steps skip the head-start delay. */
  private started = false;
  private generation = 0;

  /** The list for one slot — from the cache when it has been loaded (or is loading). */
  async load(q: SwapSourceQuery): Promise<SwapSourceData> {
    const build = await this.codex.loadCurrentBuild();
    if (!build) return { items: [], payloads: new Map(), ammo: new Map() };
    this.useBuild(build.id);
    const key = swapSourceKey(build.id, q);
    const hit = this.cache.get(key);
    if (hit) {
      // Refresh recency so the cap evicts the least recently used list.
      this.cache.delete(key);
      this.cache.set(key, hit);
      return hit;
    }
    const pending = this.fetch(build.id, q);
    this.cache.set(key, pending);
    while (this.cache.size > SWAP_CACHE_MAX) {
      const oldest = this.cache.keys().next().value as string;
      this.cache.delete(oldest);
    }
    // A failure is never cached — the next open (or the retry button) asks again.
    pending.catch(() => {
      if (this.cache.get(key) === pending) this.cache.delete(key);
    });
    return pending;
  }

  /**
   * Warm the lists for these slots in the background. Already cached, loading
   * or queued keys are skipped; nothing happens once the RPC is known missing
   * (the fallback chain is several requests per list — too heavy to run for
   * every slot of a ship).
   */
  preload(queries: readonly SwapSourceQuery[]): void {
    if (this.rpcMissing) return;
    for (const q of queries) {
      const key = swapQueryKey(q);
      if (this.queued.has(key)) continue;
      this.queued.add(key);
      this.queue.push(q);
    }
    this.schedulePump();
  }

  /**
   * A view that triggers preloads holds the queue open; once the last holder
   * is gone (the ship page was left) everything not yet started is dropped.
   * Returns the release function.
   */
  retainPreload(): () => void {
    this.holders += 1;
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.holders -= 1;
      if (this.holders <= 0) {
        this.holders = 0;
        this.cancelPreload();
      }
    };
  }

  /** Drop every queued (not yet started) preload — the host page is gone. */
  cancelPreload(): void {
    this.generation += 1;
    this.queue.length = 0;
    this.queued.clear();
    this.started = false;
  }

  private schedulePump(): void {
    if (this.pumpScheduled || this.queue.length === 0) return;
    this.pumpScheduled = true;
    const gen = this.generation;
    const first = !this.started;
    this.started = true;
    this.schedule(() => {
      this.pumpScheduled = false;
      if (gen === this.generation) void this.pump();
      else this.schedulePump();
    }, first);
  }

  private async pump(): Promise<void> {
    while (this.inFlight < SWAP_PRELOAD_IN_FLIGHT && this.queue.length > 0 && !this.rpcMissing) {
      const q = this.queue.shift()!;
      this.inFlight += 1;
      const gen = this.generation;
      void (async () => {
        try {
          await this.load(q);
        } catch {
          // Logged by fetch(); a failed preload just leaves the key uncached.
        } finally {
          this.inFlight -= 1;
          if (gen === this.generation) this.queued.delete(swapQueryKey(q));
          if (this.rpcMissing) this.cancelPreload();
          else this.schedulePump();
        }
      })();
    }
  }

  private useBuild(id: string): void {
    if (this.buildId === id) return;
    this.buildId = id;
    this.cache.clear();
  }

  private async fetch(buildId: string, q: SwapSourceQuery): Promise<SwapSourceData> {
    try {
      if (!this.rpcMissing) {
        const viaRpc = await this.fetchViaRpc(buildId, q);
        if (viaRpc) return viaRpc;
      }
      return await this.fetchViaChain(q);
    } catch (error) {
      logWarn('codex', 'swap candidates failed', error);
      throw error;
    }
  }

  /** `null` = the RPC does not exist (yet) — the caller falls back. */
  private async fetchViaRpc(buildId: string, q: SwapSourceQuery): Promise<SwapSourceData | null> {
    const { data, error, status } = await this.sb.client.rpc('codex_swap_candidates', {
      p_build_id: buildId,
      p_installed: q.installed,
      p_types: cleanTypes(q.types),
      p_size: q.size,
    });
    if (error) {
      if (isMissingRpc(error, status)) {
        this.rpcMissing = true;
        logWarn('codex', 'codex_swap_candidates missing — falling back to the chained swap load', {
          code: error.code,
          status,
        });
        return null;
      }
      throw error;
    }
    return parseSwapRpcRows((data ?? []) as Record<string, unknown>[]);
  }

  /** The pre-#244 path: seed → compatible items → payloads → ammo, one after the other. */
  private async fetchViaChain(q: SwapSourceQuery): Promise<SwapSourceData> {
    const payloads = new Map<string, { kind: CodexKind; payload: unknown }>();
    const ammo = new Map<string, unknown>();
    const installedName = q.installed;
    if (installedName) {
      for (const [k, v] of await this.codex.getEntityPayloads([installedName])) payloads.set(k, v);
    }
    const installed = installedName ? payloads.get(installedName) : undefined;
    const attachType = (installed?.payload as { attachType?: string | null } | undefined)?.attachType;
    const size = q.size ?? ((installed?.payload as { size?: number | null } | undefined)?.size ?? null);
    const types = attachType ? [attachType] : cleanTypes(q.types);
    if (types.length === 0) return { items: [], payloads, ammo };

    const items = await this.codex.getCompatibleItems({ types, minSize: size, maxSize: size });
    const names = items.map((i) => i.classNameSlug).filter((n) => !payloads.has(n));
    for (const [k, v] of await hydrate(names, (n) => this.codex.getEntityPayloads(n))) payloads.set(k, v);
    const allNames = [...new Set([...items.map((i) => i.classNameSlug), ...(installedName ? [installedName] : [])])];
    // The payload names the round (schema 6), so a launcher candidate lists
    // ITS decoy's values — the convention only fills in for older builds.
    const ammoNames = ammoClassNamesFor(allNames, (cn) => payloads.get(cn)?.payload);
    for (const [k, v] of await hydrate(ammoNames, (n) => this.codex.getAmmoPayloads(n))) ammo.set(k, v);
    return { items, payloads, ammo };
  }
}

/** Cache key of a slot list within one build. */
export function swapQueryKey(q: SwapSourceQuery): string {
  return [q.installed ?? '', cleanTypes(q.types).sort().join(','), q.size ?? ''].join('|');
}

export function swapSourceKey(buildId: string, q: SwapSourceQuery): string {
  return `${buildId}|${swapQueryKey(q)}`;
}

function cleanTypes(types: readonly string[] | null | undefined): string[] {
  return [...new Set((types ?? []).filter((t): t is string => typeof t === 'string' && t.length > 0))];
}

/** PostgREST "function not found" (PGRST202), Postgres 42883, or a bare 404. */
export function isMissingRpc(error: { code?: string | null } | null | undefined, status?: number | null): boolean {
  return error?.code === 'PGRST202' || error?.code === '42883' || status === 404;
}

/** Turn `codex_swap_candidates` rows into the picker's data shape. */
export function parseSwapRpcRows(rows: Record<string, unknown>[]): SwapSourceData {
  const items: CompatibleItem[] = [];
  const payloads = new Map<string, { kind: CodexKind; payload: unknown }>();
  const ammo = new Map<string, unknown>();
  for (const r of rows) {
    const className = r['class_name'] as string;
    if (!className) continue;
    const kind = r['kind'] as CodexKind;
    if (!payloads.has(className)) payloads.set(className, { kind, payload: r['payload'] ?? null });
    const ammoName = r['ammo_class_name'] as string | null;
    if (ammoName && r['ammo_payload'] != null) ammo.set(ammoName, r['ammo_payload']);
    if (r['role'] !== 'candidate') continue;
    items.push({
      kind,
      classNameSlug: className,
      nameLocalized: (r['name_localized'] as string | null) ?? null,
      manufacturerCode: (r['manufacturer_code'] as string | null) ?? null,
      size: (r['size'] as number | null) ?? null,
      subType: (r['sub_type'] as string | null) ?? null,
      grade: (r['grade'] as string | null) ?? null,
    });
  }
  return { items, payloads, ammo };
}

/**
 * The lists worth warming on a ship page: every FITTED slot and sub-slot in a
 * section the user can actually swap (the same blocks whose cards open the
 * picker). Unfitted bays are left to the on-demand load — their accepted types
 * come from sibling inference the host does on click. Deduplicated by key.
 */
export function swapPreloadQueries(sections: readonly LayoutSection[]): SwapSourceQuery[] {
  const out = new Map<string, SwapSourceQuery>();
  const add = (installed: string | null, size: number | null) => {
    if (!installed) return;
    const q: SwapSourceQuery = { installed, types: [], size };
    const key = swapQueryKey(q);
    if (!out.has(key)) out.set(key, q);
  };
  for (const sec of sections) {
    if (!isConfigurableSection(sec.section)) continue;
    for (const slot of sec.slots) {
      add(slot.className, slot.size);
      for (const child of slot.children ?? []) add(child.className, child.size);
    }
  }
  return [...out.values()];
}

async function hydrate<T>(
  names: string[],
  fetch: (chunk: string[]) => Promise<Map<string, T>>,
): Promise<Map<string, T>> {
  const out = new Map<string, T>();
  for (let i = 0; i < names.length; i += HYDRATE_CHUNK) {
    const part = await fetch(names.slice(i, i + HYDRATE_CHUNK));
    for (const [k, v] of part) out.set(k, v);
  }
  return out;
}
