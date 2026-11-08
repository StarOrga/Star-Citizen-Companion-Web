// B3 revision with hysteresis. An incumbent TM entry or glossary row is replaced only when the
// challenger is clearly better, so the translation neither freezes on old wording nor flips back
// and forth between two variants (oscillation). The rule is a classic hysteresis band: switching
// needs a margin over the incumbent, plus a per-release change budget that bounds churn.
// Pure decision + one DB helper; CIG and admin/locked entries never move here.

import type { LearnDb } from './_learn_db.ts';

export interface ReplaceInput {
  /** Challenger won the pairwise comparison with itself in position B (incumbent first). */
  winsForward: boolean;
  /** Challenger won with itself in position A (challenger first). */
  winsReverse: boolean;
  /** Glossary only: occurrences backing the challenger / the incumbent. null/undefined = TM entry (no evidence rule). */
  evidenceNew?: number | null;
  evidenceOld?: number | null;
  /** settings.revise_margin (start 3). */
  margin: number;
  /** Locked or admin row/entry. */
  locked: boolean;
  isCig: boolean;
  /** Changes already made for this language in the current release. */
  changedThisRelease: number;
  /** settings.revise_budget_pct, 0..100 (start 2). */
  budgetPct: number;
  /** Strings of the language (TM size) the budget is a share of. */
  langStrings: number;
}

export interface ReplaceVerdict {
  replace: boolean;
  reason: 'protected' | 'not_both_orders' | 'evidence' | 'budget' | 'ok';
}

/** Changes allowed per release: budgetPct of the language's strings, at least one while the budget is > 0. */
export function releaseBudget(budgetPct: number, langStrings: number): number {
  if (!(budgetPct > 0) || !(langStrings > 0)) return 0;
  return Math.max(1, Math.floor((budgetPct / 100) * langStrings));
}

export function shouldReplace(i: ReplaceInput): ReplaceVerdict {
  if (i.isCig || i.locked) return { replace: false, reason: 'protected' };
  if (!i.winsForward || !i.winsReverse) return { replace: false, reason: 'not_both_orders' };
  const glossary = i.evidenceNew !== undefined && i.evidenceNew !== null;
  if (glossary && (i.evidenceNew as number) < (i.evidenceOld ?? 0) + i.margin) return { replace: false, reason: 'evidence' };
  if (i.changedThisRelease >= releaseBudget(i.budgetPct, i.langStrings)) return { replace: false, reason: 'budget' };
  return { replace: true, reason: 'ok' };
}

/** Per-language revision ledger in R2: how many changes this release (= current build) already made. */
export interface ReviseState {
  build_id: string | null;
  changed: number;
}

export function reviseStateFor(prev: ReviseState | null, buildId: string | null): ReviseState {
  if (!prev || prev.build_id !== buildId) return { build_id: buildId, changed: 0 };
  return prev;
}

/**
 * A glossary change never lands on one string alone: the row gets the new target and
 * `needs_retranslate`, so the next delta job re-translates every string with the term
 * (`diffStrings` forceTerms) and resets the flag after publishing.
 */
export async function propagateGlossaryChange(
  learn: LearnDb,
  row: { id: string; origin: string; locked?: boolean },
  next: { target_term: string; evidence: number; origin?: 'mined' | 'admin' },
): Promise<boolean> {
  if (row.locked || row.origin === 'admin' || row.origin === 'cig') return false;
  await learn.updateGlossary(row.id, {
    target_term: next.target_term,
    evidence: next.evidence,
    origin: next.origin ?? 'mined',
    needs_retranslate: true,
  });
  return true;
}
