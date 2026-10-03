import { Injectable, inject } from '@angular/core';
import { SupabaseClientProvider } from '../core/supabase.client';
import { logWarn } from '../core/log';
import { CodexListRow, CodexService } from './codex.service';

/** PostgREST answers at most this many rows per request (project max_rows). */
export const BUILD_DIFF_PAGE_SIZE = 1000;
/** Paging guard: ~30× today's ship count (338 in 4.10 LIVE). */
const MAX_PAGES = 10;
/** How many added ships the diff resolves to full rows. */
export const ADDED_SHIPS_LIMIT = 24;

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
