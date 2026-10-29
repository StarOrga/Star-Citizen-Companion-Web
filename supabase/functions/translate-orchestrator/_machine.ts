// The job state machine. Pure of Deno/network: everything external comes in through Deps
// (Postgres rows, R2, the Anthropic batch API), so the transitions are unit-tested with fakes.
//
// estimating -> queued | awaiting_approval | publishing | skipped
// queued -> submitted -> validating -> (post_editing) -> publishing -> published
// any open state -> failed | cancelled
//
// Every transition is a compare-and-set on (id, status, updated_at); a second tick racing the
// first loses the CAS and does nothing. Work in progress lives in R2 (`translation-work/<job>/`)
// and in `stats.phase`, so a crash at any point resumes where it stopped.

import { buildChunks, toChunkItem } from './_chunk.ts';
import type { Chunk, ChunkItem } from './_chunk.ts';
import { estimateJob, estimateTokens, usageCostUsd } from './_cost.ts';
import type { Estimate, Usage } from './_cost.ts';
import { diffStrings } from './_diff.ts';
import type { DiffCounts, TmEntry } from './_diff.ts';
import { deriveAiTerms, deriveCigLabels, mergeGlossary, newRows } from './_glossary.ts';
import { loadTm, makeOverlay, overlayKey, readLocaleTable, saveTm, workKey } from './_io.ts';
import type { Store } from './_io.ts';
import { mask, unmask } from './_mask.ts';
import {
  buildFewShotIndex,
  buildSystem,
  judgeParams,
  pickSimilar,
  postEditMessage,
  requestParams,
  userMessage,
} from './_prompt.ts';
import type { BatchParams, CigPair, GlossaryRow } from './_prompt.ts';
import { qaCheck } from './_qa.ts';
import { isCigValid } from './_diff.ts';

export class TranslateError extends Error {
  key: string;
  constructor(key: string) {
    super(key);
    this.key = key;
  }
}

export type Status =
  | 'estimating' | 'awaiting_approval' | 'queued' | 'submitted' | 'validating' | 'post_editing'
  | 'publishing' | 'published' | 'failed' | 'cancelled' | 'skipped';

export const OPEN_STATUSES: Status[] = ['estimating', 'queued', 'submitted', 'validating', 'post_editing', 'publishing'];

export interface BatchRef {
  id: string;
  kind: 'main' | 'judge' | 'postedit';
}

export interface Stats {
  phase?: string;
  hold?: string;
  attempts?: number;
  counts?: DiffCounts;
  estimate?: Estimate;
  qa?: { ok: number; failed: number; reasons: Record<string, number>; dropped?: number };
  judge?: { n: number; mean: number } | null;
  ledgered?: string[];
  [k: string]: unknown;
}

export interface Job {
  id: string;
  build_id: string;
  lang: string;
  mode: 'delta' | 'full';
  base_build_id: string | null;
  status: Status;
  string_count: number | null;
  estimate_usd: number | null;
  spent_usd: number;
  batch_ids: BatchRef[];
  stats: Stats | null;
  error: string | null;
  created_at: string;
  updated_at: string;
  approved_by: string | null;
}

export type JobPatch = Partial<Pick<Job, 'status' | 'string_count' | 'estimate_usd' | 'spent_usd' | 'batch_ids' | 'stats' | 'error' | 'approved_by'>>;

export interface Settings {
  enabled: boolean;
  upload_cap_usd: number;
  monthly_cap_usd: number;
  lore_model: string | null;
  rest_model: string | null;
}

