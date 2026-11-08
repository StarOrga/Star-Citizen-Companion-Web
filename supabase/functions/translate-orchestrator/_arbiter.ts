// B2 guarded arbiter: community vs AI (or any two non-CIG candidates) for one key's current
// English. Deterministic rules first; only what they cannot separate goes to a pairwise LLM
// comparison, asked in BOTH orders because LLM judges prefer a position (position bias,
// Zheng et al. 2023). Only an agreeing, confident verdict changes the TM, and only through the
// hysteresis rule (B3, `_revise.ts`); disagreement or low confidence becomes an admin card.
// Resumable: queue + in-flight batch live in `translation-work/learn-<lang>/arbiter.json`.

import { createCards, decidedKey, tmCard } from './_cards.ts';
import type { TmEntry } from './_diff.ts';
import { saveTm, tmIndexKey } from './_io.ts';
import type { CardRow } from './_learn_db.ts';
import { hasLearn, jsonParams, learnKey, readLearnBatch, resultJson, spendBlock, submitLearnBatch } from './_learn_batch.ts';
import type { LearnBatch } from './_learn_batch.ts';
import type { BatchResult, Deps } from './_machine.ts';
import { priceOf } from './_cost.ts';
import { sameMultiset, tokensOf } from './_mask.ts';
import { glossaryBlock, LANG_NAMES } from './_prompt.ts';
import type { GlossaryRow } from './_prompt.ts';
import { containsTerm, glossaryFailures } from './_qa.ts';
import { reviseStateFor, shouldReplace } from './_revise.ts';
import type { ReviseState } from './_revise.ts';
import { styleBlock } from './_style.ts';

export interface Conflict {
  key: string;
  h: string;
  en: string;
  incumbent: TmEntry;
  challenger: TmEntry;
}

export type Side = 'incumbent' | 'challenger';

export interface RuleInput {
  en: string;
  incumbent: TmEntry;
  challenger: TmEntry;
  glossary?: GlossaryRow[];
  /** The side's text belongs to an older English (its hash is stale). */
  staleIncumbent?: boolean;
  staleChallenger?: boolean;
  /** Text an admin chose on a card for this hash. */
  decided?: string | null;
}

export interface RuleVerdict {
  winner: Side | null;
  reason: string;
}

/** Equal modulo whitespace and punctuation (case is style, it stays significant). */
export function sameModuloPunct(a: string, b: string): boolean {
  const n = (s: string) => s.replace(/[\s\p{P}]+/gu, '');
  return n(a) === n(b);
}

/** Hard failures of one candidate: empty, real line break, placeholder multiset differs from the English. */
export function hardFailures(en: string, t: string): string[] {
  const out: string[] = [];
  if (!t || !t.trim()) out.push('empty');
  if (/[\r\n]/.test(t) && !/[\r\n]/.test(en)) out.push('newline');
  if (!sameMultiset(tokensOf(en), tokensOf(t))) out.push('tokens');
  return out;
}

/**
 * Pure rules in the B2 order. null = the rules cannot decide, the pair goes to the LLM.
 * CIG never reaches the arbiter (the caller skips keys with a valid CIG value); guarded anyway.
 */
export function ruleVerdict(i: RuleInput): RuleVerdict {
  const inc = i.incumbent;
  const ch = i.challenger;
  if (inc.o === 'cig') return { winner: 'incumbent', reason: 'cig' };
  if (ch.o === 'cig') return { winner: 'challenger', reason: 'cig' };
  if (inc.o === 'admin') return { winner: 'incumbent', reason: 'admin' };
  if (ch.o === 'admin') return { winner: 'challenger', reason: 'admin' };
  if (i.decided && i.decided === inc.t) return { winner: 'incumbent', reason: 'card' };
  if (i.decided && i.decided === ch.t) return { winner: 'challenger', reason: 'card' };
  if (sameModuloPunct(inc.t, ch.t)) return { winner: 'incumbent', reason: 'equal' };
  const fi = hardFailures(i.en, inc.t).length > 0;
  const fc = hardFailures(i.en, ch.t).length > 0;
  if (fi !== fc) return { winner: fi ? 'challenger' : 'incumbent', reason: 'qa' };
  if (fi && fc) return { winner: 'incumbent', reason: 'both_fail' };
  if (!!i.staleIncumbent !== !!i.staleChallenger) return { winner: i.staleIncumbent ? 'challenger' : 'incumbent', reason: 'stale' };
  const g = i.glossary ?? [];
  const gi = glossaryFailures(i.en, inc.t, g).length;
  const gc = glossaryFailures(i.en, ch.t, g).length;
  if (gi !== gc && (gi === 0 || gc === 0)) return { winner: gi ? 'challenger' : 'incumbent', reason: 'glossary' };
  return { winner: null, reason: 'llm' };
}

