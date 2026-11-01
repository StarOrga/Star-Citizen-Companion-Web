import { InjectionToken, Signal, signal } from '@angular/core';
import { StepKind } from '../../shared/step/sc-step.component';

/** One step of the main path (the active Einsatz, open steps in order). */
export interface HqNowStep {
  kind: StepKind;
  label: string;
  qty: number | null;
  location: string | null;
}

/**
 * The main path of the page: the open steps of the active Einsatz. The Einsatz service provides
 * the real signal at merge; the default is an empty path.
 */
export const HQ_NOW_PATH = new InjectionToken<Signal<readonly HqNowStep[]>>('HQ_NOW_PATH', {
  providedIn: 'root',
  factory: () => signal<readonly HqNowStep[]>([]).asReadonly(),
});