export interface Db {
  listOpenJobs(): Promise<Job[]>;
  getJob(id: string): Promise<Job | null>;
  /** Compare-and-set on id + status + updated_at; stamps updated_at; null when someone else won. */
  cas(job: Job, patch: JobPatch): Promise<Job | null>;
  insertJob(j: { build_id: string; lang: string; mode: 'delta' | 'full'; base_build_id: string | null; stats?: Stats }): Promise<Job>;
  getSettings(): Promise<Settings>;
  getLanguage(lang: string): Promise<{ lang: string; cig_folder: string | null; approved: boolean } | null>;
  listGlossary(lang: string): Promise<GlossaryRow[]>;
  insertGlossary(lang: string, rows: GlossaryRow[]): Promise<void>;
  resetRetranslate(ids: string[]): Promise<void>;
  /** Sum of estimate_usd of the other jobs of this build that are not failed/cancelled/skipped. */
  buildEstimateSum(buildId: string, excludeJobId: string): Promise<number>;
  /** Ledger sum of the month plus the unspent part of in-flight jobs (excluding `excludeJobId`). */
  monthCommitted(month: string, excludeJobId: string): Promise<number>;
  addLedger(jobId: string, month: string, usd: number): Promise<void>;
  hasNewerPublished(job: Job): Promise<boolean>;
}

export interface BatchResult {
  custom_id: string;
  type: 'succeeded' | 'errored' | 'canceled' | 'expired';
  text?: string;
  stop_reason?: string | null;
  usage?: Usage;
  model?: string;
}

export interface Llm {
  createBatch(requests: { custom_id: string; params: BatchParams }[]): Promise<{ id: string }>;
  isEnded(id: string): Promise<boolean>;
  results(id: string): AsyncIterable<BatchResult>;
  cancel(id: string): Promise<void>;
}

export interface Deps {
  db: Db;
  store: Store;
  /** null = secret TRANSLATE_ANTHROPIC_API_KEY absent. */
  llm: Llm | null;
  now(): Date;
  log(msg: string, data?: Record<string, unknown>): void;
}

export const BATCH_MAX_REQUESTS = 400;
export const STALE_SUBMIT_MS = 15 * 60_000;
export const JUDGE_MODEL = 'claude-opus-5-5';
export const JUDGE_THRESHOLD = 6;
export const MAX_ATTEMPTS = 5;
const JUDGE_CAP = 150;

// ── plan ─────────────────────────────────────────────────────────────────────

export interface Plan {
  v: 1;
  build_id: string;
  lang: string;
  mode: 'delta' | 'full';
  system: string;
  chunks: Chunk[];
  fewShot: Record<string, CigPair[]>;
  keysByHash: Record<string, string[]>;
  reused: Record<string, { h: string; t: string }>;
  forceIds: string[];
  counts: DiffCounts;
  newGlossary: GlossaryRow[];
}

export interface PlanResult {
  plan: Plan;
  estimate: Estimate;
  stringCount: number;
}

export async function computePlan(
  deps: Deps,
  job: Pick<Job, 'build_id' | 'lang' | 'mode' | 'base_build_id'>,
  settings: Settings,
): Promise<PlanResult> {
  const { db, store } = deps;
  const language = await db.getLanguage(job.lang);
  if (!language) throw new TranslateError('translate.lang_unknown');
  const en = await readLocaleTable(store, job.build_id, 'en');
  if (!Object.keys(en).length) throw new TranslateError('translate.english_missing');

  let baseEn: Record<string, string> | null = null;
  if (job.mode === 'delta') {
    if (!job.base_build_id) throw new TranslateError('translate.no_base_build');
    baseEn = await readLocaleTable(store, job.base_build_id, 'en');
    if (!Object.keys(baseEn).length) throw new TranslateError('translate.base_build_missing');
  }
  const cig = await readLocaleTable(store, job.build_id, language.cig_folder || job.lang);
  const tm = await loadTm(store, job.lang);
  const dbGlossary = await db.listGlossary(job.lang);
  const forced = dbGlossary.filter((g) => g.needs_retranslate);
  const diff = await diffStrings({
    en, cig, tm, mode: job.mode, baseEn, forceTerms: forced.map((g) => g.source_term),
  });

  const derived = deriveCigLabels(en, cig);
  const glossary = mergeGlossary(dbGlossary, derived);
  const system = buildSystem(job.lang, glossary);

  const keysByHash: Record<string, string[]> = {};
  const items: ChunkItem[] = diff.todo.map((u) => {
    keysByHash[u.h] = u.keys;
    return toChunkItem(u);
  });
  const chunks = buildChunks(items, (it) => keysByHash[it.h], {
    lang: job.lang,
    loreModel: settings.lore_model || undefined,
    restModel: settings.rest_model || undefined,
  });

  const pairs: CigPair[] = [];
  for (const k of Object.keys(cig)) if (isCigValid(en[k] ?? '', cig[k]) && en[k]) pairs.push({ key: k, en: en[k], t: cig[k] });
  const index = buildFewShotIndex(pairs);
  const fewShot: Record<string, CigPair[]> = {};
  for (const c of chunks) fewShot[c.id] = pickSimilar(index, c.items, 8);

  const estimate = estimateJob(
    job.lang,
    chunks.map((c) => ({ model: c.model, inputChars: c.inputChars, enChars: c.enChars, strings: c.items.length })),
    estimateTokens(system.length),
  );
  // The few-shot pairs ride in the (uncached) user message.
  estimate.usd += (chunks.reduce((a, c) => a + (fewShot[c.id]?.length ?? 0), 0) * 60 * 0.9 * 3) / 1e6;

  const plan: Plan = {
    v: 1, build_id: job.build_id, lang: job.lang, mode: job.mode, system, chunks, fewShot, keysByHash,
    reused: diff.reused, forceIds: forced.map((g) => g.id!).filter(Boolean), counts: diff.counts,
    newGlossary: newRows(dbGlossary, derived),
  };
  return { plan, estimate, stringCount: diff.todo.reduce((a, u) => a + u.keys.length, 0) };
}

