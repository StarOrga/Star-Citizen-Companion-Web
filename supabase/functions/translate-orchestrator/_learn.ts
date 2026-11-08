// C · The learning step. Runs after every publish (C0, from _machine.ts), after every seed
// import / source sync (pipeline hooks) and once as a backfill (`op: learn`). Token-free first:
//   C1 mine short pairs from the TM + CIG table → term candidates with votes
//   C2 dnt: codex names (manufacturers, ships, locations) kept verbatim in ≥ 90 % of pairs
//   C3 style statistics → translation_languages.style
//   C8 promotion: ≥ promote_min_evidence occurrences and ≥ promote_min_agreement → origin 'mined'
//   B1 terms: community/AI lines whose English has a CIG term but whose target lacks it
// then the cheap LLM steps, each a Message Batch resumed on later ticks:
//   C6 Haiku pre-decision for contested candidates (both orders) → promote, else a card
//   B1 align batch rewrites only the flagged lines with a term hint (CIG lines never change)
//   C7 web research for the top open meta/wording cards, hard monthly cap
// Every write is idempotent (insert-only glossary rows, TM upserts by hash, cards deduped), so a
// re-run after a crash or a second trigger converges instead of duplicating.

import { applyAnsweredCards, createCards, termCard } from './_cards.ts';
import type { ApplySummary } from './_cards.ts';
import { arbitrate } from './_arbiter.ts';
import type { ArbiterSummary, PairJudgement } from './_arbiter.ts';
import { bothOrders, hardFailures, PAIR_SCHEMA } from './_arbiter.ts';
import { priceOf } from './_cost.ts';
import { isCigValid, sha256Hex } from './_diff.ts';
import type { TmEntry } from './_diff.ts';
import type { JudgeTerm } from './_glossary.ts';
import { loadTm, readLocaleTable, saveTm, tmShardKey } from './_io.ts';
import type { Store } from './_io.ts';
import type { CardRow, LearnGlossaryRow, LearnSettings } from './_learn_db.ts';
import {
  adjustKind, hasLearn, jsonParams, learnKey, monthKindSpend, monthOfDate, readLearnBatch, resultJson, spendBlock,
  submitLearnBatch,
} from './_learn_batch.ts';
import type { LearnBatch, LearnDeps } from './_learn_batch.ts';
import type { BatchResult, Deps } from './_machine.ts';
import { tokensOf } from './_mask.ts';
import { glossaryBlock, LANG_NAMES, OUTPUT_SCHEMA } from './_prompt.ts';
import type { BatchParams, GlossaryRow } from './_prompt.ts';
import { containsStem, containsTerm } from './_qa.ts';
import { propagateGlossaryChange, reviseStateFor, shouldReplace } from './_revise.ts';
import type { ReviseState } from './_revise.ts';
import { styleStats } from './_style.ts';
import type { StylePair } from './_style.ts';

export type LearnTrigger = 'publish' | 'seed' | 'sync' | 'backfill';
export type LineOrigin = 'admin' | 'cig' | 'community' | 'ai' | 'judge';

export const HAIKU_MODEL = 'claude-haiku-5-5';
export const WEB_MODEL = 'claude-sonnet-5-5';
const MAX_TERM_WORDS = 4;
const HAIKU_ITEMS = 150;
const ALIGN_LINES = 400;
const ALIGN_PER_REQUEST = 30;
const WEB_CARDS = 3;
const WEB_USD_PER_CARD = 0.08;
const STYLE_MIN_TRUSTED = 200;

// ── pure: mining (C1 / C8) ───────────────────────────────────────────────────

export interface MineLine {
  key: string;
  en: string;
  t: string;
  o: LineOrigin;
}

export interface Variant {
  text: string;
  votes: number;
  by: Partial<Record<LineOrigin, number>>;
}

export interface Candidate {
  source: string;
  /** Variants by lower-cased target. */
  variants: Map<string, Variant>;
  keys: string[];
}

/** A short term: at most 4 words, ≤ 40 chars, a letter, no placeholder, no line break. */
export function isShortTerm(s: string): boolean {
  const t = s.trim();
  if (!t || t.length > 40 || /[\r\n]/.test(t) || !/\p{L}/u.test(t)) return false;
  if (tokensOf(t).length) return false;
  return t.split(/\s+/).length <= MAX_TERM_WORDS;
}

export function mineCandidates(lines: MineLine[]): Map<string, Candidate> {
  const out = new Map<string, Candidate>();
  for (const l of lines) {
    if (!isShortTerm(l.en) || !l.t.trim() || /[\r\n]/.test(l.t) || l.t.length > 60) continue;
    const src = l.en.trim();
    const k = src.toLowerCase();
    let c = out.get(k);
    if (!c) out.set(k, (c = { source: src, variants: new Map(), keys: [] }));
    const t = l.t.trim();
    const vk = t.toLowerCase();
    let v = c.variants.get(vk);
    if (!v) c.variants.set(vk, (v = { text: t, votes: 0, by: {} }));
    v.votes++;
    v.by[l.o] = (v.by[l.o] ?? 0) + 1;
    if (c.keys.length < 20) c.keys.push(l.key);
  }
  return out;
}

