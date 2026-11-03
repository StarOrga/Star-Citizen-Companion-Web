import { Injectable, effect, inject, signal, untracked } from '@angular/core';
import { AccountPrefsService } from '../../core/account-prefs.service';
import { LandingItem, LandingValue } from './codex-landing-data.types';

/** Which values the holotable calls out for a ship (#884): flight is the default. */
export type CalloutSet = 'flight' | 'loadout';

const LOCAL_KEY = 'sc.codex.landing.calloutSet';
export const CALLOUT_SET_ACCOUNT_KEY = 'codex.landingCallouts';

export function parseCalloutSet(v: unknown): CalloutSet | null {
  return v === 'flight' || v === 'loadout' ? v : null;
}

function readLocal(): CalloutSet {
  try {
    return parseCalloutSet(localStorage.getItem(LOCAL_KEY)) ?? 'flight';
  } catch {
    return 'flight';
  }
}

function writeLocal(set: CalloutSet): void {
  try {
    localStorage.setItem(LOCAL_KEY, set);
  } catch {
    /* private mode / quota — the choice still holds for this page */
  }
}

/** True when the item can switch sets: a ship with at least one loadout value. */
export function hasLoadoutSet(it: LandingItem | null | undefined): boolean {
  return !!it && it.category === 'ship' && !!it.loadoutValues?.length;
}

/** The values the holotable and the values pane show for an item under a set. */
export function valuesForSet(it: LandingItem, set: CalloutSet): readonly LandingValue[] {
  return set === 'loadout' && hasLoadoutSet(it) ? it.loadoutValues! : it.topValues;
}

/**
 * The holotable's callout set (#884), shared by the table and the values pane.
 * Remembered per profile (owner decision in the concept): signed in, the
 * account copy in `profiles.ui_prefs` wins once it has loaded, so the choice
 * follows the user to every device; localStorage is the instant, signed-out
 * copy.
 */
@Injectable({ providedIn: 'root' })
export class CodexLandingCalloutSetService {
  private readonly accountPrefs = inject(AccountPrefsService);
  private readonly state = signal<CalloutSet>(readLocal());

  readonly set = this.state.asReadonly();

  constructor() {
    effect(() => {
      const fromAccount = parseCalloutSet(this.accountPrefs.prefs()?.[CALLOUT_SET_ACCOUNT_KEY]);
      if (fromAccount && fromAccount !== untracked(this.state)) {
        this.state.set(fromAccount);
        writeLocal(fromAccount);
      }
    });
  }

  choose(set: CalloutSet): void {
    if (set === this.state()) return;
    this.state.set(set);
    writeLocal(set);
    this.accountPrefs.set(CALLOUT_SET_ACCOUNT_KEY, set);
  }
}