/** Dry run for the admin `estimate` op: no writes. */
export async function dryRun(deps: Deps, build_id: string, lang: string, mode: 'delta' | 'full', base_build_id: string | null) {
  const settings = await deps.db.getSettings();
  const { plan, estimate, stringCount } = await computePlan(deps, { build_id, lang, mode, base_build_id }, settings);
  return {
    mode, string_count: stringCount, unique_texts: Object.keys(plan.keysByHash).length, requests: plan.chunks.length,
    counts: plan.counts, estimate_usd: round4(estimate.usd), by_model: estimate.byModel,
    needs_approval: mode === 'full' || estimate.usd > settings.upload_cap_usd,
  };
}

// ── helpers ──────────────────────────────────────────────────────────────────

const round4 = (n: number) => Math.round(n * 1e6) / 1e6; // micro-dollars; the name is historical
export const monthOf = (d: Date) => `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-01`;

interface Res {
  /** Restored text. */
  t: string;
  /** Raw masked model output. */
  raw: string;
  ok: boolean;
  reasons: string[];
  m: string;
}
type ResMap = Record<string, Res>;

function addStats(job: Job, patch: Partial<Stats>): Stats {
  return { ...(job.stats ?? {}), ...patch };
}

async function must(job: Job | null): Promise<Job> {
  if (!job) throw new LostRace();
  return job;
}
class LostRace extends Error {}

async function ledger(deps: Deps, job: Job, kind: string, usd: number): Promise<Job> {
  const done = job.stats?.ledgered ?? [];
  if (done.includes(kind) || usd <= 0) return job;
  await deps.db.addLedger(job.id, monthOf(deps.now()), round4(usd));
  return job;
}

async function readPlan(deps: Deps, job: Job): Promise<Plan> {
  const p = await deps.store.getJson(workKey(job.id, 'plan')) as Plan | null;
  if (!p) throw new TranslateError('translate.plan_missing');
  return p;
}

function requireLlm(deps: Deps): Llm {
  if (!deps.llm) throw new TranslateError('translate.no_api_key');
  return deps.llm;
}

/** Creates the batches that do not exist yet (resumable: refs are saved after each one). */
async function submitGroups(
  deps: Deps, job: Job, kind: BatchRef['kind'], reqs: { custom_id: string; params: BatchParams }[],
): Promise<Job> {
  const llm = requireLlm(deps);
  const groups: typeof reqs[] = [];
  for (let i = 0; i < reqs.length; i += BATCH_MAX_REQUESTS) groups.push(reqs.slice(i, i + BATCH_MAX_REQUESTS));
  let cur = job;
  const have = cur.batch_ids.filter((b) => b.kind === kind).length;
  for (let g = have; g < groups.length; g++) {
    const { id } = await llm.createBatch(groups[g]);
    cur = await must(await deps.db.cas(cur, { batch_ids: [...cur.batch_ids, { id, kind }] }));
  }
  return await must(await deps.db.cas(cur, { stats: addStats(cur, { phase: 'running' }) }));
}

