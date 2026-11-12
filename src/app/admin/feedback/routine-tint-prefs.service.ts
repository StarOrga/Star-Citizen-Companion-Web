import { Injectable, computed, inject } from '@angular/core';
import { AccountPrefsService } from '../../core/account-prefs.service';

/** `profiles.ui_prefs` key; `true` = the two-colour liveness tint. */
export const ROUTINE_TINT_BINARY_KEY = 'feedback.routineTintBinary';

/**
 * Which palette the feedback title's liveness tint (`scRoutineStatus`) uses.
 *
 * Default: the four-state palette since #583 — green idle, cyan while a run is
 * working, amber when the usage brake holds, red when the routine went quiet.
 * Opt-in: the original two colours of feedback a7573f0e — green while the
 * routine is up or working, red while nothing is being worked on (offline or
 * paused). One admin reads the title as "is anyone on my questions?" and wants
 * exactly that yes/no back, another prefers the cyan (feedback #338) — so it is
 * a per-account choice, not a palette swap for everybody.
 *
 * Stored in `profiles.ui_prefs` through `AccountPrefsService`, so it follows the
 * account from browser to browser and nobody else ever sees it.
 */
@Injectable({ providedIn: 'root' })
export class RoutineTintPrefsService {
  private readonly account = inject(AccountPrefsService);

  /** `true` → the title is only ever green, red or (unknown) grey. */
  readonly binary = computed(() => this.account.prefs()?.[ROUTINE_TINT_BINARY_KEY] === true);

  setBinary(on: boolean): void {
    // `null` removes the key: the default stays the absence of a value.
    this.account.set(ROUTINE_TINT_BINARY_KEY, on ? true : null);
  }
}
