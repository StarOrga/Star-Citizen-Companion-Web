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

export type CardKind = 'meta' | 'wording' | 'style';
export type CardAnswer = 'a' | 'b' | 'own';
export interface CardOption {
  text: string;
  source: string;
}

export interface TranslationCard {
  id: string;
  lang: string;
  kind: CardKind;
  question: string;
  option_a: CardOption;
  option_b: CardOption;
  context: Record<string, unknown> | null;
  spread: number;
  reach: number;
  doubt: number;
  fresh: boolean;
  status: 'open' | 'answered' | 'skipped';
  answer: CardAnswer | null;
  impact: number | null;
  points: number | null;
}

export interface CardStats {
  open_count: number;
  answered_today: number;
  streak_days: number;
}

export interface LeaderboardRow {
  answered_by: string;
  points: number;
  answers: number;
  streak_days: number;
}

export interface CardAnswerInput {
  answer: CardAnswer;
  own_text?: string | null;
  note?: string | null;
  save_as_rule?: boolean;
}

export interface TranslationSource {
  id: string;
  lang: string;
  name: string;
  license: string | null;
  license_kind: 'permissive' | 'nc_sa' | 'none';
  status: 'licensed' | 'awaiting_permission' | 'permitted' | 'refused';
  enabled: boolean;
  game_folder: string | null;
  last_synced_at: string | null;
  coverage: Record<string, unknown> | null;
}

export interface ImportSeedResult {
  source_id: string;
  lang: string;
  imported: number;
  skipped_cig: number;
  skipped_same: number;
  rejected_qa: number;
  conflicts: number;
  coverage: unknown;
}

export interface SyncSourcesResult {
  checked: number;
  changed: number;
  errors: number;
}

export interface OutreachDraft {
  id: string;
  source_id: string;
  kind: 'notify' | 'permission';
  message_lang: string;
  subject: string;
  body: string;
  status: 'draft' | 'approved' | 'sent' | 'answered';
  approved_at: string | null;
  sent_at: string | null;
  answer: string | null;
  answer_at: string | null;
  decision: 'granted' | 'refused' | null;
  created_at: string;
}

export interface OverrideAlert {
  id: string;
  lang: string;
  key: string;
  en_old: string | null;
  en_new: string | null;
  cig_old: string | null;
  cig_new: string | null;
  admin_text: string;
  status: 'open' | 'kept' | 'adopted' | 'edited';
  created_at: string;
}

export interface AdminPerson {
  id: string;
  name: string;
  isProtected: boolean;
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

  // ── community seed: cards, sources, outreach, alerts ───────────────────────

  /** Contract queue order; `status` ascending puts 'open' before 'skipped'. */
  async cardQueue(lang: string | null, limit = 50): Promise<TranslationCard[]> {
    let b = this.sb.client
      .from('translation_cards')
      .select('id,lang,kind,question,option_a,option_b,context,spread,reach,doubt,fresh,status,answer,impact,points')
      .in('status', ['open', 'skipped']);
    if (lang) b = b.eq('lang', lang);
    const data = await this.rows<TranslationCard[]>(
      b
        .order('status', { ascending: true })
        .order('spread', { ascending: false })
        .order('reach', { ascending: false })
        .order('kind_rank', { ascending: true })
        .order('doubt', { ascending: false })
        .order('fresh', { ascending: false })
        .limit(limit),
    );
    return data ?? [];
  }

  answerCard(id: string, a: CardAnswerInput): Promise<TranslationCard> {
    return this.rows(
      this.sb.client
        .rpc('answer_translation_card', {
          p_card_id: id,
          p_answer: a.answer,
          p_own_text: a.answer === 'own' ? (a.own_text ?? '').trim() : null,
          p_note: a.note?.trim() ? a.note.trim() : null,
          p_save_as_rule: !!a.save_as_rule,
        })
        .single(),
    );
  }

  skipCard(id: string): Promise<TranslationCard> {
    return this.rows(this.sb.client.rpc('skip_translation_card', { p_card_id: id }).single());
  }