async function allEnded(deps: Deps, job: Job, kind: BatchRef['kind']): Promise<boolean> {
  const llm = requireLlm(deps);
  for (const b of job.batch_ids.filter((x) => x.kind === kind)) if (!(await llm.isEnded(b.id))) return false;
  return true;
}

function parseT(text: string | undefined): string[] | null {
  try {
    const o = JSON.parse(text ?? '');
    return Array.isArray(o?.t) && o.t.every((x: unknown) => typeof x === 'string') ? o.t : null;
  } catch {
    return null;
  }
}

/** Streams the results of all batches of `kind`, QA-checks them, returns results and real spend. */
async function collect(
  deps: Deps, job: Job, kind: BatchRef['kind'], chunks: Chunk[], glossary: GlossaryRow[], prior: ResMap,
): Promise<{ res: ResMap; usd: number }> {
  const llm = requireLlm(deps);
  const byId = new Map(chunks.map((c) => [c.id, c]));
  const res: ResMap = { ...prior };
  let usd = 0;
  const failAll = (c: Chunk, reason: string, model: string) => {
    for (const it of c.items) {
      if (!res[it.h] || !res[it.h].ok) res[it.h] = { t: '', raw: '', ok: false, reasons: [reason], m: model };
    }
  };
  const seen = new Set<string>();
  for (const b of job.batch_ids.filter((x) => x.kind === kind)) {
    for await (const r of llm.results(b.id)) {
      const c = byId.get(r.custom_id);
      if (!c) continue;
      seen.add(c.id);
      const model = r.model ?? c.model;
      if (r.usage) usd += usageCostUsd(model, r.usage);
      if (r.type !== 'succeeded') {
        failAll(c, `request:${r.type}`, model);
        continue;
      }
      if (r.stop_reason === 'max_tokens' || r.stop_reason === 'refusal') {
        failAll(c, `request:${r.stop_reason}`, model);
        continue;
      }
      const t = parseT(r.text);
      if (!t || t.length !== c.items.length) {
        failAll(c, 'length_mismatch', model);
        continue;
      }
      c.items.forEach((it, i) => {
        const original = unmask(it.m, it.toks);
        const q = qaCheck(original, t[i], it.toks, glossary);
        res[it.h] = { t: q.text, raw: t[i], ok: q.ok, reasons: q.reasons, m: model };
      });
    }
  }
  for (const c of chunks) if (!seen.has(c.id)) failAll(c, 'request:missing', c.model);
  return { res, usd };
}

function qaStats(res: ResMap, dropped = 0): NonNullable<Stats['qa']> {
  const reasons: Record<string, number> = {};
  let ok = 0;
  let failed = 0;
  for (const r of Object.values(res)) {
    if (r.ok) ok++;
    else {
      failed++;
      for (const x of r.reasons) reasons[x.split(':')[0]] = (reasons[x.split(':')[0]] ?? 0) + 1;
    }
  }
  return { ok, failed, reasons, dropped };
}

function glossaryFor(plan: Plan, db: GlossaryRow[]): GlossaryRow[] {
  return mergeGlossary(db, plan.newGlossary);
}

// ── steps ────────────────────────────────────────────────────────────────────

