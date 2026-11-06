import { InjectionToken, Signal, computed, inject } from '@angular/core';
import { Einsatz, HqEinsatzService } from '../data/hq-einsatz.service';
import { StepKind } from '../../shared/step/sc-step.component';

/** One step of the main path (the active Einsatz, open steps in order). */
export interface HqNowStep {
  kind: StepKind;
  label: string;
  qty: number | null;
  location: string | null;
}

/** The current Einsatz of a list soonest first: the active one, else the first planned. */
export function currentEinsatz(upcoming: readonly Einsatz[]): Einsatz | null {
  return upcoming.find((e) => e.status === 'active') ?? upcoming[0] ?? null;
}

/**
 * The main path of the page: the open steps of the current Einsatz - the active one, else the
 * soonest planned one (`HqEinsatzService.upcoming`). A token so specs can swap in a fixed path.
 */
export const HQ_NOW_PATH = new InjectionToken<Signal<readonly HqNowStep[]>>('HQ_NOW_PATH', {
  providedIn: 'root',
  factory: () => {
    const einsatz = inject(HqEinsatzService);
    return computed(() => {
      return (currentEinsatz(einsatz.upcoming())?.steps ?? [])
        .filter((s) => s.state === 'todo')
        .map((s) => ({ kind: s.kind, label: s.label, qty: s.qty, location: s.location }));
    });
  },
});
