import { Injectable, inject, signal } from '@angular/core';

import { CodexService } from '../../codex/codex.service';
import { logWarn } from '../../core/log';
import { SupabaseClientProvider } from '../../core/supabase.client';

/**
 * Scrap (dismantle) knowledge for the Bestand, read from the Codex.
 *
 * Source: `codex_blueprints.dismantle_yield` / `dismantlable` (migration
 * 20261109000500), filled by the data uploader from the game files. A NULL in
 * the database is UNKNOWN: it never becomes 'no' and never a guessed 'yes'.
 * The row belongs to the blueprint whose `output_class_name` is the item.
 */

export type ScrapState = 'yes' | 'no' | 'unknown';

export interface ScrapYieldLine {
  /** Class name of the material handed back. */
  material: string;
  amount: number;
}

export interface ScrapInfo {
  state: ScrapState;
  /** Present only when the game record names a yield. */
  yield?: ScrapYieldLine[];
}

/** The columns of a codex_blueprints row this accessor reads. */
export interface ScrapRow {
  output_class_name?: string | null;
  dismantle_yield?: unknown;
  dismantlable?: boolean | null;
}

export const SCRAP_UNKNOWN: ScrapInfo = { state: 'unknown' };

function parseYield(raw: unknown): ScrapYieldLine[] {
  if (!Array.isArray(raw)) return [];
  const out: ScrapYieldLine[] = [];
  for (const e of raw) {
    if (!e || typeof e !== 'object') continue;
    const { material, amount } = e as { material?: unknown; amount?: unknown };
    if (typeof material === 'string' && material && typeof amount === 'number' && Number.isFinite(amount)) {
      out.push({ material, amount });
    }
  }
  return out;
}

/**
 * Scrap state of one codex row. A missing row or a row without data is
 * 'unknown'. 'no' only when the record says `dismantlable === false`;
 * 'yes' when it says true or names a non-empty yield.
 */
export function scrapInfo(row: ScrapRow | null | undefined): ScrapInfo {
  if (!row) return SCRAP_UNKNOWN;
  const lines = parseYield(row.dismantle_yield);
  if (row.dismantlable === false) return { state: 'no' };
  if (row.dismantlable === true || lines.length > 0) {
    return lines.length > 0 ? { state: 'yes', yield: lines } : { state: 'yes' };
  }
  return SCRAP_UNKNOWN;
}

/** Same lookup over an index keyed by item class name (what the service holds). */
export function scrapInfoOf(className: string | null | undefined, index: ReadonlyMap<string, ScrapRow>): ScrapInfo {
  return className ? scrapInfo(index.get(className)) : SCRAP_UNKNOWN;
}

const COLUMNS = 'output_class_name, dismantle_yield, dismantlable';
const CHUNK = 200;

@Injectable({ providedIn: 'root' })
export class ScrapInfoService {
  private readonly sb = inject(SupabaseClientProvider);
  private readonly codex = inject(CodexService);

  private readonly index = signal<ReadonlyMap<string, ScrapRow>>(new Map());
  private readonly requested = new Set<string>();

  /** Reactive: read inside a computed/template, call {@link load} to fill it. */
  info(className: string | null | undefined): ScrapInfo {
    return scrapInfoOf(className, this.index());
  }

  /** Fetches the scrap columns for these items once; a failure leaves them 'unknown'. */
  async load(classNames: readonly string[]): Promise<void> {
    const todo = [...new Set(classNames)].filter((c) => c && !this.requested.has(c));
    if (todo.length === 0) return;
    const build = await this.codex.loadCurrentBuild();
    if (!build) return;
    for (const c of todo) this.requested.add(c);
    const next = new Map(this.index());
    for (let i = 0; i < todo.length; i += CHUNK) {
      const slice = todo.slice(i, i + CHUNK);
      const { data, error } = await this.sb.client
        .from('codex_blueprints')
        .select(COLUMNS)
        .eq('build_id', build.id)
        .in('output_class_name', slice);
      if (error) {
        // Not requested for good: a later call retries these.
        for (const c of slice) this.requested.delete(c);
        logWarn('scrap-info', 'load failed', error);
        continue;
      }
      for (const row of (data ?? []) as ScrapRow[]) {
        if (row.output_class_name) next.set(row.output_class_name, row);
      }
    }
    this.index.set(next);
  }
}
