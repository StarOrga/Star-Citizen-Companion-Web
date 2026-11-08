// Message Batches for the learning step (arbiter, Haiku pre-decision, B1 align, web research).
// Every LLM step is a batch whose id lives in an R2 work key, so a step started on one tick
// is read on a later one. Spend is checked against the monthly cap BEFORE submitting and booked
// in the ledger when the results are read (same rule as every job spend).

import { usageCostUsd } from './_cost.ts';
import type { Store } from './_io.ts';
import type { LearnDb, LearnSettings } from './_learn_db.ts';
import type { BatchResult, Deps } from './_machine.ts';
import type { BatchParams } from './_prompt.ts';

export const learnKey = (lang: string, name: string) => `translation-work/learn-${lang}/${name}.json`;
/** Month totals of learning spend per kind, across languages (web research cap). */
export const spendKey = (month: string) => `translation-work/learn-spend/${month}.json`;

export const monthOfDate = (d: Date) => `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-01`;

export interface LearnBatch<T> {
  id: string;
  submitted_at: string;
  items: T;
}

export type LearnDeps = Deps & { learn: LearnDb };

export function hasLearn(deps: Deps): deps is LearnDeps {
  return !!deps.learn;
}

/** Why an LLM step may not spend now; null = it may. */
export async function spendBlock(deps: LearnDeps, settings: LearnSettings, estimateUsd: number): Promise<string | null> {
  if (!deps.llm) return 'no_api_key';
  if (!settings.enabled) return 'disabled';
  if (!(await deps.learn.hasLedgerCarrier())) return 'no_ledger_carrier';
  const month = monthOfDate(deps.now());
  const committed = await deps.db.monthCommitted(month, '00000000-0000-0000-0000-000000000000');
  if (committed + estimateUsd > settings.monthly_cap_usd) return 'monthly_cap';
  return null;
}

export async function submitLearnBatch(deps: LearnDeps, requests: { custom_id: string; params: BatchParams }[]): Promise<string> {
  const { id } = await deps.llm!.createBatch(requests);
  return id;
}

/** null while running; else the results by custom_id and the booked spend. */
export async function readLearnBatch(
  deps: LearnDeps, id: string, kind: string, defaultModel: string,
): Promise<{ results: Map<string, BatchResult>; usd: number } | null> {
  if (!deps.llm) return null;
  if (!(await deps.llm.isEnded(id))) return null;
  const results = new Map<string, BatchResult>();
  let usd = 0;
  for await (const r of deps.llm.results(id)) {
    results.set(r.custom_id, r);
    if (r.usage) usd += usageCostUsd(r.model ?? defaultModel, r.usage);
  }
  await bookSpend(deps, kind, usd);
  return { results, usd };
}

export async function bookSpend(deps: LearnDeps, kind: string, usd: number): Promise<void> {
  if (!(usd > 0)) return;
  const month = monthOfDate(deps.now());
  const usd6 = Math.round(usd * 1e6) / 1e6;
  await deps.learn.addLearnLedger(month, usd6);
  const cur = ((await deps.store.getJson(spendKey(month))) ?? {}) as Record<string, number>;
  cur[kind] = Math.round(((cur[kind] ?? 0) + usd6) * 1e6) / 1e6;
  await deps.store.putJson(spendKey(month), cur);
}

export async function monthKindSpend(store: Store, month: string, kind: string): Promise<number> {
  const cur = ((await store.getJson(spendKey(month))) ?? {}) as Record<string, number>;
  return Number(cur[kind] ?? 0);
}

/** JSON text of a succeeded result, else null. */
export function resultJson(r: BatchResult | undefined): unknown | null {
  if (!r || r.type !== 'succeeded' || r.stop_reason === 'max_tokens' || r.stop_reason === 'refusal') return null;
  try {
    return JSON.parse(r.text ?? '');
  } catch {
    return null;
  }
}

/** Structured-output request for the learning step (no thinking, small budget). */
export function jsonParams(model: string, system: string, user: string, schema: unknown, maxTokens: number): BatchParams {
  return {
    model,
    max_tokens: Math.min(32_000, Math.max(1024, maxTokens)),
    system: [{ type: 'text', text: system, cache_control: { type: 'ephemeral', ttl: '1h' } }],
    messages: [{ role: 'user', content: user }],
    output_config: { format: { type: 'json_schema', schema } },
  };
}
