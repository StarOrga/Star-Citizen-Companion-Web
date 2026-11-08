// Postgres adapter of the learning step (cards, learned glossary rows, style, codex names,
// learning spend). Separate from `_db.ts` so the job state machine's Db stays unchanged; wired
// as `deps.learn` (index.ts: `learn: makeLearnDb(admin)`). Without it the learning step is a no-op.
//
// Spend: job-less `translation_ledger` rows (job_id null) with `kind` + `lang`
// (migration 20261108180000). `monthCommitted` sums every row, so the monthly cap sees all kinds;
// the web-research cap sums kind='web' of the month.

import type { GlossaryRow } from './_prompt.ts';
import type { LearnedStyle } from './_style.ts';

// deno-lint-ignore no-explicit-any
type Client = any;

export interface LearnSettings {
  enabled: boolean;
  monthly_cap_usd: number;
  arbiter_model: string;
  web_research_cap_usd: number;
  revise_margin: number;
  revise_budget_pct: number;
  promote_min_evidence: number;
  promote_min_agreement: number;
}

export const LEARN_SETTING_DEFAULTS: LearnSettings = {
  enabled: false,
  monthly_cap_usd: 190,
  arbiter_model: 'claude-haiku-5-5',
  web_research_cap_usd: 5,
  revise_margin: 3,
  revise_budget_pct: 2,
  promote_min_evidence: 5,
  promote_min_agreement: 0.9,
};

export interface CardRow {
  id?: string;
  lang: string;
  kind: 'meta' | 'wording' | 'style';
  question: string;
  option_a: { text: string; source: string };
  option_b: { text: string; source: string };
  context: Record<string, unknown>;
  spread: number;
  reach: number;
  doubt: number;
  fresh: boolean;
  dedupe_key: string;
  impact: number;
  status?: 'open' | 'answered' | 'skipped';
  answer?: 'a' | 'b' | 'own' | null;
  own_text?: string | null;
  note?: string | null;
  save_as_rule?: boolean;
  answered_by?: string | null;
}

export interface LearnGlossaryRow extends GlossaryRow {
  evidence?: number;
}

export interface LearnDb {
  getLearnSettings(): Promise<LearnSettings>;
  /** The current LIVE codex build (is_current), else the newest current one; null when none. */
  currentBuildId(): Promise<string | null>;
  /** Manufacturer, ship and location names of a build (English). */
  codexNames(buildId: string): Promise<string[]>;
  getStyle(lang: string): Promise<LearnedStyle | null>;
  setStyle(lang: string, style: LearnedStyle): Promise<void>;
  listGlossary(lang: string): Promise<LearnGlossaryRow[]>;
  /** Insert only; a row that exists (lang, lower(source_term)) is left alone. */
  insertGlossary(lang: string, rows: LearnGlossaryRow[]): Promise<number>;
  updateGlossary(id: string, patch: Partial<Pick<LearnGlossaryRow, 'target_term' | 'origin' | 'evidence' | 'needs_retranslate' | 'category'>>): Promise<void>;
  /** Admin rule from a card: insert, or overwrite the existing row (admin wins), with needs_retranslate. */
  upsertAdminRule(lang: string, row: { source_term: string; target_term: string; category: string }, actor: string | null): Promise<void>;
  /** false when an unanswered card with the same dedupe_key exists (23505). */
  insertCard(card: CardRow): Promise<boolean>;
  listAnsweredUnapplied(lang: string, limit: number): Promise<CardRow[]>;
  listOpenCards(lang: string, kinds: CardRow['kind'][], limit: number): Promise<CardRow[]>;
  updateCardContext(id: string, context: Record<string, unknown>): Promise<void>;
  /** Books learning spend as a job-less ledger row (see header). */
  addLearnLedger(month: string, usd: number, kind: string, lang: string): Promise<void>;
  /** Ledger sum of one kind in a month (web-research cap). */
  monthKindSpent(month: string, kind: string): Promise<number>;
  /** Ledger sum of the month (all spend, the monthly cap's basis). */
  monthSpent(month: string): Promise<number>;
  listApprovedLangs(): Promise<string[]>;
}

function fail(e: { message?: string } | null): never {
  throw new Error(e?.message ?? 'db error');
}