async function stepEstimating(deps: Deps, job: Job): Promise<void> {
  const { db, store } = deps;
  const settings = await db.getSettings();
  let r: PlanResult;
  try {
    r = await computePlan(deps, job, settings);
  } catch (e) {
    if (e instanceof TranslateError && (e.key === 'translate.no_base_build' || e.key === 'translate.base_build_missing')) {
      await db.cas(job, { status: 'skipped', error: e.key });
      return;
    }
    throw e;
  }
  const { plan, estimate, stringCount } = r;
  const stats = addStats(job, { counts: plan.counts, estimate, phase: undefined, hold: undefined });
  const base = { string_count: stringCount, estimate_usd: round4(estimate.usd) };

  if (!plan.chunks.length) {
    if (Object.keys(plan.reused).length) {
      await store.putJson(workKey(job.id, 'plan'), plan);
      await db.cas(job, { ...base, status: 'publishing', stats });
    } else {
      await db.cas(job, { ...base, status: 'skipped', error: 'translate.nothing_to_do', stats });
    }
    return;
  }
  await store.putJson(workKey(job.id, 'plan'), plan);
  if (plan.newGlossary.length) await db.insertGlossary(job.lang, plan.newGlossary);

  let hold: string | undefined;
  if (job.mode === 'full') hold = 'full';
  else {
    const others = await db.buildEstimateSum(job.build_id, job.id);
    if (others + estimate.usd > settings.upload_cap_usd) hold = 'upload_cap';
    else {
      const committed = await db.monthCommitted(monthOf(deps.now()), job.id);
      if (committed + estimate.usd > settings.monthly_cap_usd) hold = 'monthly_cap';
    }
  }
  await db.cas(job, { ...base, status: hold ? 'awaiting_approval' : 'queued', stats: addStats({ ...job, stats }, { hold }) });
}

async function stepQueued(deps: Deps, job: Job): Promise<void> {
  const settings = await deps.db.getSettings();
  if (!settings.enabled) return;
  requireLlm(deps);
  if (!job.approved_by && job.mode !== 'full') {
    const committed = await deps.db.monthCommitted(monthOf(deps.now()), job.id);
    if (committed + (job.estimate_usd ?? 0) > settings.monthly_cap_usd) {
      await deps.db.cas(job, { status: 'awaiting_approval', stats: addStats(job, { hold: 'monthly_cap' }) });
      return;
    }
  }
  const claimed = await deps.db.cas(job, { status: 'submitted', stats: addStats(job, { phase: 'submitting' }) });
  if (!claimed) return;
  await submitMain(deps, claimed);
}

async function submitMain(deps: Deps, job: Job): Promise<void> {
  const plan = await readPlan(deps, job);
  const reqs = plan.chunks.map((c) => ({
    custom_id: c.id,
    params: requestParams(c.model, c.maxTokens, plan.system, userMessage(c, plan.fewShot[c.id])),
  }));
  await submitGroups(deps, job, 'main', reqs);
}

async function stepSubmitted(deps: Deps, job: Job): Promise<void> {
  if (job.stats?.phase === 'submitting') {
    if (deps.now().getTime() - Date.parse(job.updated_at) > STALE_SUBMIT_MS) await submitMain(deps, job);
    return;
  }
  if (!(await allEnded(deps, job, 'main'))) return;
  await deps.db.cas(job, { status: 'validating', stats: addStats(job, { phase: 'results' }) });
}

function judgeSample(res: ResMap): string[] {
  const okH = Object.keys(res).filter((h) => res[h].ok).sort();
  if (!okH.length) return [];
  const n = Math.min(JUDGE_CAP, Math.max(Math.min(5, okH.length), Math.ceil(okH.length * 0.05)));
  return okH.slice(0, n);
}

function itemOf(plan: Plan, h: string): ChunkItem | undefined {
  for (const c of plan.chunks) for (const it of c.items) if (it.h === h) return it;
  return undefined;
}

