import { Injectable, inject } from '@angular/core';
import { SupabaseClientProvider } from '../core/supabase.client';
import { logWarn } from '../core/log';
import { CARD_PAYLOAD_KEYS, CodexKind, CodexListRow, CodexService } from './codex.service';
import { CodexBuild } from './codex.types';
import { comparePatchVersion } from './codex-format';
import { DIFF_LOOKBACK, diffPair } from './codex-diff-pair';

export { DIFF_LOOKBACK, diffPair } from './codex-diff-pair';

/** PostgREST answers at most this many rows per request (project max_rows). */
export const BUILD_DIFF_PAGE_SIZE = 1000;
/** Paging guard: ~30× today's ship count (338 in 4.10 LIVE). */
const MAX_PAGES = 10;
/** How many added ships the diff resolves to full rows. */
export const ADDED_SHIPS_LIMIT = 24;

/** Catalog table per kind whose class names the build diff can compare. */
const DIFF_TABLE = {
  weapon: 'codex_weapons',
  component: 'codex_components',
  item: 'codex_items',
} as const;

/** Kinds whose index can sort "new this patch first". */
export const NEW_SORT_KINDS: readonly CodexKind[] = ['ship', 'weapon', 'component', 'item'];

/**
 * Mirror of `NON_SHIP_VEHICLE_PREFIXES` in codex.service.ts (salvage wrecks,
 * orbital sentries, probes — filed as vehicles, flown by nobody). Kept in step
 * by hand so the diff counts the same ships the default browse lists.
 */
const NON_SHIP_VEHICLE_PREFIXES = ['SalvageableDebris', 'Orbital_Sentry', 'probe_'] as const;

/** New and changed class names of the current build's patch for one kind (`codex_patch_news`). */
export interface PatchNews {
  added: string[];
  changed: string[];
}

/** What one recorded patch brought for one kind: its patch version and its new and changed class names. */
export interface PatchNewsGroup extends PatchNews {
  patch: string;
}

/** Rows read per history table and kind: far above what a few patches record. */
const HISTORY_LIMIT = 1000;

/**
 * Groups the ingest-time record (`codex_patch_first_seen` + `codex_patch_changed`) by patch,
 * newest patch first. A name new in a patch is not listed as changed in it too.
 */
export function groupPatchHistory(
  firstSeen: readonly { class_name?: string | null; first_patch?: string | null }[],
  changed: readonly { class_name?: string | null; patch_version?: string | null }[],
  compare: (a: string, b: string) => number,
): PatchNewsGroup[] {
  const by = new Map<string, PatchNewsGroup>();
  const group = (patch: string) => {
    let g = by.get(patch);
    if (!g) by.set(patch, (g = { patch, added: [], changed: [] }));
    return g;
  };
  for (const r of firstSeen) if (r.class_name && r.first_patch) group(r.first_patch).added.push(r.class_name);
  for (const r of changed) {
    if (!r.class_name || !r.patch_version) continue;
    const g = group(r.patch_version);
    if (!g.added.includes(r.class_name)) g.changed.push(r.class_name);
  }
  return [...by.values()].sort((a, b) => compare(b.patch, a.patch));
}

/** Class names in `current` that `previous` does not have, in `current` order. */
export function addedClassNames(current: readonly string[], previous: readonly string[]): string[] {
  const before = new Set(previous);
  const seen = new Set<string>();
  const out: string[] = [];
  for (const cn of current) {
    if (!cn || before.has(cn) || seen.has(cn)) continue;
    seen.add(cn);
    out.push(cn);
  }
  return out;
}

/**
 * Build diff over whole builds, not over a preloaded slice: which ships the
 * current LIVE build has that the previous LIVE build did not. The Bridge's
 * "Fresh this patch" lane used to diff only the stats of the 60 ships it had
 * already loaded, so a hull added by the patch never showed up there.
 *
 * Cheap by design: one `class_name`-only read per build (≈340 rows, ≈14 kB,
 * 0.15–0.4 s against prod with the anon key), a set difference in the client,
 * then one `in(class_name)` read for at most {@link ADDED_SHIPS_LIMIT} rows.
 * Best-effort: no previous build or any failure yields `[]`.
 */