export interface Assessment {
  status: 'promote' | 'ambiguous' | 'weak';
  target: string;
  runnerUp: Variant | null;
  /** Votes for the target inside the authoritative pool. */
  evidence: number;
  /** target votes / pool votes. */
  agreement: number;
  /** Which pool decided: admin > cig > rest. CIG is authoritative where it has an opinion. */
  pool: 'admin' | 'cig' | 'rest';
  /** All occurrences of the term (spread of a card). */
  total: number;
}

const poolVotes = (v: Variant, pool: Assessment['pool']) =>
  pool === 'rest' ? (v.by.community ?? 0) + (v.by.ai ?? 0) + (v.by.judge ?? 0) : (v.by[pool] ?? 0);

/**
 * C8: a term becomes binding at ≥ minEvidence occurrences and ≥ minAgreement agreement.
 * The pool is the most authoritative origin that has an opinion (admin, else CIG, else the rest),
 * so CIG's own wording is taken blindly and the hybrid style of a pack cannot outvote it.
 * Contested (enough evidence, no clear majority, a runner-up exists) → ambiguous (Haiku, then card).
 * Too little evidence → weak: wait for more strings instead of asking an admin.
 */
export function assessCandidate(c: Candidate, minEvidence: number, minAgreement: number): Assessment {
  const vs = [...c.variants.values()];
  const total = vs.reduce((a, v) => a + v.votes, 0);
  const pool: Assessment['pool'] = vs.some((v) => v.by.admin) ? 'admin' : vs.some((v) => v.by.cig) ? 'cig' : 'rest';
  const ranked = vs.map((v) => ({ v, n: poolVotes(v, pool) })).filter((x) => x.n > 0)
    .sort((a, b) => b.n - a.n || b.v.votes - a.v.votes || (a.v.text < b.v.text ? -1 : 1));
  const poolTotal = ranked.reduce((a, x) => a + x.n, 0);
  const top = ranked[0];
  const runner = ranked[1]?.v ?? null;
  if (!top) return { status: 'weak', target: '', runnerUp: null, evidence: 0, agreement: 0, pool, total };
  const agreement = top.n / poolTotal;
  // Admin pairs are reviewed: one admin vote is enough evidence.
  const enough = pool === 'admin' ? top.n >= 1 : top.n >= minEvidence;
  let status: Assessment['status'] = 'weak';
  if (enough && agreement >= minAgreement) status = 'promote';
  else if (poolTotal >= minEvidence && runner) status = 'ambiguous';
  return { status, target: top.v.text, runnerUp: runner, evidence: top.n, agreement, pool, total };
}

export interface GlossaryPlan {
  promote: LearnGlossaryRow[];
  contested: { source: string; a: Variant; b: Variant; a_ev: number; b_ev: number; keys: string[]; total: number }[];
  revise: { row: LearnGlossaryRow; source: string; target: string; evidence: number; keys: string[]; total: number }[];
}

const isProtected = (g: LearnGlossaryRow) => !!g.locked || g.origin === 'admin' || g.origin === 'cig';

export function planGlossary(
  cands: Map<string, Candidate>, glossary: LearnGlossaryRow[], s: Pick<LearnSettings, 'promote_min_evidence' | 'promote_min_agreement' | 'revise_margin'>,
): GlossaryPlan {
  const have = new Map(glossary.map((g) => [g.source_term.toLowerCase(), g]));
  const plan: GlossaryPlan = { promote: [], contested: [], revise: [] };
  for (const [k, c] of cands) {
    const a = assessCandidate(c, s.promote_min_evidence, s.promote_min_agreement);
    if (a.status === 'weak') continue;
    const row = have.get(k);
    if (row) {
      if (isProtected(row) || a.status !== 'promote') continue;
      if (row.target_term.toLowerCase() === a.target.toLowerCase()) continue;
      // Hysteresis pre-filter (B3): only a clearly better-backed variant may challenge a row.
      if (a.evidence < (row.evidence ?? 0) + s.revise_margin) continue;
      plan.revise.push({ row, source: c.source, target: a.target, evidence: a.evidence, keys: c.keys, total: a.total });
      continue;
    }
    if (a.status === 'promote') {
      plan.promote.push({
        source_term: c.source, target_term: a.target, category: a.target === c.source ? 'dnt' : 'term', origin: 'mined',
        evidence: a.evidence,
      });
    } else if (a.runnerUp) {
      const top = c.variants.get(a.target.toLowerCase())!;
      plan.contested.push({
        source: c.source, a: top, b: a.runnerUp, a_ev: poolVotes(top, a.pool), b_ev: poolVotes(a.runnerUp, a.pool), keys: c.keys,
        total: a.total,
      });
    }
  }
  plan.contested.sort((x, y) => y.total - x.total);
  plan.revise.sort((x, y) => y.total - x.total);
  return plan;
}