async function stepValidating(deps: Deps, job: Job): Promise<void> {
  const { db, store } = deps;
  const plan = await readPlan(deps, job);
  const dbGlossary = await db.listGlossary(job.lang);
  const phase = job.stats?.phase ?? 'results';

  if (phase === 'results') {
    const { res, usd } = await collect(deps, job, 'main', plan.chunks, glossaryFor(plan, dbGlossary), {});
    await store.putJson(workKey(job.id, 'main-results'), res);
    await ledger(deps, job, 'main', usd);
    const sample = judgeSample(res);
    const next = addStats(job, {
      qa: qaStats(res), ledgered: [...(job.stats?.ledgered ?? []), 'main'], phase: sample.length ? 'judge_submitting' : 'judged',
    });
    const cur = await db.cas(job, { spent_usd: round4(job.spent_usd + usd), stats: next });
    if (!cur) return;
    if (sample.length) await submitJudge(deps, cur, plan, res, sample);
    else await afterJudge(deps, cur, plan, res);
    return;
  }

  const res = (await store.getJson(workKey(job.id, 'main-results'))) as ResMap | null;
  if (!res) throw new TranslateError('translate.results_missing');
  if (phase === 'judge_submitting') {
    if (deps.now().getTime() - Date.parse(job.updated_at) > STALE_SUBMIT_MS) await submitJudge(deps, job, plan, res, judgeSample(res));
    return;
  }
  if (phase === 'judge') {
    if (!(await allEnded(deps, job, 'judge'))) return;
    const sample = judgeSample(res);
    const scored = await readJudge(deps, job, plan, res, sample);
    await store.putJson(workKey(job.id, 'main-results'), scored.res);
    await ledger(deps, job, 'judge', scored.usd);
    const cur = await db.cas(job, {
      spent_usd: round4(job.spent_usd + scored.usd),
      stats: addStats(job, {
        judge: scored.judge, qa: qaStats(scored.res), ledgered: [...(job.stats?.ledgered ?? []), 'judge'], phase: 'judged',
      }),
    });
    if (cur) await afterJudge(deps, cur, plan, scored.res);
    return;
  }
  if (phase === 'judged') await afterJudge(deps, job, plan, res);
}

async function submitJudge(deps: Deps, job: Job, plan: Plan, res: ResMap, sample: string[]): Promise<void> {
  const samples = sample.map((h) => {
    const it = itemOf(plan, h)!;
    return { key: it.key, en: unmask(it.m, it.toks), t: res[h].t };
  });
  const reqs = [{ custom_id: 'j0', params: judgeParams(job.lang, JUDGE_MODEL, samples) }];
  const claimed = job.stats?.phase === 'judge_submitting' ? job : await must(await deps.db.cas(job, { stats: addStats(job, { phase: 'judge_submitting' }) }));
  const out = await submitGroups(deps, claimed, 'judge', reqs);
  await deps.db.cas(out, { stats: addStats(out, { phase: 'judge' }) });
}

async function readJudge(deps: Deps, job: Job, plan: Plan, res: ResMap, sample: string[]) {
  const llm = requireLlm(deps);
  let usd = 0;
  let scores: number[] | null = null;
  for (const b of job.batch_ids.filter((x) => x.kind === 'judge')) {
    for await (const r of llm.results(b.id)) {
      if (r.usage) usd += usageCostUsd(r.model ?? JUDGE_MODEL, r.usage);
      if (r.type !== 'succeeded') continue;
      try {
        const o = JSON.parse(r.text ?? '');
        if (Array.isArray(o?.r) && o.r.length === sample.length) scores = o.r.map((x: { score: number }) => Number(x.score));
      } catch { /* judge output unusable: no scores */ }
    }
  }
  const out: ResMap = { ...res };
  if (!scores) return { res: out, usd, judge: null };
  scores.forEach((s, i) => {
    if (Number.isFinite(s) && s < JUDGE_THRESHOLD) out[sample[i]] = { ...out[sample[i]], ok: false, reasons: [...out[sample[i]].reasons, `judge:${s}`] };
  });
  const valid = scores.filter((s) => Number.isFinite(s));
  return { res: out, usd, judge: { n: valid.length, mean: round4(valid.reduce((a, b) => a + b, 0) / Math.max(1, valid.length)) } };
}