@Injectable({ providedIn: 'root' })
export class CodexBuildDiffService {
  private readonly sb = inject(SupabaseClientProvider);
  private readonly codex = inject(CodexService);
  private memo: { buildId: string | null; rows: Promise<CodexListRow[]> } | null = null;
  private namesMemo = new Map<string, Promise<string[]>>();
  private pairMemo: { buildId: string | null; pair: Promise<[CodexBuild, CodexBuild] | null> } | null = null;
  private newsMemo = new Map<string, Promise<PatchNews>>();
  private historyMemo = new Map<string, Promise<PatchNewsGroup[]>>();
  /** Set once the RPC answered "not found" — later diffs skip straight to the paged path. */
  private rpcMissing = false;

  /**
   * {@link addedShips}, read once per current build — the Codex search shows
   * "New in this patch" every time its field opens empty, and the diff costs
   * three reads.
   */
  addedShipsMemo(): Promise<CodexListRow[]> {
    const buildId = this.codex.build()?.id ?? null;
    if (this.memo?.buildId !== buildId || !this.memo) this.memo = { buildId, rows: this.addedShips() };
    return this.memo.rows;
  }

  /**
   * Class names new in the current LIVE build for one kind, in current-build
   * order (ships in diff order) — read once per build and kind. Kinds outside
   * {@link NEW_SORT_KINDS}, no previous build or any failure yield `[]`.
   */
  addedClassNamesMemo(kind: CodexKind): Promise<string[]> {
    if (kind === 'ship') return this.addedShipsMemo().then((rows) => rows.map((r) => r.classNameSlug));
    const key = `${this.codex.build()?.id ?? ''}:${kind}`;
    let hit = this.namesMemo.get(key);
    if (!hit) {
      hit = this.addedClassNames(kind);
      this.namesMemo.set(key, hit);
    }
    return hit;
  }

  /**
   * Class names present in both of the two newest LIVE builds whose numeric
   * payload leaves differ ("aktualisiert"), from `codex_changed_class_names` —
   * read once per build and kind. Best-effort: kinds outside
   * {@link NEW_SORT_KINDS}, no previous build, a missing function or any
   * failure yield `[]` (no paged fallback: the answer is precomputed
   * server-side, there is nothing to page).
   */
  changedClassNamesMemo(kind: CodexKind): Promise<string[]> {
    const key = `changed:${this.codex.build()?.id ?? ''}:${kind}`;
    let hit = this.namesMemo.get(key);
    if (!hit) {
      hit = this.changedClassNames(kind);
      this.namesMemo.set(key, hit);
    }
    return hit;
  }

  /** The current build and its diff baseline ({@link diffPair}), read once per current build. */
  private pair(): Promise<[CodexBuild, CodexBuild] | null> {
    const buildId = this.codex.build()?.id ?? null;
    if (this.pairMemo?.buildId !== buildId || !this.pairMemo) {
      const pair = this.codex.recentLiveBuilds(DIFF_LOOKBACK).then(diffPair);
      this.pairMemo = { buildId, pair };
      // recentLiveBuilds answers a failed read with []: no pair is not remembered, the next diff reads again.
      void pair.then((p) => {
        if (!p && this.pairMemo?.pair === pair) this.pairMemo = null;
      });
    }
    return this.pairMemo.pair;
  }

  /**
   * What the current build's patch brought for one kind, from the ingest-time
   * record (`codex_patch_news(p_kind)` -> class_name + 'added'|'changed'): the
   * truth that survives re-uploads of the same patch, unlike the two-build diff
   * (empty when both builds are the same patch). Read once per build and kind.
   * Best-effort: a missing function (PGRST202) or any error yields no rows
   * (logged), and the callers fall back to the two-build diff.
   */
  patchNewsMemo(kind: CodexKind): Promise<PatchNews> {
    const key = `news:${this.codex.build()?.id ?? ''}:${kind}`;
    let hit = this.newsMemo.get(key);
    if (!hit) {
      hit = this.patchNews(kind);
      this.newsMemo.set(key, hit);
    }
    return hit;
  }

