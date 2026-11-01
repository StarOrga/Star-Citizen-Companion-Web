import { InjectionToken, Signal, computed, inject } from '@angular/core';
import { HqEinsatzService } from '../data/hq-einsatz.service';
import { StepKind } from '../../shared/step/sc-step.component';

/** One step of the main path (the active Einsatz, open steps in order). */
export interface HqNowStep {
  kind: StepKind;
  label: string;
  qty: number | null;
  location: string | null;
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
      const list = einsatz.upcoming();
      const current = list.find((e) => e.status === 'active') ?? list[0];
      return (current?.steps ?? [])
        .filter((s) => s.state === 'todo')
        .map((s) => ({ kind: s.kind, label: s.label, qty: s.qty, location: s.location }));
    });
  },
});