// ── pairwise LLM, both orders ────────────────────────────────────────────────

export interface PairJudgement {
  /** 'A' | 'B' | 'tie' as the model saw the positions. */
  w: 'A' | 'B' | 'tie';
  /** 0..1 */
  c: number;
}

export interface OrderVerdict {
  outcome: Side | 'card';
  winsForward: boolean;
  winsReverse: boolean;
  /** 0..1, for the card's doubt field. */
  doubt: number;
  /** The side both orders chose with confidence ≥ min (null otherwise). */
  agreed: Side | null;
}

/** Confidence an agreeing verdict needs before it counts. */
export const MIN_CONFIDENCE = 0.7;

/**
 * Forward = incumbent in A, challenger in B; reverse = challenger in A, incumbent in B.
 * - Both pick the same side with confidence ≥ min → that side.
 * - Both pick the incumbent (any confidence) or neither prefers the challenger in both orders → keep
 *   the incumbent: there is no case for a change, and a card would be noise.
 * - Opposite sides (the model followed the position, not the text) or the challenger wins both with
 *   low confidence → card.
 */
export function bothOrders(fwd: PairJudgement | null, rev: PairJudgement | null, min = MIN_CONFIDENCE): OrderVerdict {
  if (!fwd || !rev) return { outcome: 'card', winsForward: false, winsReverse: false, doubt: 1, agreed: null };
  const f: Side | 'tie' = fwd.w === 'A' ? 'incumbent' : fwd.w === 'B' ? 'challenger' : 'tie';
  const r: Side | 'tie' = rev.w === 'A' ? 'challenger' : rev.w === 'B' ? 'incumbent' : 'tie';
  const winsForward = f === 'challenger';
  const winsReverse = r === 'challenger';
  const c = Math.min(clamp01(fwd.c), clamp01(rev.c));
  const agreed: Side | null = f === r && f !== 'tie' && c >= min ? f : null;
  if (winsForward && winsReverse) {
    return { outcome: c >= min ? 'challenger' : 'card', winsForward, winsReverse, doubt: 1 - c, agreed };
  }
  if ((f === 'incumbent' && r === 'challenger') || (f === 'challenger' && r === 'incumbent')) {
    return { outcome: 'card', winsForward, winsReverse, doubt: 1, agreed };
  }
  return { outcome: 'incumbent', winsForward, winsReverse, doubt: f === r ? 1 - c : 0.5, agreed };
}

const clamp01 = (x: number) => (Number.isFinite(x) ? Math.max(0, Math.min(1, x)) : 0);

export const PAIR_SCHEMA = {
  type: 'object',
  properties: {
    r: {
      type: 'array',
      items: {
        type: 'object',
        properties: { w: { type: 'string', enum: ['A', 'B', 'tie'] }, c: { type: 'number' }, why: { type: 'string' } },
        required: ['w', 'c', 'why'],
        additionalProperties: false,
      },
    },
  },
  required: ['r'],
  additionalProperties: false,
} as const;

export function pairSystem(lang: string, glossary: GlossaryRow[], style: unknown): string {
  const name = LANG_NAMES[lang] ?? lang;
  const learned = styleBlock(style as Parameters<typeof styleBlock>[0]);
  return `You compare two ${name} translations (A and B) of the same Star Citizen game string. Hard criterion first: consistency with the glossary and the house style below (a candidate that breaks a glossary term or the house style loses). Then accuracy, then natural fluency. Placeholders like ~mission(…), <EM1>, %s, \\n must stay unchanged. Judge the text only — the order A/B means nothing. If both are equally good, answer "tie".
For each item return {"w":"A"|"B"|"tie","c":<confidence 0..1>,"why":"<at most 12 words>"}; output {"r":[...]}, one entry per item, input order.
${learned ? `\n${learned}\n` : ''}
GLOSSARY (English => ${name}):
${glossaryBlock(glossary, 12_000)}`;
}

export interface PairItem {
  i: number;
  key: string;
  en: string;
  a: string;
  b: string;
}