export function makeLearnDb(sb: Client, now: () => Date = () => new Date()): LearnDb {
  return {
    async getLearnSettings() {
      const { data, error } = await sb.from('translation_settings').select('*').eq('id', 1).maybeSingle();
      if (error) fail(error);
      const s = (data ?? {}) as Partial<LearnSettings>;
      const d = LEARN_SETTING_DEFAULTS;
      return {
        enabled: s.enabled === true,
        monthly_cap_usd: Number(s.monthly_cap_usd ?? d.monthly_cap_usd),
        arbiter_model: s.arbiter_model || d.arbiter_model,
        web_research_cap_usd: Number(s.web_research_cap_usd ?? d.web_research_cap_usd),
        revise_margin: Number(s.revise_margin ?? d.revise_margin),
        revise_budget_pct: Number(s.revise_budget_pct ?? d.revise_budget_pct),
        promote_min_evidence: Number(s.promote_min_evidence ?? d.promote_min_evidence),
        promote_min_agreement: Number(s.promote_min_agreement ?? d.promote_min_agreement),
      };
    },
    async currentBuildId() {
      const { data, error } = await sb.from('codex_builds').select('id,channel,created_at').eq('is_current', true)
        .order('created_at', { ascending: false }).limit(10);
      if (error) fail(error);
      const rows = (data ?? []) as { id: string; channel: string }[];
      return (rows.find((r) => r.channel === 'LIVE') ?? rows[0])?.id ?? null;
    },
    async codexNames(buildId) {
      const out = new Set<string>();
      for (const [table, col] of [['codex_manufacturers', 'name_localized'], ['codex_ships', 'name_localized'], ['codex_locations', 'name']]) {
        const { data, error } = await sb.from(table).select(col).eq('build_id', buildId).limit(10000);
        if (error) continue; // a missing table degrades to fewer names
        for (const r of (data ?? []) as Record<string, string | null>[]) {
          const n = (r[col] ?? '').trim();
          if (n) out.add(n);
        }
      }
      return [...out];
    },
    async getStyle(lang) {
      const { data, error } = await sb.from('translation_languages').select('style').eq('lang', lang).maybeSingle();
      if (error) fail(error);
      const s = (data as { style?: LearnedStyle } | null)?.style;
      return s && typeof s === 'object' && (s as LearnedStyle).v === 1 ? s : null;
    },
    async setStyle(lang, style) {
      const { error } = await sb.from('translation_languages').update({ style }).eq('lang', lang);
      if (error) fail(error);
    },
    async listGlossary(lang) {
      const { data, error } = await sb.from('translation_glossary').select('*').eq('lang', lang).limit(20000);
      if (error) fail(error);
      return (data ?? []) as LearnGlossaryRow[];
    },
    async insertGlossary(lang, rows) {
      let n = 0;
      for (const r of rows) {
        const { error } = await sb.from('translation_glossary').insert({
          lang, source_term: r.source_term, target_term: r.target_term, category: r.category, origin: r.origin,
          evidence: r.evidence ?? 0,
        });
        if (error && error.code !== '23505') fail(error);
        if (!error) n++;
      }
      return n;
    },
    async updateGlossary(id, patch) {
      const { error } = await sb.from('translation_glossary').update({ ...patch, updated_at: now().toISOString() }).eq('id', id)
        .eq('locked', false).neq('origin', 'admin');
      if (error) fail(error);
    },
    async upsertAdminRule(lang, row, actor) {
      const { data, error } = await sb.from('translation_glossary').select('id').eq('lang', lang).ilike('source_term', row.source_term.replace(/[%_\\]/g, '\\$&')).maybeSingle();
      if (error) fail(error);
      const patch = { target_term: row.target_term, category: row.category, origin: 'admin', needs_retranslate: true, updated_by: actor, updated_at: now().toISOString() };
      const res = data
        ? await sb.from('translation_glossary').update(patch).eq('id', (data as { id: string }).id)
        : await sb.from('translation_glossary').insert({ lang, source_term: row.source_term, ...patch });
      if (res.error) fail(res.error);
    },
    async insertCard(card) {
      const { error } = await sb.from('translation_cards').insert({
        lang: card.lang, kind: card.kind, question: card.question, option_a: card.option_a, option_b: card.option_b,
        context: card.context, spread: card.spread, reach: card.reach, doubt: card.doubt, fresh: card.fresh,
        dedupe_key: card.dedupe_key, impact: card.impact,
      });
      if (error && error.code === '23505') return false;
      if (error) fail(error);
      return true;
    },
    async listAnsweredUnapplied(lang, limit) {
      const { data, error } = await sb.from('translation_cards').select('*').eq('lang', lang).eq('status', 'answered')
        .is('context->>applied_at', null).order('answered_at').limit(limit);
      if (error) fail(error);
      return (data ?? []) as CardRow[];
    },
    async listOpenCards(lang, kinds, limit) {
      const { data, error } = await sb.from('translation_cards').select('*').eq('lang', lang).eq('status', 'open').in('kind', kinds)
        .order('spread', { ascending: false }).order('reach', { ascending: false }).order('kind_rank')
        .order('doubt', { ascending: false }).limit(limit);
      if (error) fail(error);
      return (data ?? []) as CardRow[];
    },
    async updateCardContext(id, context) {
      const { error } = await sb.from('translation_cards').update({ context }).eq('id', id);
      if (error) fail(error);
    },
    async addLearnLedger(month, usd, kind, lang) {
      if (!(usd > 0)) return;
      const { error } = await sb.from('translation_ledger').insert({ job_id: null, month, usd, kind, lang });
      if (error) fail(error);
    },
    async monthKindSpent(month, kind) {
      const { data, error } = await sb.from('translation_ledger').select('usd').eq('month', month).eq('kind', kind);
      if (error) fail(error);
      return ((data ?? []) as { usd: number }[]).reduce((a, r) => a + Number(r.usd), 0);
    },
    async monthSpent(month) {
      const { data, error } = await sb.from('translation_ledger').select('usd').eq('month', month);
      if (error) fail(error);
      return ((data ?? []) as { usd: number }[]).reduce((a, r) => a + Number(r.usd), 0);
    },
    async listApprovedLangs() {
      const { data, error } = await sb.from('translation_languages').select('lang').eq('approved', true);
      if (error) fail(error);
      return ((data ?? []) as { lang: string }[]).map((r) => r.lang);
    },
  };
}
