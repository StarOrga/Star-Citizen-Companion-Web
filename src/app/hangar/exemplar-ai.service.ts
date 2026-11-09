import { Injectable, inject } from '@angular/core';
import { TranslateService } from '@ngx-translate/core';
import { toErrorKey } from '../core/describe-error';
import { SupabaseClientProvider } from '../core/supabase.client';
import type { ConfigLoadoutEntry } from './hangar.types';

/** Hard limits, mirrored from the `exemplar-ai` edge function (which enforces them; the client clamps again). */
export const EXEMPLAR_NAME_MAX = 32;
export const EXEMPLAR_SUMMARY_MAX = 90;

/** One changed slot: the factory part and the part the player fitted instead (display names). */
export interface ExemplarPartChange {
  slot: string;
  from: string;
  to: string;
}

export interface ExemplarSummaryInput {
  shipName: string;
  /** The exemplar's current loadout (what the hash is made from). */
  loadout: readonly ConfigLoadoutEntry[];
  /** Werk part -> own part per differing slot. Empty = identical to Werk. */
  changes: readonly ExemplarPartChange[];
  /** Summary + hash already known to the caller (from the loaded config row); skips the read. */
  stored?: { summary: string | null; hash: string | null };
}

export interface ExemplarSummaryResult {
  /** The summary to show: fresh, or the stored one; null = none (empty state, no fake text). */
  summary: string | null;
  /** Hash of the loadout the summary belongs to. */
  hash: string;
  /** True when the function was called and a new summary was written. */
  regenerated: boolean;
  /** i18n key when something failed (already logged); the UI may ignore it. Null on success and on graceful skips. */
  errorKey: string | null;
}

/**
 * Stable hash of a loadout: order-independent (sorted by port), only what changes the build (port + class), FNV-1a 64
 * over a canonical string, hex. Pure; the same loadout always yields the same string.
 */
export function loadoutHash(loadout: readonly { portName: string; className: string }[]): string {
  const canon = loadout
    .map((e) => `${e.portName}\u0001${e.className}`)
    .sort()
    .join('\u0002');
  let h = 0xcbf29ce484222325n;
  for (let i = 0; i < canon.length; i++) {
    h ^= BigInt(canon.charCodeAt(i));
    h = (h * 0x100000001b3n) & 0xffffffffffffffffn;
  }
  return h.toString(16).padStart(16, '0');
}

const clamp = (v: string, max: number): string => Array.from(v.replace(/\s+/g, ' ').trim()).slice(0, max).join('');

/**
 * AI name and one-line summary for an own hangar exemplar (a `hangar_ship_configs` row), via the `exemplar-ai` Edge
 * Function (the key stays server-side). Nothing here throws into the UI: a failure is logged, mapped to an `errors.*`
 * key and answered with "no text". Output is a plain editable text, never labelled as AI.
 */
@Injectable({ providedIn: 'root' })
export class ExemplarAiService {
  private readonly sb = inject(SupabaseClientProvider);
  private readonly i18n = inject(TranslateService);
  private readonly inFlight = new Map<string, Promise<ExemplarSummaryResult>>();

  /**
   * A name suggestion for a new exemplar that differs from Werk. Returns null when nothing differs (no call is made),
   * when the function has no key / is rate limited / fails, or on any error.
   */
  async suggestName(shipName: string, changes: readonly ExemplarPartChange[]): Promise<string | null> {
    if (!changes.length || !shipName.trim()) return null;
    const text = await this.ask('exemplar_name', shipName, changes);
    return text ? clamp(text, EXEMPLAR_NAME_MAX) : null;
  }

  /**
   * Makes sure the stored summary matches the loadout: computes {@link loadoutHash}, compares with the stored hash and
   * calls the function ONLY when it differs (and the exemplar differs from Werk). The result is written to the config
   * row (`ai_summary`, `ai_summary_hash`, `ai_summary_at`). Call it when the user switches exemplar or leaves the page,
   * not on every edit. Concurrent calls for one exemplar share one request.
   */
  ensureSummary(exemplarId: string, input: ExemplarSummaryInput): Promise<ExemplarSummaryResult> {
    const hash = loadoutHash(input.loadout);
    const key = `${exemplarId}:${hash}`;
    const running = this.inFlight.get(key);
    if (running) return running;
    const p = this.run(exemplarId, input, hash).finally(() => this.inFlight.delete(key));
    this.inFlight.set(key, p);
    return p;
  }

  private async run(id: string, input: ExemplarSummaryInput, hash: string): Promise<ExemplarSummaryResult> {
    let stored = input.stored ?? null;
    try {
      if (!stored) stored = await this.readStored(id);
      if (stored.hash === hash) return { summary: stored.summary, hash, regenerated: false, errorKey: null };

      // Back on Werk (nothing differs): a leftover summary no longer describes it - clear it, no call.
      if (!input.changes.length) {
        if (stored.summary !== null || stored.hash !== null) await this.write(id, null, hash);
        return { summary: null, hash, regenerated: false, errorKey: null };
      }

      const text = await this.ask('exemplar_summary', input.shipName, input.changes);
      if (!text) return { summary: stored.summary, hash, regenerated: false, errorKey: null };
      const summary = clamp(text, EXEMPLAR_SUMMARY_MAX);
      await this.write(id, summary, hash);
      return { summary, hash, regenerated: true, errorKey: null };
    } catch (err) {
      return { summary: stored?.summary ?? null, hash, regenerated: false, errorKey: toErrorKey('hangar', 'exemplar summary', err, { id }) };
    }
  }

  private async readStored(id: string): Promise<{ summary: string | null; hash: string | null }> {
    const { data, error } = await this.sb.client
      .from('hangar_ship_configs')
      .select('ai_summary, ai_summary_hash' as '*')
      .eq('id', id)
      .maybeSingle();
    if (error) throw error;
    const row = (data ?? {}) as Record<string, unknown>;
    return {
      summary: typeof row['ai_summary'] === 'string' ? row['ai_summary'] : null,
      hash: typeof row['ai_summary_hash'] === 'string' ? row['ai_summary_hash'] : null,
    };
  }

  private async write(id: string, summary: string | null, hash: string): Promise<void> {
    // The generated DB types do not know the new columns yet (alpha norm: regenerated later), hence the cast.
    const patch = { ai_summary: summary, ai_summary_hash: hash, ai_summary_at: new Date().toISOString() } as never;
    const { error } = await this.sb.client.from('hangar_ship_configs').update(patch).eq('id', id);
    if (error) throw error;
  }

  /** The function call; any failure or non-"generated" status -> null (graceful, logged only for real errors). */
  private async ask(kind: 'exemplar_name' | 'exemplar_summary', ship: string, changes: readonly ExemplarPartChange[]): Promise<string | null> {
    try {
      const locale = this.i18n.getCurrentLang() === 'en' ? 'en' : 'de';
      const { data, error } = await this.sb.client.functions.invoke('exemplar-ai', { body: { kind, locale, ship, changes } });
      if (error) throw error;
      const text = (data as { status?: string; text?: unknown } | null)?.text;
      return typeof text === 'string' && text.trim() ? text : null;
    } catch (err) {
      toErrorKey('hangar', kind, err);
      return null;
    }
  }
}
