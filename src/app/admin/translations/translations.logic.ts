/** Pure helpers of the /admin/translations page (no Angular, no I/O). */

export type JobStatus =
  | 'estimating' | 'awaiting_approval' | 'queued' | 'submitted' | 'validating'
  | 'post_editing' | 'publishing' | 'published' | 'failed' | 'cancelled' | 'skipped';

export const TERMINAL_STATUSES: readonly JobStatus[] = ['published', 'failed', 'cancelled', 'skipped'];

/** Approve is only valid while the job waits for it (orchestrator: not_awaiting_approval). */
export function canApprove(status: string): boolean {
  return status === 'awaiting_approval';
}

/** Cancel is valid for every job that is not finished (orchestrator: not_cancellable). */
export function canCancel(status: string): boolean {
  return !(TERMINAL_STATUSES as readonly string[]).includes(status);
}

/** First day of the UTC month of `d`, as the ledger stores it (`YYYY-MM-01`). */
export function monthStartUtc(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-01`;
}

/** Sum of ledger rows (numeric columns may arrive as strings), rounded to micro-dollars. */
export function sumLedger(rows: readonly { usd: number | string | null }[]): number {
  const total = rows.reduce((s, r) => s + (Number(r.usd) || 0), 0);
  return Math.round(total * 1e6) / 1e6;
}

/** Share of the monthly cap that is spent, clamped to 0..100 (0 when there is no cap). */
export function spendPercent(spent: number, cap: number): number {
  if (!(cap > 0)) return 0;
  return Math.max(0, Math.min(100, Math.round((spent / cap) * 100)));
}

/** Mean judge score of a job's stats, or null when the judge did not run. */
export function judgeScore(stats: unknown): number | null {
  const j = (stats as { judge?: { mean?: unknown } | null } | null)?.judge;
  return typeof j?.mean === 'number' ? j.mean : null;
}

const KNOWN_JOB_ERRORS = new Set([
  'translate.base_build_missing', 'translate.conflict', 'translate.english_missing',
  'translate.job_not_found', 'translate.lang_unknown', 'translate.no_api_key',
  'translate.no_base_build', 'translate.not_awaiting_approval', 'translate.not_cancellable',
  'translate.plan_missing', 'translate.results_missing', 'translate.r2_not_configured',
  'translate.internal',
]);

/** i18n key for a job's / orchestrator's error code; unknown codes get a generic sentence, never raw text. */
export function jobErrorKey(code: string | null | undefined): string | null {
  if (!code) return null;
  return KNOWN_JOB_ERRORS.has(code)
    ? `admin.translations.jobErrors.${code.replace(/^translate\./, '')}`
    : 'admin.translations.jobErrors.unknown';
}

export type GlossaryOrigin = 'cig' | 'ai' | 'admin';
export type GlossaryCategory = 'term' | 'label' | 'unit' | 'dnt';
export const GLOSSARY_ORIGINS: readonly GlossaryOrigin[] = ['cig', 'ai', 'admin'];
export const GLOSSARY_CATEGORIES: readonly GlossaryCategory[] = ['term', 'label', 'unit', 'dnt'];

export interface GlossaryFilters {
  search: string;
  lang: string | null;
  origin: GlossaryOrigin | null;
  category: GlossaryCategory | null;
  page: number;
}

export const GLOSSARY_PAGE_SIZE = 50;

/**
 * PostgREST `or=` expression matching the term in source or target. Characters
 * that carry meaning in a filter value are dropped so a search can never break
 * out of the expression.
 */
export function glossarySearchFilter(search: string): string | null {
  const q = search.replace(/[,()*%"\\]/g, ' ').replace(/\s+/g, ' ').trim();
  if (!q) return null;
  return `source_term.ilike.%${q}%,target_term.ilike.%${q}%`;
}

export interface GlossaryQuery {
  or: string | null;
  eq: [string, string][];
  from: number;
  to: number;
}

export function buildGlossaryQuery(f: GlossaryFilters): GlossaryQuery {
  const eq: [string, string][] = [];
  if (f.lang) eq.push(['lang', f.lang]);
  if (f.origin) eq.push(['origin', f.origin]);
  if (f.category) eq.push(['category', f.category]);
  const page = Math.max(0, f.page);
  return {
    or: glossarySearchFilter(f.search),
    eq,
    from: page * GLOSSARY_PAGE_SIZE,
    to: page * GLOSSARY_PAGE_SIZE + GLOSSARY_PAGE_SIZE - 1,
  };
}

/** Fields a history "Rückgängig" writes back from the `before` snapshot. */
export function revertPatch(before: Record<string, unknown> | null): Record<string, unknown> | null {
  if (!before) return null;
  const patch: Record<string, unknown> = {};
  for (const k of ['target_term', 'category', 'origin', 'locked', 'needs_retranslate']) {
    if (k in before) patch[k] = before[k];
  }
  return Object.keys(patch).length ? patch : null;
}