  async cardStats(lang: string | null): Promise<CardStats> {
    const d = await this.rows<unknown>(this.sb.client.rpc('translation_card_stats', { p_lang: lang }));
    const r = (Array.isArray(d) ? d[0] : d) as Record<string, unknown> | null;
    return { open_count: num(r?.['open_count']), answered_today: num(r?.['answered_today']), streak_days: num(r?.['streak_days']) };
  }

  async leaderboard(): Promise<LeaderboardRow[]> {
    const d = await this.rows<Record<string, unknown>[]>(this.sb.client.rpc('translation_card_leaderboard'));
    return (d ?? []).map((r) => ({
      answered_by: String(r['answered_by']),
      points: num(r['points']),
      answers: num(r['answers']),
      streak_days: num(r['streak_days']),
    }));
  }

  /** Admin accounts by id (display name + protected flag): names for the leaderboard, protected status for approvals. */
  async people(): Promise<Map<string, AdminPerson>> {
    const d = await this.rows<
      { id: string; display_name: string | null; username: string | null; email: string; protected: boolean | null }[]
    >(this.sb.client.rpc('list_users_for_admin'));
    return new Map(
      (d ?? []).map((u) => [u.id, { id: u.id, name: u.display_name || u.username || u.email, isProtected: u.protected === true }]),
    );
  }

  listSources(): Promise<TranslationSource[]> {
    return this.rows(
      this.sb.client
        .from('translation_sources')
        .select('id,lang,name,license,license_kind,status,enabled,game_folder,last_synced_at,coverage')
        .order('lang'),
    );
  }

  importSeed(sourceId: string) {
    return this.orchestrator<ImportSeedResult>({ op: 'import_seed', source_id: sourceId });
  }

  syncSources() {
    return this.orchestrator<SyncSourcesResult>({ op: 'sync_sources' });
  }

  draftOutreach(sourceId: string) {
    return this.orchestrator<Record<string, unknown>>({ op: 'draft_outreach', source_id: sourceId });
  }

  learn(lang: string) {
    return this.orchestrator<Record<string, unknown>>({ op: 'learn', lang });
  }

  listOutreach(): Promise<OutreachDraft[]> {
    return this.rows(
      this.sb.client
        .from('translation_outreach')
        .select('id,source_id,kind,message_lang,subject,body,status,approved_at,sent_at,answer,answer_at,decision,created_at')
        .order('source_id')
        .order('created_at', { ascending: false }),
    );
  }

  async saveOutreachDraft(id: string, p: { subject: string; body: string; message_lang: string }): Promise<void> {
    await this.rows(this.sb.client.from('translation_outreach').update(p).eq('id', id));
  }

  approveOutreach(id: string): Promise<OutreachDraft> {
    return this.rows(this.sb.client.rpc('approve_translation_outreach', { p_id: id }).single());
  }

  markOutreachSent(id: string): Promise<OutreachDraft> {
    return this.rows(this.sb.client.rpc('mark_translation_outreach_sent', { p_id: id }).single());
  }

  recordOutreachAnswer(id: string, answer: string, decision: 'granted' | 'refused'): Promise<OutreachDraft> {
    return this.rows(
      this.sb.client.rpc('record_translation_outreach_answer', { p_id: id, p_answer: answer, p_decision: decision }).single(),
    );
  }

  listAlerts(): Promise<OverrideAlert[]> {
    return this.rows(
      this.sb.client
        .from('translation_override_alerts')
        .select('id,lang,key,en_old,en_new,cig_old,cig_new,admin_text,status,created_at')
        .eq('status', 'open')
        .order('created_at', { ascending: false }),
    );
  }

  resolveAlert(id: string, resolution: 'kept' | 'adopted' | 'edited', editedText?: string): Promise<OverrideAlert> {
    return this.rows(
      this.sb.client
        .rpc('resolve_override_alert', {
          p_alert_id: id,
          p_resolution: resolution,
          p_edited_text: resolution === 'edited' ? (editedText ?? '').trim() : null,
        })
        .single(),
    );
  }
}
