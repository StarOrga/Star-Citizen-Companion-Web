import { Injectable, inject } from '@angular/core';
import { SupabaseClientProvider } from '../../core/supabase.client';
import { GlossaryFilters, buildGlossaryQuery, monthStartUtc, revertPatch, sumLedger } from './translations.logic';

export interface TranslationSettings {
  enabled: boolean;
  upload_cap_usd: number;
  monthly_cap_usd: number;
}

export interface TranslationLanguage {
  lang: string;
  cig_folder: string;
  approved: boolean;
}

export interface TranslationJob {
  id: string;
  build_id: string;
  lang: string;
  mode: 'delta' | 'full';
  status: string;
  string_count: number | null;
  estimate_usd: number | null;
  spent_usd: number;
  stats: unknown;
  error: string | null;
  created_at: string;
  build: { patch_version: string; channel: string; build_number: string } | null;
}

export interface CurrentBuild {
  id: string;
  patch_version: string;
  channel: string;
  build_number: string;
}

export interface FullEstimate {
  string_count: number;
  estimate_usd: number;
}

export interface GlossaryEntry {
  id: string;
  lang: string;
  source_term: string;
  target_term: string;
  category: string;
  origin: string;
  locked: boolean;
  needs_retranslate: boolean;
  updated_at: string;
}

export type GlossaryPatch = Partial<
  Pick<GlossaryEntry, 'target_term' | 'category' | 'origin' | 'locked' | 'needs_retranslate'>
>;

export interface GlossaryHistoryEntry {
  id: number;
  glossary_id: string;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  at: string;
}

const num = (v: unknown): number => Number(v) || 0;

/** Admin data access of /admin/translations. Reads carry the app-wide read deadline; writes none. */
@Injectable({ providedIn: 'root' })
export class TranslationsService {
  private readonly sb = inject(SupabaseClientProvider);

  private async rows<T>(q: PromiseLike<{ data: unknown; error: unknown }>): Promise<T> {
    const { data, error } = await q;
    if (error) throw error;
    return data as T;
  }

  async getSettings(): Promise<TranslationSettings> {
    const r = await this.rows<Record<string, unknown>>(
      this.sb.client.from('translation_settings').select('enabled,upload_cap_usd,monthly_cap_usd').eq('id', 1).single(),
    );
    return { enabled: !!r['enabled'], upload_cap_usd: num(r['upload_cap_usd']), monthly_cap_usd: num(r['monthly_cap_usd']) };
  }

  async saveSettings(patch: Partial<TranslationSettings>): Promise<void> {
    await this.rows(this.sb.client.from('translation_settings').update({ ...patch, updated_at: new Date().toISOString() }).eq('id', 1));
  }

  async listLanguages(): Promise<TranslationLanguage[]> {
    return this.rows(this.sb.client.from('translation_languages').select('lang,cig_folder,approved').order('lang'));
  }

  async setApproved(lang: string, approved: boolean): Promise<void> {
    await this.rows(
      this.sb.client
        .from('translation_languages')
        .update({ approved, approved_at: approved ? new Date().toISOString() : null })
        .eq('lang', lang),
    );
  }

  async listJobs(): Promise<TranslationJob[]> {
    const data = await this.rows<Record<string, unknown>[]>(
      this.sb.client
        .from('translation_jobs')
        .select(
          'id,build_id,lang,mode,status,string_count,estimate_usd,spent_usd,stats,error,created_at,build:codex_builds!translation_jobs_build_id_fkey(patch_version,channel,build_number)',
        )
        .order('created_at', { ascending: false })
        .limit(100),
    );
    return (data ?? []).map((r) => ({
      ...(r as unknown as TranslationJob),
      estimate_usd: r['estimate_usd'] == null ? null : num(r['estimate_usd']),
      spent_usd: num(r['spent_usd']),
    }));
  }

