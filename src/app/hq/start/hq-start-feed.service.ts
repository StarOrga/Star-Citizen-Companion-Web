import { Injectable, signal } from '@angular/core';
import type { HqChip, HqPatchLine } from './hq-start.component';

/**
 * What later packages feed into the Start page. The landing binds these into `sc-hq-start`:
 * - `patchLines` — P8 web-patch: at most two lines for the newest patch, only if it touches the
 *   reader's ships/sets (empty → nothing rendered);
 * - `chips` — P3 web-ops: "Jetzt wichtig" (upcoming Einsätze …), at most four (empty → hidden).
 * A producer sets the signal when it has data and clears it (`[]`) when it has none.
 */
@Injectable({ providedIn: 'root' })
export class HqStartFeedService {
  readonly patchLines = signal<readonly HqPatchLine[]>([]);
  readonly chips = signal<readonly HqChip[]>([]);
}
