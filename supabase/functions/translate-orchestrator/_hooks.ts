// Seams for the learning step and the arbiter (written in parallel in _learn.ts / _arbiter.ts).
// The orchestrator swaps the no-op defaults for the real implementations; the ops in index.ts and
// _sources.ts only ever call through `learningHooks`.

import type { TmEntry } from './_diff.ts';

export interface ArbiterConflict {
  key: string;
  h: string;
  en: string;
  incumbent: TmEntry;
  challenger: TmEntry;
}

export interface LearningHooks {
  runLearning(deps: unknown, lang: string, trigger: 'publish' | 'seed' | 'sync' | 'backfill'): Promise<unknown>;
  arbitrate(deps: unknown, lang: string, conflicts: Array<{ key: string; h: string; en: string; incumbent: TmEntry; challenger: TmEntry }>): Promise<unknown>;
}

export const learningHooks: LearningHooks = {
  runLearning: () => Promise.resolve(null),
  arbitrate: () => Promise.resolve(null),
};