export const PAIR_ITEMS_PER_REQUEST = 25;

/** Glossary rows that occur in any of the items (keeps the prompt small). */
export function relevantGlossary(glossary: GlossaryRow[], ens: string[]): GlossaryRow[] {
  return glossary.filter((g) => g.source_term && ens.some((e) => containsTerm(e, g.source_term))).slice(0, 400);
}

// ── arbitrate ────────────────────────────────────────────────────────────────

/** A queued conflict with every key that shares its English (the card's spread). */
type Queued = Conflict & { keys: string[] };

interface ArbiterState {
  v: 1;
  queue: Queued[];
  batch: LearnBatch<Queued[]> | null;
}

export const arbiterKey = (lang: string) => learnKey(lang, 'arbiter');
export const reviseKey = (lang: string) => learnKey(lang, 'revise');
const QUEUE_CAP = 5000;
const BATCH_CONFLICTS = 200;

export interface ArbiterSummary {
  skipped?: string;
  ruled: number;
  kept: number;
  replaced: number;
  queued: number;
  submitted: number;
  cards: number;
  blocked?: string;
}

/**
 * Decides conflicts for one language. Call with new conflicts or with [] to resume an in-flight
 * batch. Winners are written to the TM; CIG and admin entries never move.
 */
export async function arbitrate(deps: Deps, lang: string, conflicts: Conflict[]): Promise<ArbiterSummary> {
  const sum: ArbiterSummary = { ruled: 0, kept: 0, replaced: 0, queued: 0, submitted: 0, cards: 0 };
  if (!hasLearn(deps)) return { ...sum, skipped: 'no_learn_db' };
  const d = deps;
  const settings = await d.learn.getLearnSettings();
  const state = ((await d.store.getJson(arbiterKey(lang))) as ArbiterState | null) ?? { v: 1, queue: [], batch: null };
  const glossary = await d.learn.listGlossary(lang);
  const decided = ((await d.store.getJson(decidedKey(lang))) ?? {}) as Record<string, string>;
  const buildId = await d.learn.currentBuildId();
  let revise = reviseStateFor((await d.store.getJson(reviseKey(lang))) as ReviseState | null, buildId);
  const tmIndex = (await d.store.getJson(tmIndexKey(lang))) as { count?: number } | null;
  const langStrings = Number(tmIndex?.count ?? 0);
  const writes: Record<string, TmEntry> = {};
  const cards: CardRow[] = [];

  const replaceWith = (c: Conflict, winsForward: boolean, winsReverse: boolean, byRule: boolean) => {
    if (byRule) {
      // A rule win (QA/stale/glossary failure of the incumbent) is a correctness fix, not a style revision.
      writes[c.h] = c.challenger;
      sum.replaced++;
      return;
    }
    const v = shouldReplace({
      winsForward, winsReverse, margin: settings.revise_margin, locked: c.incumbent.o === 'admin', isCig: c.incumbent.o === 'cig',
      changedThisRelease: revise.changed, budgetPct: settings.revise_budget_pct, langStrings,
    });
    if (!v.replace) {
      sum.kept++;
      return;
    }
    writes[c.h] = c.challenger;
    revise = { ...revise, changed: revise.changed + 1 };
    sum.replaced++;
  };

  // 1. rules
  const queued = new Map(state.queue.map((c) => [c.h, c]));
  for (const c of conflicts) {
    const v = ruleVerdict({ en: c.en, incumbent: c.incumbent, challenger: c.challenger, glossary, decided: decided[c.h] ?? null });
    if (v.winner === 'challenger') {
      sum.ruled++;
      replaceWith(c, true, true, true);
    } else if (v.winner === 'incumbent') {
      sum.ruled++;
      sum.kept++;
    } else if (queued.has(c.h)) {
      const q = queued.get(c.h)!;
      if (!q.keys.includes(c.key) && q.keys.length < 200) q.keys.push(c.key);
    } else if (state.queue.length < QUEUE_CAP) {
      const q: Queued = { ...c, keys: [c.key] };
      state.queue.push(q);
      queued.set(c.h, q);
      sum.queued++;
    }
  }

  // 2. finished batch
  if (state.batch) {
    const read = await readLearnBatch(d, state.batch.id, 'arbiter', settings.arbiter_model);
    if (read) {
      const items = state.batch.items;
      const fwd = judgements(read.results, 'f', items.length);
      const rev = judgements(read.results, 'r', items.length);
      items.forEach((c, i) => {
        const v = bothOrders(fwd[i], rev[i]);
        if (v.outcome === 'challenger') replaceWith(c, v.winsForward, v.winsReverse, false);
        else if (v.outcome === 'incumbent') sum.kept++;
        else {
          cards.push(tmCard({
            lang, key: c.key, keys: c.keys ?? [c.key], h: c.h, en: c.en, a: c.incumbent, b: c.challenger, doubt: v.doubt,
            fresh: true, why: 'arbiter_disagreement',
          }));
        }
      });
      state.batch = null;
    }
  }

  // 3. submit the next batch
  if (!state.batch && state.queue.length) {
    const take = state.queue.slice(0, BATCH_CONFLICTS);
    const est = estimatePairUsd(take, settings.arbiter_model);
    const block = await spendBlock(d, settings, est);
    if (block) sum.blocked = block;
    else {
      const reqs = pairRequests(lang, settings.arbiter_model, take, glossary, await d.learn.getStyle(lang));
      const id = await submitLearnBatch(d, reqs);
      state.batch = { id, submitted_at: d.now().toISOString(), items: take };
      state.queue = state.queue.slice(take.length);
      sum.submitted = take.length;
    }
  }

  if (Object.keys(writes).length) await saveTm(d.store, lang, writes);
  if (cards.length) sum.cards = await createCards(d.learn, cards);
  await d.store.putJson(reviseKey(lang), revise);
  await d.store.putJson(arbiterKey(lang), state);
  return sum;
}