  /**
   * Every recorded patch's news for one kind, newest patch first (admin feedback #318:
   * when the current patch brought little, the Codex list goes on with the patches
   * before it). Reads the two record tables directly (anon-readable, no payload).
   * Best-effort: any failure yields `[]` (logged). Read once per build and kind.
   */
  patchHistoryMemo(kind: CodexKind): Promise<PatchNewsGroup[]> {
    const key = `history:${this.codex.build()?.id ?? ''}:${kind}`;
    let hit = this.historyMemo.get(key);
    if (!hit) {
      hit = this.patchHistory(kind);
      this.historyMemo.set(key, hit);
    }
    return hit;
  }

  private async patchHistory(kind: CodexKind): Promise<PatchNewsGroup[]> {
    if (!NEW_SORT_KINDS.includes(kind)) return [];
    try {
      const [seen, changed] = await Promise.all([
        this.sb.client
          .from('codex_patch_first_seen')
          .select('class_name, first_patch')
          .eq('kind', kind)
          .not('first_patch', 'is', null)
          .order('recorded_at', { ascending: false })
          .limit(HISTORY_LIMIT),
        this.sb.client
          .from('codex_patch_changed')
          .select('class_name, patch_version')
          .eq('kind', kind)
          .order('recorded_at', { ascending: false })
          .limit(HISTORY_LIMIT),
      ]);
      if (seen.error) throw seen.error;
      if (changed.error) throw changed.error;
      return groupPatchHistory(seen.data ?? [], changed.data ?? [], comparePatchVersion);
    } catch (error) {
      logWarn('codex', `patch history (${kind}) failed`, error);
      return [];
    }
  }

  private async patchNews(kind: CodexKind): Promise<PatchNews> {
    const none: PatchNews = { added: [], changed: [] };
    if (!NEW_SORT_KINDS.includes(kind)) return none;
    try {
      const { data, error } = await this.sb.client.rpc('codex_patch_news', { p_kind: kind });
      if (error) throw error;
      const out: PatchNews = { added: [], changed: [] };
      for (const r of (data ?? []) as { class_name?: string; status?: string }[]) {
        if (!r?.class_name) continue;
        if (r.status === 'added') out.added.push(r.class_name);
        else if (r.status === 'changed') out.changed.push(r.class_name);
      }
      return out;
    } catch (error) {
      logWarn('codex', `patch news (${kind}) failed`, error);
      return none;
    }
  }

  private async changedClassNames(kind: CodexKind): Promise<string[]> {
    if (!NEW_SORT_KINDS.includes(kind)) return [];
    try {
      const pair = await this.pair();
      if (!pair) return [];
      const { data, error } = await this.sb.client.rpc('codex_changed_class_names', {
        p_kind: kind,
        p_current: pair[0].id,
        p_previous: pair[1].id,
      });
      if (error) throw error;
      return ((data ?? []) as string[]).filter((cn) => !!cn);
    } catch (error) {
      logWarn('codex', `build diff (changed ${kind}) failed`, error);
      return [];
    }
  }

  private async addedClassNames(kind: CodexKind): Promise<string[]> {
    const table = DIFF_TABLE[kind as keyof typeof DIFF_TABLE];
    if (!table) return [];
    try {
      const pair = await this.pair();
      if (!pair) return [];
      const viaRpc = await this.addedViaRpc(kind, pair[0].id, pair[1].id);
      if (viaRpc) return viaRpc;
      const [cur, prev] = await Promise.all([this.classNames(table, pair[0].id), this.classNames(table, pair[1].id)]);
      return addedClassNames(cur, prev);
    } catch (error) {
      logWarn('codex', `build diff (added ${kind}) failed`, error);
      return [];
    }
  }

