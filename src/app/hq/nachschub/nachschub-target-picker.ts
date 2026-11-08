import { Injectable } from '@angular/core';
import type { NachschubLineInput } from './nachschub.model';

/**
 * Contract between the Bestand (caller) and the Nachschub side (owner of the dialog).
 *
 * The Bestand hands over what the player selected and why; the picker asks where it goes —
 * an existing active Nachschub (repeatedly, R3 q-route note) or a new one — and, for `sell`,
 * the aUEC goal. It performs the write itself (`NachschubService.addToNachschub` /
 * `createSellNachschub`) and resolves with what happened, or `null` when the player cancelled.
 *
 * No stop merging across Nachschübe (R3 q-route = none): each Nachschub keeps its own route.
 */
export type NachschubTargetIntent = 'pickup' | 'sell' | 'buy';

export interface NachschubTargetRequest {
  readonly intent: NachschubTargetIntent;
  readonly lines: readonly NachschubLineInput[];
}

export interface NachschubTargetResult {
  /** Id of the Nachschub the lines landed in. */
  readonly nachschubId: string;
  /** True when a new Nachschub was created for them. */
  readonly created: boolean;
}

@Injectable({ providedIn: 'root' })
export class NachschubTargetPicker {
  /** Implemented by the Nachschub side; the placeholder never writes anything. */
  open(_request: NachschubTargetRequest): Promise<NachschubTargetResult | null> {
    return Promise.resolve(null);
  }
}