function judgements(results: Map<string, BatchResult>, prefix: string, n: number): (PairJudgement | null)[] {
  const out: (PairJudgement | null)[] = Array.from({ length: n }, () => null);
  for (let g = 0; g * PAIR_ITEMS_PER_REQUEST < n; g++) {
    const o = resultJson(results.get(`${prefix}${g}`)) as { r?: { w: string; c: number }[] } | null;
    const size = Math.min(PAIR_ITEMS_PER_REQUEST, n - g * PAIR_ITEMS_PER_REQUEST);
    if (!o || !Array.isArray(o.r) || o.r.length !== size) continue;
    o.r.forEach((x, j) => {
      if (x && (x.w === 'A' || x.w === 'B' || x.w === 'tie')) out[g * PAIR_ITEMS_PER_REQUEST + j] = { w: x.w, c: Number(x.c) };
    });
  }
  return out;
}

/** Two requests per group of conflicts: forward (incumbent = A) and reverse (challenger = A). */
export function pairRequests(lang: string, model: string, items: Conflict[], glossary: GlossaryRow[], style: unknown) {
  const reqs: { custom_id: string; params: ReturnType<typeof jsonParams> }[] = [];
  for (let g = 0; g * PAIR_ITEMS_PER_REQUEST < items.length; g++) {
    const part = items.slice(g * PAIR_ITEMS_PER_REQUEST, (g + 1) * PAIR_ITEMS_PER_REQUEST);
    const system = pairSystem(lang, relevantGlossary(glossary, part.map((c) => c.en)), style);
    const max = 400 + part.length * 60;
    const fwd = part.map((c, i) => ({ i, key: c.key, en: c.en, a: c.incumbent.t, b: c.challenger.t }));
    const rev = part.map((c, i) => ({ i, key: c.key, en: c.en, a: c.challenger.t, b: c.incumbent.t }));
    reqs.push({ custom_id: `f${g}`, params: jsonParams(model, system, JSON.stringify(fwd), PAIR_SCHEMA, max) });
    reqs.push({ custom_id: `r${g}`, params: jsonParams(model, system, JSON.stringify(rev), PAIR_SCHEMA, max) });
  }
  return reqs;
}

/** Rough batch cost: ~ (system 3k + the texts) in, 60 tokens out per item and order, ×1.5 headroom. */
export function estimatePairUsd(items: Conflict[], model: string): number {
  const p = priceOf(model);
  const chars = items.reduce((a, c) => a + c.en.length + c.incumbent.t.length + c.challenger.t.length, 0);
  const requests = Math.ceil(items.length / PAIR_ITEMS_PER_REQUEST) * 2;
  const inTok = requests * 3000 + chars * 2 * 0.9;
  const outTok = items.length * 2 * 60;
  return ((inTok * p.in + outTok * p.out) / 1e6) * 1.5;
}