  async currentBuilds(): Promise<CurrentBuild[]> {
    return this.rows(
      this.sb.client.from('codex_builds').select('id,patch_version,channel,build_number').eq('is_current', true),
    );
  }

  /** Spend of the current UTC month (sum of the ledger). */
  async monthSpend(now: Date = new Date()): Promise<number> {
    const rows = await this.rows<{ usd: number | string }[]>(
      this.sb.client.from('translation_ledger').select('usd').eq('month', monthStartUtc(now)),
    );
    return sumLedger(rows ?? []);
  }

  /** Orchestrator op; an `{error}` answer (also on non-2xx) is thrown as an Error carrying the code. */
  async orchestrator<T = Record<string, unknown>>(body: Record<string, unknown>): Promise<T> {
    const { data, error } = await this.sb.client.functions.invoke('translate-orchestrator', { body });
    let code: string | null = (data as { error?: string } | null)?.error ?? null;
    if (error && !code) {
      const ctx = (error as { context?: Response }).context;
      try {
        code = ((await ctx?.json()) as { error?: string } | undefined)?.error ?? null;
      } catch {
        code = null;
      }
      if (!code) throw error;
    }
    if (code) throw Object.assign(new Error(code), { code });
    return data as T;
  }

  approve(jobId: string) {
    return this.orchestrator({ op: 'approve', job_id: jobId });
  }

  cancel(jobId: string) {
    return this.orchestrator({ op: 'cancel', job_id: jobId });
  }

  async estimateFull(buildId: string, lang: string): Promise<FullEstimate> {
    const r = await this.orchestrator<{ estimate: { string_count: number; estimate_usd: number } }>({
      op: 'estimate',
      build_id: buildId,
      lang,
      mode: 'full',
    });
    return { string_count: num(r.estimate.string_count), estimate_usd: num(r.estimate.estimate_usd) };
  }

  startFull(buildId: string, lang: string) {
    return this.orchestrator({ op: 'start_full', build_id: buildId, lang });
  }

  // ── glossary ───────────────────────────────────────────────────────────────

  async listGlossary(f: GlossaryFilters): Promise<{ rows: GlossaryEntry[]; total: number }> {
    const q = buildGlossaryQuery(f);
    let b = this.sb.client
      .from('translation_glossary')
      .select('id,lang,source_term,target_term,category,origin,locked,needs_retranslate,updated_at', { count: 'exact' });
    if (q.or) b = b.or(q.or);
    for (const [col, val] of q.eq) b = b.eq(col, val);
    const { data, error, count } = await b.order('source_term').range(q.from, q.to);
    if (error) throw error;
    return { rows: (data ?? []) as GlossaryEntry[], total: count ?? data?.length ?? 0 };
  }

  async updateGlossary(id: string, patch: GlossaryPatch): Promise<void> {
    await this.rows(this.sb.client.from('translation_glossary').update({ ...patch, updated_at: new Date().toISOString() }).eq('id', id));
  }

  /** A target edit is an admin edit: origin flips to 'admin'. */
  saveTarget(id: string, target: string) {
    return this.updateGlossary(id, { target_term: target, origin: 'admin' });
  }

  async addGlossary(e: { lang: string; source_term: string; target_term: string; category: string }): Promise<void> {
    await this.rows(this.sb.client.from('translation_glossary').insert({ ...e, origin: 'admin' }));
  }

  async history(id: string): Promise<GlossaryHistoryEntry[]> {
    return this.rows(
      this.sb.client
        .from('translation_glossary_history')
        .select('id,glossary_id,before,after,at')
        .eq('glossary_id', id)
        .order('at', { ascending: false })
        .limit(20),
    );
  }

  /** Restore the `before` snapshot of a history row; the restore is itself a new history row. */
  async revert(entry: GlossaryHistoryEntry): Promise<void> {
    const patch = revertPatch(entry.before);
    if (!patch) return;
    await this.updateGlossary(entry.glossary_id, patch as GlossaryPatch);
  }
}