  /**
   * The class names `current` has and `previous` lacks, from one
   * `codex_added_class_names` request (no row cap). `null` when the function is
   * not deployed yet (PGRST202 / 404 — a deploy-order slip): the caller then
   * falls back to the paged diff below. Any other failure throws.
   */
  private async addedViaRpc(kind: CodexKind, current: string, previous: string): Promise<string[] | null> {
    if (this.rpcMissing) return null;
    const { data, error } = await this.sb.client.rpc('codex_added_class_names', {
      p_kind: kind,
      p_current: current,
      p_previous: previous,
    });
    if (error) {
      const e = error as { code?: string; status?: number };
      if (e.code === 'PGRST202' || e.status === 404) {
        this.rpcMissing = true;
        logWarn('codex', 'codex_added_class_names missing, using the paged build diff', error);
        return null;
      }
      throw error;
    }
    return ((data ?? []) as string[]).filter((cn) => !!cn);
  }

  /** Every class name of one build in one catalog table, paged past the row cap. */
  private async classNames(table: string, buildId: string): Promise<string[]> {
    const out: string[] = [];
    for (let page = 0; page < MAX_PAGES; page++) {
      const from = page * BUILD_DIFF_PAGE_SIZE;
      const { data, error } = await this.sb.client
        .from(table)
        .select('class_name')
        .eq('build_id', buildId)
        .order('class_name', { ascending: true })
        .range(from, from + BUILD_DIFF_PAGE_SIZE - 1);
      if (error) throw error;
      const rows = (data ?? []) as { class_name: string | null }[];
      for (const r of rows) if (r.class_name) out.push(r.class_name);
      if (rows.length < BUILD_DIFF_PAGE_SIZE) break;
    }
    return out;
  }

  /** Ships new in the current LIVE build, as list rows of the current build. */
  async addedShips(limit = ADDED_SHIPS_LIMIT): Promise<CodexListRow[]> {
    try {
      const pair = await this.pair();
      if (!pair) return [];
      const [current, previous] = pair;
      let added = await this.addedViaRpc('ship', current.id, previous.id);
      if (!added) {
        const [cur, prev] = await Promise.all([
          this.shipClassNames(current.id),
          this.shipClassNames(previous.id),
        ]);
        added = addedClassNames(cur, prev);
      }
      added = added.slice(0, limit);
      if (added.length === 0) return [];
      const rows = await this.codex.getShipsByClassNames(added, [...CARD_PAYLOAD_KEYS, 'dimensions']);
      return added.map((cn) => rows.get(cn)).filter((r): r is CodexListRow => !!r);
    } catch (error) {
      logWarn('codex', 'build diff (added ships) failed', error);
      return [];
    }
  }

  /**
   * Every ship class name of one build under the default browse filters
   * (buyable, named, no wrecks/sentries/probes), paged past the row cap.
   */
  private async shipClassNames(buildId: string): Promise<string[]> {
    const out: string[] = [];
    for (let page = 0; page < MAX_PAGES; page++) {
      const from = page * BUILD_DIFF_PAGE_SIZE;
      let query = this.sb.client
        .from('codex_ships')
        .select('class_name')
        .eq('build_id', buildId)
        .eq('is_variant', false)
        .or('name_localized.is.null,name_localized.not.like.!*');
      for (const prefix of NON_SHIP_VEHICLE_PREFIXES) query = query.not('class_name', 'ilike', `${prefix}*`);
      const { data, error } = await query
        .order('class_name', { ascending: true })
        .range(from, from + BUILD_DIFF_PAGE_SIZE - 1);
      if (error) throw error;
      const rows = (data ?? []) as { class_name: string | null }[];
      for (const r of rows) if (r.class_name) out.push(r.class_name);
      if (rows.length < BUILD_DIFF_PAGE_SIZE) break;
    }
    return out;
  }
}
