// Postgres adapter for the state machine (tables: docs/translation/ARCHITECTURE.md § Data).
// Runs with the service-role client; RLS is bypassed, auth happens in index.ts.

import type { Db, Job, JobPatch, Settings } from './_machine.ts';
import type { GlossaryRow } from './_prompt.ts';

// deno-lint-ignore no-explicit-any
type Client = any;

const OPEN = ['estimating', 'queued', 'submitted', 'validating', 'post_editing', 'publishing'];

function fail(e: { message?: string } | null): never {
  throw new Error(e?.message ?? 'db error');
}

export function makeDb(sb: Client, now: () => Date): Db {
  const cols = '*';
  return {
    async listOpenJobs() {
      const { data, error } = await sb.from('translation_jobs').select(cols).in('status', OPEN).order('created_at');
      if (error) fail(error);
      return (data ?? []) as Job[];
    },
    async getJob(id) {
      const { data, error } = await sb.from('translation_jobs').select(cols).eq('id', id).maybeSingle();
      if (error) fail(error);
      return (data as Job | null) ?? null;
    },
    async cas(job: Job, patch: JobPatch) {
      const { data, error } = await sb.from('translation_jobs')
        .update({ ...patch, updated_at: now().toISOString() })
        .eq('id', job.id).eq('status', job.status).eq('updated_at', job.updated_at)
        .select(cols).maybeSingle();
      if (error) fail(error);
      return (data as Job | null) ?? null;
    },
    async insertJob(j) {
      const { data, error } = await sb.from('translation_jobs')
        .insert({ ...j, status: 'estimating', stats: j.stats ?? {} }).select(cols).single();
      if (error) fail(error);
      return data as Job;
    },
    async getSettings() {
      const { data, error } = await sb.from('translation_settings').select('*').eq('id', 1).maybeSingle();
      if (error) fail(error);
      const s = (data ?? {}) as Partial<Settings>;
      return {
        enabled: s.enabled === true,
        upload_cap_usd: Number(s.upload_cap_usd ?? 20),
        monthly_cap_usd: Number(s.monthly_cap_usd ?? 190),
        lore_model: s.lore_model ?? null,
        rest_model: s.rest_model ?? null,
      };
    },
    async getLanguage(lang) {
      const { data, error } = await sb.from('translation_languages').select('lang,cig_folder,approved').eq('lang', lang).maybeSingle();
      if (error) fail(error);
      return data ?? null;
    },
    async listGlossary(lang) {
      const { data, error } = await sb.from('translation_glossary').select('*').eq('lang', lang).limit(20000);
      if (error) fail(error);
      return (data ?? []) as GlossaryRow[];
    },
    async insertGlossary(lang, rows) {
      for (let i = 0; i < rows.length; i += 500) {
        const part = rows.slice(i, i + 500).map((r) => ({
          lang, source_term: r.source_term, target_term: r.target_term, category: r.category, origin: r.origin,
        }));
        const { error } = await sb.from('translation_glossary').insert(part);
        // 23505: a concurrent job inserted the same term first — never overwrite.
        if (error && error.code !== '23505') fail(error);
      }
    },
    async resetRetranslate(ids) {
      if (!ids.length) return;
      const { error } = await sb.from('translation_glossary').update({ needs_retranslate: false }).in('id', ids);
      if (error) fail(error);
    },
    async buildEstimateSum(buildId, excludeJobId) {
      const { data, error } = await sb.from('translation_jobs').select('estimate_usd')
        .eq('build_id', buildId).neq('id', excludeJobId).not('status', 'in', '(failed,cancelled,skipped)');
      if (error) fail(error);
      return ((data ?? []) as { estimate_usd: number | null }[]).reduce((a, r) => a + Number(r.estimate_usd ?? 0), 0);
    },
    async monthCommitted(month, excludeJobId) {
      const led = await sb.from('translation_ledger').select('usd').eq('month', month);
      if (led.error) fail(led.error);
      const fly = await sb.from('translation_jobs').select('estimate_usd,spent_usd')
        .in('status', ['queued', 'submitted', 'validating', 'post_editing']).neq('id', excludeJobId);
      if (fly.error) fail(fly.error);
      const spent = ((led.data ?? []) as { usd: number }[]).reduce((a, r) => a + Number(r.usd), 0);
      const reserved = ((fly.data ?? []) as { estimate_usd: number | null; spent_usd: number | null }[])
        .reduce((a, r) => a + Math.max(0, Number(r.estimate_usd ?? 0) - Number(r.spent_usd ?? 0)), 0);
      return spent + reserved;
    },
    async addLedger(jobId, month, usd) {
      const { error } = await sb.from('translation_ledger').insert({ job_id: jobId, month, usd });
      if (error) fail(error);
    },
    async hasNewerPublished(job) {
      const mine = await sb.from('codex_builds').select('created_at').eq('id', job.build_id).maybeSingle();
      if (mine.error) fail(mine.error);
      if (!mine.data) return false;
      const pub = await sb.from('translation_jobs').select('build_id').eq('lang', job.lang).eq('status', 'published').neq('id', job.id);
      if (pub.error) fail(pub.error);
      const ids = [...new Set(((pub.data ?? []) as { build_id: string }[]).map((r) => r.build_id))];
      if (!ids.length) return false;
      const newer = await sb.from('codex_builds').select('id', { count: 'exact', head: true }).in('id', ids).gt('created_at', mine.data.created_at);
      if (newer.error) fail(newer.error);
      return (newer.count ?? 0) > 0;
    },
  };
}