async function afterJudge(deps: Deps, job: Job, plan: Plan, res: ResMap): Promise<void> {
  const failing = Object.keys(res).filter((h) => !res[h].ok);
  if (!failing.length) {
    await deps.db.cas(job, { status: 'publishing', stats: addStats(job, { phase: undefined }) });
    return;
  }
  const items: ChunkItem[] = [];
  for (const h of failing) {
    const it = itemOf(plan, h);
    if (it) items.push({ ...it, prev: res[h].raw || mask(res[h].t).m, reason: res[h].reasons });
  }
  const chunks = buildChunks(items, (it) => plan.keysByHash[it.h], { lang: job.lang, maxItems: 50, idPrefix: 'p' });
  await deps.store.putJson(workKey(job.id, 'postedit-plan'), { chunks });
  const claimed = await deps.db.cas(job, { status: 'post_editing', stats: addStats(job, { phase: 'submitting' }) });
  if (!claimed) return;
  await submitPostEdit(deps, claimed, plan, chunks);
}

async function submitPostEdit(deps: Deps, job: Job, plan: Plan, chunks: Chunk[]): Promise<void> {
  const reqs = chunks.map((c) => ({
    custom_id: c.id,
    params: requestParams(c.model, c.maxTokens, plan.system, postEditMessage(c)),
  }));
  await submitGroups(deps, job, 'postedit', reqs);
}

async function stepPostEditing(deps: Deps, job: Job): Promise<void> {
  const { db, store } = deps;
  const plan = await readPlan(deps, job);
  const pe = (await store.getJson(workKey(job.id, 'postedit-plan'))) as { chunks: Chunk[] } | null;
  if (!pe) throw new TranslateError('translate.plan_missing');
  if (job.stats?.phase === 'submitting') {
    if (deps.now().getTime() - Date.parse(job.updated_at) > STALE_SUBMIT_MS) await submitPostEdit(deps, job, plan, pe.chunks);
    return;
  }
  if (!(await allEnded(deps, job, 'postedit'))) return;
  const prior = (await store.getJson(workKey(job.id, 'main-results'))) as ResMap;
  const dbGlossary = await db.listGlossary(job.lang);
  const { res: edited, usd } = await collect(deps, job, 'postedit', pe.chunks, glossaryFor(plan, dbGlossary), {});
  const merged: ResMap = { ...prior };
  for (const [h, r] of Object.entries(edited)) merged[h] = r;
  await store.putJson(workKey(job.id, 'main-results'), merged);
  await ledger(deps, job, 'postedit', usd);
  const dropped = Object.values(merged).filter((r) => !r.ok).length;
  await db.cas(job, {
    status: 'publishing',
    spent_usd: round4(job.spent_usd + usd),
    stats: addStats(job, { qa: qaStats(merged, dropped), ledgered: [...(job.stats?.ledgered ?? []), 'postedit'], phase: undefined }),
  });
}

async function stepPublishing(deps: Deps, job: Job): Promise<void> {
  const { db, store } = deps;
  const plan = await readPlan(deps, job);
  const res = ((await store.getJson(workKey(job.id, 'main-results'))) ?? {}) as ResMap;
  const at = deps.now().toISOString();
  const entries: Record<string, { h: string; t: string }> = { ...plan.reused };
  const tmUpdates: Record<string, TmEntry> = {};
  const pairs: { en: string; t: string }[] = [];
  for (const [h, r] of Object.entries(res)) {
    if (!r.ok) continue;
    tmUpdates[h] = { t: r.t, o: 'ai', m: r.m, at };
    for (const k of plan.keysByHash[h] ?? []) entries[k] = { h, t: r.t };
    const it = itemOf(plan, h);
    if (it) pairs.push({ en: unmask(it.m, it.toks), t: r.t });
  }
  await saveTm(store, job.lang, tmUpdates);
  const overlay = makeOverlay(job.lang, job.build_id, entries, at);
  await store.putJson(overlayKey(job.lang, job.build_id), overlay);
  if (!(await db.hasNewerPublished(job))) await store.putJson(overlayKey(job.lang, 'latest'), overlay);

  const have = await db.listGlossary(job.lang);
  const ai = newRows(have, deriveAiTerms(pairs));
  if (ai.length) await db.insertGlossary(job.lang, ai);
  if (plan.forceIds.length) await db.resetRetranslate(plan.forceIds);

  const cur = await db.cas(job, { status: 'published', stats: addStats(job, { phase: undefined, published_at: at, overlay_count: overlay.count }) });
  if (cur) {
    for (const n of ['plan', 'main-results', 'postedit-plan']) await store.deleteKey(workKey(job.id, n)).catch(() => {});
  }
}

