import { Injectable, inject } from '@angular/core';
import { SupabaseClientProvider } from '../core/supabase.client';
import { logWarn } from '../core/log';
import { CodexKind, CodexListRow, CodexService } from './codex.service';

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

  private async addedClassNames(kind: CodexKind): Promise<string[]> {
    const table = DIFF_TABLE[kind as keyof typeof DIFF_TABLE];
    if (!table) return [];
    try {
      const builds = await this.codex.recentLiveBuilds(2);
      if (builds.length < 2) return [];
      const [cur, prev] = await Promise.all([this.classNames(table, builds[0].id), this.classNames(table, builds[1].id)]);
      return addedClassNames(cur, prev);
    } catch (error) {
      logWarn('codex', `build diff (added ${kind}) failed`, error);
      return [];
    }
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
      const builds = await this.codex.recentLiveBuilds(2);
      if (builds.length < 2) return [];
      const [current, previous] = builds;
      const [cur, prev] = await Promise.all([
        this.shipClassNames(current.id),
        this.shipClassNames(previous.id),
      ]);
      const added = addedClassNames(cur, prev).slice(0, limit);
      if (added.length === 0) return [];
      const rows = await this.codex.getShipsByClassNames(added);
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
