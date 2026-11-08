// Seams for the learning step and the arbiter. index.ts and _sources.ts only ever call through
// `learningHooks`; the implementations live in _learn.ts (C0–C8, B1, B3) and _arbiter.ts (B2).

import type { TmEntry } from './_diff.ts';
import { arbitrate } from './_arbiter.ts';
import { runLearning } from './_learn.ts';
import type { Deps } from './_machine.ts';

export interface ArbiterConflict {
  key: string;
  h: string;
  en: string;
  incumbent: TmEntry;
  challenger: TmEntry;
}

export interface LearningHooks {
  runLearning(deps: unknown, lang: string, trigger: 'publish' | 'seed' | 'sync' | 'backfill'): Promise<unknown>;
  arbitrate(deps: unknown, lang: string, conflicts: ArbiterConflict[]): Promise<unknown>;
}

/** No learning adapter (`deps.learn`) → nothing to do, like the state machine's own guard. */
const hasLearn = (deps: unknown): deps is Deps => !!(deps as Deps | null)?.learn;

export const learningHooks: LearningHooks = {
  runLearning: (deps, lang, trigger) => (hasLearn(deps) ? runLearning(deps, lang, trigger) : Promise.resolve(null)),
  arbitrate: (deps, lang, conflicts) => (hasLearn(deps) ? arbitrate(deps, lang, conflicts) : Promise.resolve(null)),
};