// ── pure: dnt from codex names (C2) ──────────────────────────────────────────

function hasWord(text: string, term: string): boolean {
  let i = text.indexOf(term);
  while (i >= 0) {
    const before = i === 0 ? '' : text[i - 1];
    const after = text[i + term.length] ?? '';
    if (!/[\p{L}\p{N}]/u.test(before) && !/[\p{L}\p{N}]/u.test(after)) return true;
    i = text.indexOf(term, i + 1);
  }
  return false;
}

/**
 * Codex names that the translations keep verbatim in ≥ `ratio` of the pairs whose English
 * contains them (case-sensitive, whole words), with at least `minEvidence` such pairs.
 */
export function dntFromNames(
  names: string[], pairs: { en: string; t: string }[], minEvidence: number, ratio = 0.9,
): LearnGlossaryRow[] {
  const byFirst = new Map<string, number[]>();
  pairs.forEach((p, i) => {
    for (const w of new Set(p.en.match(/\p{Lu}[\p{L}\p{N}'-]*/gu) ?? [])) {
      let l = byFirst.get(w);
      if (!l) byFirst.set(w, (l = []));
      l.push(i);
    }
  });
  const out: LearnGlossaryRow[] = [];
  const seen = new Set<string>();
  for (const raw of names) {
    const name = raw.trim();
    if (name.length < 3 || name.length > 40 || seen.has(name.toLowerCase()) || !/^\p{Lu}/u.test(name)) continue;
    seen.add(name.toLowerCase());
    const first = name.split(/\s+/)[0].replace(/[^\p{L}\p{N}'-]+$/u, '');
    let n = 0;
    let kept = 0;
    for (const i of byFirst.get(first) ?? []) {
      const p = pairs[i];
      if (!hasWord(p.en, name)) continue;
      n++;
      if (p.t.includes(name)) kept++;
    }
    if (n >= minEvidence && kept / n >= ratio) {
      out.push({ source_term: name, target_term: name, category: 'dnt', origin: 'mined', evidence: n });
    }
  }
  return out.sort((a, b) => (b.evidence ?? 0) - (a.evidence ?? 0)).slice(0, 1000);
}

// ── pure: B1 line detection ──────────────────────────────────────────────────

/**
 * Case-sensitive whole-word hit of a game term. A single-word term must not only stand at the
 * start of a sentence ("Open the door" is no use of the term "Open").
 */
export function termHit(en: string, term: string): boolean {
  if (/\s/.test(term.trim())) return hasWord(en, term);
  let i = en.indexOf(term);
  while (i >= 0) {
    const before = i === 0 ? '' : en[i - 1];
    const after = en[i + term.length] ?? '';
    const sentenceStart = i === 0 || /[.!?:]\s*$/.test(en.slice(Math.max(0, i - 3), i));
    if (!/[\p{L}\p{N}]/u.test(before) && !/[\p{L}\p{N}]/u.test(after) && !sentenceStart) return true;
    i = en.indexOf(term, i + 1);
  }
  return false;
}

export interface AlignLine {
  key: string;
  h: string;
  en: string;
  entry: TmEntry;
  terms: { source: string; target: string }[];
}

/**
 * Community/AI lines whose English contains a CIG term while the target lacks the CIG target
 * (inflection-tolerant). CIG and admin lines are never candidates. dnt and label rows excluded:
 * labels are whole-string pairs, dnt names are covered by the QA gate.
 */
export function findMisaligned(
  lines: { key: string; h: string; en: string; entry: TmEntry }[], terms: GlossaryRow[], cap = ALIGN_LINES,
): AlignLine[] {
  const usable = terms.filter((g) => g.category === 'term' && g.source_term.length >= 3 && g.target_term &&
    g.source_term.toLowerCase() !== g.target_term.toLowerCase());
  if (!usable.length) return [];
  const out: AlignLine[] = [];
  const seen = new Set<string>();
  for (const l of lines) {
    if (out.length >= cap) break;
    if ((l.entry.o !== 'community' && l.entry.o !== 'ai') || seen.has(l.h)) continue;
    const miss: { source: string; target: string }[] = [];
    for (const g of usable) {
      if (termHit(l.en, g.source_term) && !containsStem(l.entry.t, g.target_term)) miss.push({ source: g.source_term, target: g.target_term });
      if (miss.length >= 4) break;
    }
    if (miss.length) {
      seen.add(l.h);
      out.push({ ...l, terms: miss });
    }
  }
  return out;
}

// ── judge candidates (C5) ────────────────────────────────────────────────────

const judgeKey = (lang: string) => learnKey(lang, 'judge-terms');

/** Appends the judge's term corrections; they vote in the next mining pass (origin 'judge'). */
export async function addJudgeCandidates(store: Store, lang: string, terms: JudgeTerm[]): Promise<void> {
  const cur = ((await store.getJson(judgeKey(lang))) ?? []) as JudgeTerm[];
  await store.putJson(judgeKey(lang), [...cur, ...terms].slice(-2000));
}

// ── state ────────────────────────────────────────────────────────────────────

interface HaikuItem {
  source: string;
  /** a = incumbent (top variant / current row), b = challenger. */
  a: string;
  b: string;
  a_ev: number;
  b_ev: number;
  total: number;
  keys: string[];
  /** Set when b challenges an existing glossary row. */
  row_id?: string;
  row_origin?: string;
  examples: { en: string; t: string }[];
}

interface WebItem {
  card_id: string;
  context: Record<string, unknown>;
  /** Reserved against the web cap at submit (month of the reservation). */
  est: number;
  month: string;
}

interface LearnState {
  v: 1;
  haiku: LearnBatch<HaikuItem[]> | null;
  align: LearnBatch<AlignLine[]> | null;
  web: LearnBatch<WebItem[]> | null;
  last?: { trigger: LearnTrigger; at: string; build_id: string | null };
}

export const stateKey = (lang: string) => learnKey(lang, 'state');

async function loadState(store: Store, lang: string): Promise<LearnState> {
  const s = (await store.getJson(stateKey(lang))) as LearnState | null;
  return s && s.v === 1 ? s : { v: 1, haiku: null, align: null, web: null };
}

export interface LearnSummary {
  lang: string;
  trigger: LearnTrigger | 'resume';
  skipped?: string;
  cards?: ApplySummary;
  mined?: { candidates: number; promoted: number; contested: number; revise: number };
  dnt?: number;
  style?: boolean;
  haiku?: { submitted: number; promoted: number; replaced: number; cards: number };
  align?: { submitted: number; rewritten: number };
  web?: { submitted: number; attached: number };
  arbiter?: ArbiterSummary;
  blocked: string[];
}

// ── run ──────────────────────────────────────────────────────────────────────

/** Resumes in-flight learning batches only (cheap; called from every tick). */
export async function resumeLearning(deps: Deps, lang: string): Promise<LearnSummary> {
  const sum: LearnSummary = { lang, trigger: 'resume', blocked: [] };
  if (!hasLearn(deps)) return { ...sum, skipped: 'no_learn_db' };
  const state = await loadState(deps.store, lang);
  const arb = await deps.store.getJson(learnKey(lang, 'arbiter')) as { queue?: unknown[]; batch?: unknown } | null;
  const busy = state.haiku || state.align || state.web || arb?.batch || (arb?.queue?.length ?? 0) > 0;
  if (!busy) return { ...sum, skipped: 'idle' };
  const settings = await deps.learn.getLearnSettings();
  await pollBatches(deps, lang, settings, state, sum);
  await deps.store.putJson(stateKey(lang), state);
  if (arb) sum.arbiter = await arbitrate(deps, lang, []);
  return sum;
}

export async function runLearning(deps: Deps, lang: string, trigger: LearnTrigger): Promise<LearnSummary> {
  const sum: LearnSummary = { lang, trigger, blocked: [] };
  if (!hasLearn(deps)) return { ...sum, skipped: 'no_learn_db' };
  const d = deps;
  const { store, learn } = d;
  const settings = await learn.getLearnSettings();
  sum.cards = await applyAnsweredCards(d, lang);
  const state = await loadState(store, lang);
  await pollBatches(d, lang, settings, state, sum);

  const buildId = await learn.currentBuildId();
  const language = await d.db.getLanguage(lang);
  if (!buildId || !language) {
    await store.putJson(stateKey(lang), state);
    return { ...sum, skipped: buildId ? 'lang_unknown' : 'no_build' };
  }
  const en = await readLocaleTable(store, buildId, 'en');
  if (!Object.keys(en).length) {
    await store.putJson(stateKey(lang), state);
    return { ...sum, skipped: 'english_missing' };
  }
  const cig = await readLocaleTable(store, buildId, language.cig_folder || lang);
  const tm = await loadTm(store, lang);

  // One line per key with its current target and origin (CIG valid → CIG, else the TM).
  const lines: MineLine[] = [];
  const tmLines: { key: string; h: string; en: string; entry: TmEntry }[] = [];
  const hashOf = new Map<string, string>();
  for (const key of Object.keys(en).sort()) {
    const e = en[key];
    if (!e || !e.trim()) continue;
    if (isCigValid(e, cig[key])) {
      lines.push({ key, en: e, t: cig[key], o: 'cig' });
      continue;
    }
    let h = hashOf.get(e);
    if (!h) hashOf.set(e, (h = await sha256Hex(e)));
    const hit = tm[h];
    if (!hit) continue;
    lines.push({ key, en: e, t: hit.t, o: hit.o });
    tmLines.push({ key, h, en: e, entry: hit });
  }

  // C3 style: CIG + admin teach it; the community joins only where CIG says too little.
  const trusted = lines.filter((l) => l.o === 'cig' || l.o === 'admin');
  const stylePairs: StylePair[] = trusted.length >= STYLE_MIN_TRUSTED ? trusted : lines.filter((l) => l.o !== 'ai');
  if (stylePairs.length) {
    const from = [...new Set(stylePairs.map((l) => l.o))].sort();
    await learn.setStyle(lang, { ...styleStats(lang, stylePairs, from), at: d.now().toISOString() });
    sum.style = true;
  }

  // C1 + C5 candidates, C8 promotion.
  const judge = ((await store.getJson(judgeKey(lang))) ?? []) as JudgeTerm[];
  const mineInput: MineLine[] = [...lines, ...judge.map((j, i) => ({ key: `judge:${i}`, en: j.source, t: j.target, o: 'judge' as const }))];
  const cands = mineCandidates(mineInput);
  let glossary = await learn.listGlossary(lang);
  const plan = planGlossary(cands, glossary, settings);
  const promoted = plan.promote.length ? await learn.insertGlossary(lang, plan.promote) : 0;
  sum.mined = { candidates: cands.size, promoted, contested: plan.contested.length, revise: plan.revise.length };

  // C2 dnt from codex names.
  const names = await learn.codexNames(buildId).catch(() => [] as string[]);
  if (names.length) {
    glossary = await learn.listGlossary(lang);
    const have = new Set(glossary.map((g) => g.source_term.toLowerCase()));
    const dnt = dntFromNames(names, lines, settings.promote_min_evidence).filter((r) => !have.has(r.source_term.toLowerCase()));
    sum.dnt = dnt.length ? await learn.insertGlossary(lang, dnt) : 0;
  }

  // C6: contested candidates and row challenges → one Haiku batch (both orders).
  if (!state.haiku && (plan.contested.length || plan.revise.length)) {
    const exampleOf = (src: string, t: string) =>
      lines.filter((l) => l.en.length <= 200 && containsTerm(l.en, src) && containsStem(l.t, t)).slice(0, 2).map((l) => ({ en: l.en, t: l.t }));
    const items: HaikuItem[] = [
      ...plan.revise.map((r) => ({
        source: r.source, a: r.row.target_term, b: r.target, a_ev: r.row.evidence ?? 0, b_ev: r.evidence, total: r.total, keys: r.keys,
        row_id: r.row.id, row_origin: r.row.origin, examples: [...exampleOf(r.source, r.row.target_term), ...exampleOf(r.source, r.target)],
      })),
      ...plan.contested.map((c) => ({
        source: c.source, a: c.a.text, b: c.b.text, a_ev: c.a_ev, b_ev: c.b_ev, total: c.total, keys: c.keys,
        examples: [...exampleOf(c.source, c.a.text), ...exampleOf(c.source, c.b.text)],
      })),
    ].slice(0, HAIKU_ITEMS);
    const est = estimateUsd(HAIKU_MODEL, items.length * 2, 2500, items.length * 2 * 50, items.length * 2 * 400);
    const block = await spendBlock(d, settings, est);
    if (block) sum.blocked.push(`haiku:${block}`);
    else {
      const id = await submitLearnBatch(d, haikuRequests(lang, items, glossary));
      state.haiku = { id, submitted_at: d.now().toISOString(), items };
      sum.haiku = { submitted: items.length, promoted: 0, replaced: 0, cards: 0 };
    }
  }

  // B1: align community/AI lines to CIG terms.
  if (!state.align) {
    // CIG terms = protected rows plus the candidates CIG itself decides this run (pool cig/admin).
    const cigTerms: GlossaryRow[] = glossary.filter((g) => g.origin === 'cig' || g.origin === 'admin' || g.locked);
    const known = new Set(cigTerms.map((g) => g.source_term.toLowerCase()));
    for (const c of cands.values()) {
      if (known.has(c.source.toLowerCase())) continue;
      const a = assessCandidate(c, settings.promote_min_evidence, settings.promote_min_agreement);
      if (a.status === 'promote' && a.pool !== 'rest' && /\p{Lu}/u.test(c.source)) {
        cigTerms.push({ source_term: c.source, target_term: a.target, category: 'term', origin: 'cig' });
      }
    }
    const mis = findMisaligned(tmLines, cigTerms);
    if (mis.length) {
      const chars = mis.reduce((a, l) => a + l.en.length + l.entry.t.length, 0);
      const est = estimateUsd(settings.arbiter_model, Math.ceil(mis.length / ALIGN_PER_REQUEST), 1500, Math.ceil(chars * 0.6), chars * 0.9);
      const block = await spendBlock(d, settings, est);
      if (block) sum.blocked.push(`align:${block}`);
      else {
        const id = await submitLearnBatch(d, alignRequests(lang, settings.arbiter_model, mis));
        state.align = { id, submitted_at: d.now().toISOString(), items: mis };
        sum.align = { submitted: mis.length, rewritten: 0 };
      }
    }
  }

  // C7: web research for the top open meta/wording cards, hard monthly cap.
  if (!state.web) await submitWeb(d, lang, settings, state, sum);

  // Arbiter queue (conflicts from seed/sync) advances with every run as well.
  if (await store.getJson(learnKey(lang, 'arbiter'))) sum.arbiter = await arbitrate(d, lang, []);

  state.last = { trigger, at: d.now().toISOString(), build_id: buildId };
  await store.putJson(stateKey(lang), state);
  return sum;
}

function estimateUsd(model: string, requests: number, systemTok: number, outTok: number, inTok: number): number {
  const p = priceOf(model);
  return (((requests * systemTok + inTok) * p.in + outTok * p.out) / 1e6) * 1.5;
}

// ── batches ──────────────────────────────────────────────────────────────────

const HAIKU_PER_REQUEST = 20;

function haikuSystem(lang: string, glossary: GlossaryRow[]): string {
  const name = LANG_NAMES[lang] ?? lang;
  return `You decide which ${name} term is the right translation of an English Star Citizen game term, for use everywhere in the game. Each item gives the English term, two candidate translations A and B, and example lines. Prefer the wording of CIG's official ${name} localization and consistency with the glossary below; proper names stay in English. The order A/B means nothing. Answer "tie" when both are equally right.
For each item return {"w":"A"|"B"|"tie","c":<confidence 0..1>,"why":"<at most 12 words>"}; output {"r":[...]}, input order.

GLOSSARY (English => ${name}):
${glossaryBlock(glossary, 10_000)}`;
}

export function haikuRequests(lang: string, items: HaikuItem[], glossary: GlossaryRow[]): { custom_id: string; params: BatchParams }[] {
  const reqs: { custom_id: string; params: BatchParams }[] = [];
  const system = haikuSystem(lang, glossary.filter((g) => g.origin === 'cig' || g.origin === 'admin' || g.locked));
  for (let g = 0; g * HAIKU_PER_REQUEST < items.length; g++) {
    const part = items.slice(g * HAIKU_PER_REQUEST, (g + 1) * HAIKU_PER_REQUEST);
    const fwd = part.map((x) => ({ en: x.source, A: x.a, B: x.b, examples: x.examples }));
    const rev = part.map((x) => ({ en: x.source, A: x.b, B: x.a, examples: x.examples }));
    reqs.push({ custom_id: `f${g}`, params: jsonParams(HAIKU_MODEL, system, JSON.stringify(fwd), PAIR_SCHEMA, 300 + part.length * 60) });
    reqs.push({ custom_id: `r${g}`, params: jsonParams(HAIKU_MODEL, system, JSON.stringify(rev), PAIR_SCHEMA, 300 + part.length * 60) });
  }
  return reqs;
}

function pairOf(results: Map<string, BatchResult>, id: string, j: number): PairJudgement | null {
  const o = resultJson(results.get(id)) as { r?: { w: string; c: number }[] } | null;
  const x = o?.r?.[j];
  return x && (x.w === 'A' || x.w === 'B' || x.w === 'tie') ? { w: x.w, c: Number(x.c) } : null;
}

export function alignRequests(lang: string, model: string, lines: AlignLine[]): { custom_id: string; params: BatchParams }[] {
  const name = LANG_NAMES[lang] ?? lang;
  const system = `You align existing ${name} Star Citizen translations with CIG's official terminology. Each entry is [English, current translation, required terms as "English => ${name}"]. Rewrite the current translation minimally so it uses every required ${name} term (inflect it where grammar needs); change nothing else — keep wording, style, placeholders (~mission(…), <EM1>, %s, \\n, [..]) and punctuation. Return only JSON {"t":[...]}, one string per entry, input order.`;
  const reqs: { custom_id: string; params: BatchParams }[] = [];
  for (let g = 0; g * ALIGN_PER_REQUEST < lines.length; g++) {
    const part = lines.slice(g * ALIGN_PER_REQUEST, (g + 1) * ALIGN_PER_REQUEST);
    const user = JSON.stringify(part.map((l) => [l.en, l.entry.t, l.terms.map((t) => `${t.source} => ${t.target}`)]));
    const chars = part.reduce((a, l) => a + l.entry.t.length, 0);
    reqs.push({ custom_id: `a${g}`, params: jsonParams(model, system, user, OUTPUT_SCHEMA, Math.ceil(chars * 0.9 * 2) + 300) });
  }
  return reqs;
}

async function pollBatches(d: LearnDeps, lang: string, settings: LearnSettings, state: LearnState, sum: LearnSummary): Promise<void> {
  if (state.haiku) {
    const read = await readLearnBatch(d, state.haiku.id, 'haiku', HAIKU_MODEL);
    if (read) {
      sum.haiku = { submitted: 0, ...(await applyHaiku(d, lang, settings, state.haiku.items, read.results)) };
      state.haiku = null;
    }
  }
  if (state.align) {
    const read = await readLearnBatch(d, state.align.id, 'align', settings.arbiter_model);
    if (read) {
      sum.align = { submitted: 0, rewritten: await applyAlign(d, lang, state.align.items, read.results, settings.arbiter_model) };
      state.align = null;
    }
  }
  if (state.web) {
    const read = await readLearnBatch(d, state.web.id, 'web', WEB_MODEL);
    if (read) {
      for (const it of state.web.items) await adjustKind(d.store, it.month, 'web_reserved', -it.est);
      let attached = 0;
      for (const [i, item] of state.web.items.entries()) {
        const r = read.results.get(`w${i}`);
        const text = r?.type === 'succeeded' ? (r.text ?? '').trim() : '';
        if (!text) continue;
        await d.learn.updateCardContext(item.card_id, {
          ...item.context, research: { text: text.slice(0, 2000), at: d.now().toISOString(), model: r?.model ?? WEB_MODEL },
        });
        attached++;
      }
      sum.web = { submitted: 0, attached };
      state.web = null;
    }
  }
}

async function applyHaiku(
  d: LearnDeps, lang: string, settings: LearnSettings, items: HaikuItem[], results: Map<string, BatchResult>,
): Promise<{ promoted: number; replaced: number; cards: number }> {
  let promoted = 0;
  let replaced = 0;
  const cards: CardRow[] = [];
  const buildId = await d.learn.currentBuildId();
  let revise = reviseStateFor((await d.store.getJson(learnKey(lang, 'revise'))) as ReviseState | null, buildId);
  const tmIndex = (await d.store.getJson(`translation-tm/${lang}/index.json`)) as { count?: number } | null;
  const langStrings = Number(tmIndex?.count ?? 0);
  const rows: LearnGlossaryRow[] = [];
  items.forEach((x, i) => {
    const g = Math.floor(i / HAIKU_PER_REQUEST);
    const j = i % HAIKU_PER_REQUEST;
    const v = bothOrders(pairOf(results, `f${g}`, j), pairOf(results, `r${g}`, j));
    if (x.row_id) {
      // Row challenge (B3): both orders + evidence margin + release budget.
      const ok = v.outcome === 'challenger' && shouldReplace({
        winsForward: v.winsForward, winsReverse: v.winsReverse, evidenceNew: x.b_ev, evidenceOld: x.a_ev,
        margin: settings.revise_margin, locked: x.row_origin === 'admin', isCig: x.row_origin === 'cig',
        changedThisRelease: revise.changed, budgetPct: settings.revise_budget_pct, langStrings,
      }).replace;
      if (ok) {
        revise = { ...revise, changed: revise.changed + 1 };
        rows.push({ id: x.row_id, source_term: x.source, target_term: x.b, category: 'term', origin: x.row_origin ?? 'mined', evidence: x.b_ev });
      } else if (v.outcome === 'card') {
        cards.push(termCard({
          lang, source_term: x.source, a: { text: x.a, source: 'glossary', votes: x.a_ev }, b: { text: x.b, source: 'mined', votes: x.b_ev },
          spread: x.total, sampleKeys: x.keys, doubt: v.doubt, fresh: false, why: 'revise_disagreement',
        }));
      }
      return;
    }
    if (v.agreed) {
      const text = v.agreed === 'incumbent' ? x.a : x.b;
      rows.push({ source_term: x.source, target_term: text, category: text === x.source ? 'dnt' : 'term', origin: 'mined', evidence: Math.max(x.a_ev, x.b_ev) });
    } else {
      cards.push(termCard({
        lang, source_term: x.source, a: { text: x.a, source: 'mined', votes: x.a_ev }, b: { text: x.b, source: 'mined', votes: x.b_ev },
        spread: x.total, sampleKeys: x.keys, doubt: v.doubt, fresh: false, why: 'contested_term',
      }));
    }
  });
  for (const r of rows) {
    if (r.id) {
      if (await propagateGlossaryChange(d.learn, { id: r.id, origin: r.origin }, { target_term: r.target_term, evidence: r.evidence ?? 0 })) replaced++;
    } else promoted += await d.learn.insertGlossary(lang, [r]);
  }
  await d.store.putJson(learnKey(lang, 'revise'), revise);
  const n = cards.length ? await createCards(d.learn, cards) : 0;
  return { promoted, replaced, cards: n };
}

async function applyAlign(
  d: LearnDeps, lang: string, items: AlignLine[], results: Map<string, BatchResult>, model: string,
): Promise<number> {
  const at = d.now().toISOString();
  const writes: Record<string, TmEntry> = {};
  const shards = new Map<string, Record<string, TmEntry>>();
  for (let g = 0; g * ALIGN_PER_REQUEST < items.length; g++) {
    const part = items.slice(g * ALIGN_PER_REQUEST, (g + 1) * ALIGN_PER_REQUEST);
    const o = resultJson(results.get(`a${g}`)) as { t?: unknown } | null;
    if (!o || !Array.isArray(o.t) || o.t.length !== part.length) continue;
    for (const [j, l] of part.entries()) {
      const t = String(o.t[j] ?? '');
      if (hardFailures(l.en, t).length || !l.terms.every((x) => containsStem(t, x.target))) continue;
      // Only if the TM still holds the text we aligned (an arbiter or admin may have replaced it meanwhile).
      const hh = l.h.slice(0, 2);
      if (!shards.has(hh)) shards.set(hh, ((await d.store.getJson(tmShardKey(lang, hh))) ?? {}) as Record<string, TmEntry>);
      const cur = shards.get(hh)![l.h];
      if (!cur || cur.t !== l.entry.t || cur.o === 'admin' || cur.o === 'cig') continue;
      // A rewritten community line keeps its source and licence (a derivative stays under it).
      writes[l.h] = { ...cur, t, m: model, at };
    }
  }
  if (Object.keys(writes).length) await saveTm(d.store, lang, writes);
  return Object.keys(writes).length;
}

async function submitWeb(d: LearnDeps, lang: string, settings: LearnSettings, state: LearnState, sum: LearnSummary): Promise<void> {
  if (!(settings.web_research_cap_usd > 0)) return;
  const month = monthOfDate(d.now());
  const spent = (await monthKindSpend(d.store, month, 'web')) + (await monthKindSpend(d.store, month, 'web_reserved'));
  const open = (await d.learn.listOpenCards(lang, ['meta', 'wording'], 20)).filter((c) => !(c.context as { research?: unknown })?.research);
  const top = open.slice(0, WEB_CARDS);
  if (!top.length) return;
  // Hard cap: never submit when the month's web spend plus this batch could pass it.
  if (spent + top.length * WEB_USD_PER_CARD > settings.web_research_cap_usd) {
    sum.blocked.push('web:cap');
    return;
  }
  const block = await spendBlock(d, settings, top.length * WEB_USD_PER_CARD);
  if (block) {
    sum.blocked.push(`web:${block}`);
    return;
  }
  const name = LANG_NAMES[lang] ?? lang;
  const reqs = top.map((c, i) => {
    const ctx = (c.context ?? {}) as Record<string, unknown>;
    const user = `Star Citizen ${name} localization question for a reviewer: ${c.question}
English: ${String(ctx.en ?? ctx.term ?? '')}
Option A: ${c.option_a.text}
Option B: ${c.option_b.text}
Search the web (e.g. starcitizen.tools in ${name}, the RSI website, ${name} community wikis) for how CIG and the ${name} community write this. Report the findings in at most 80 words with the URLs you used. Do not decide; report evidence only.`;
    return {
      custom_id: `w${i}`,
      params: {
        model: WEB_MODEL,
        max_tokens: 2048,
        system: 'You research game terminology for a localization reviewer. Be brief and cite URLs.',
        messages: [{ role: 'user' as const, content: user }],
        tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: 3 }],
      } as BatchParams,
    };
  });
  const id = await submitLearnBatch(d, reqs);
  // Reserve the estimate now so two languages in one tick cannot both pass the cap; the real spend
  // is booked (ledger + 'web' total) when the results are read, and the reservation released then.
  await adjustKind(d.store, month, 'web_reserved', top.length * WEB_USD_PER_CARD);
  state.web = {
    id, submitted_at: d.now().toISOString(),
    items: top.map((c) => ({ card_id: c.id!, context: (c.context ?? {}) as Record<string, unknown>, est: WEB_USD_PER_CARD, month })),
  };
  sum.web = { submitted: top.length, attached: 0 };
}