// ── driver ───────────────────────────────────────────────────────────────────

export async function fail(deps: Deps, job: Job, key: string): Promise<void> {
  await cancelBatches(deps, job);
  await deps.db.cas(job, { status: 'failed', error: key });
}

async function cancelBatches(deps: Deps, job: Job): Promise<void> {
  if (!deps.llm) return;
  for (const b of job.batch_ids) await deps.llm.cancel(b.id).catch(() => {});
}

export async function advance(deps: Deps, job: Job): Promise<Status> {
  try {
    switch (job.status) {
      case 'estimating': await stepEstimating(deps, job); break;
      case 'queued': await stepQueued(deps, job); break;
      case 'submitted': await stepSubmitted(deps, job); break;
      case 'validating': await stepValidating(deps, job); break;
      case 'post_editing': await stepPostEditing(deps, job); break;
      case 'publishing': await stepPublishing(deps, job); break;
    }
  } catch (e) {
    if (e instanceof LostRace) return job.status;
    if (e instanceof TranslateError) {
      await fail(deps, job, e.key);
    } else {
      const fresh = (await deps.db.getJob(job.id)) ?? job;
      const attempts = (fresh.stats?.attempts ?? 0) + 1;
      deps.log('translate step error', { job: job.id, status: fresh.status, error: String((e as Error)?.message ?? e) });
      if (attempts >= MAX_ATTEMPTS) await fail(deps, fresh, 'translate.internal');
      else await deps.db.cas(fresh, { stats: addStats(fresh, { attempts }) });
    }
  }
  return (await deps.db.getJob(job.id))?.status ?? job.status;
}

export interface TickSummary {
  id: string;
  lang: string;
  from: Status;
  to: Status;
}

export async function tick(deps: Deps, budgetMs = 110_000): Promise<TickSummary[]> {
  const settings = await deps.db.getSettings();
  const started = deps.now().getTime();
  const out: TickSummary[] = [];
  for (const job of await deps.db.listOpenJobs()) {
    if (deps.now().getTime() - started > budgetMs) break;
    if (!settings.enabled && (job.status === 'estimating' || job.status === 'queued')) continue;
    out.push({ id: job.id, lang: job.lang, from: job.status, to: await advance(deps, job) });
  }
  return out;
}

export async function approve(deps: Deps, jobId: string, userId: string | null): Promise<Job> {
  const job = await deps.db.getJob(jobId);
  if (!job) throw new TranslateError('translate.job_not_found');
  if (job.status !== 'awaiting_approval') throw new TranslateError('translate.not_awaiting_approval');
  const next = await deps.db.cas(job, { status: 'queued', approved_by: userId, stats: addStats(job, { hold: undefined }) });
  if (!next) throw new TranslateError('translate.conflict');
  return next;
}

export async function cancel(deps: Deps, jobId: string): Promise<Job> {
  const job = await deps.db.getJob(jobId);
  if (!job) throw new TranslateError('translate.job_not_found');
  if (job.status !== 'awaiting_approval' && !OPEN_STATUSES.includes(job.status)) throw new TranslateError('translate.not_cancellable');
  await cancelBatches(deps, job);
  const next = await deps.db.cas(job, { status: 'cancelled' });
  if (!next) throw new TranslateError('translate.conflict');
  return next;
}

/** Admin op: a `full` job (the whole gap) that always waits for approval, whatever the caps. */
export async function startFull(deps: Deps, build_id: string, lang: string): Promise<Job> {
  const language = await deps.db.getLanguage(lang);
  if (!language) throw new TranslateError('translate.lang_unknown');
  const job = await deps.db.insertJob({ build_id, lang, mode: 'full', base_build_id: null });
  await advance(deps, job);
  return (await deps.db.getJob(job.id)) ?? job;
}
