import { Injectable, inject } from '@angular/core';
import { HqSuppliesService, parseMinQuality } from '../hq-supplies.service';

export { parseMinQuality };

/**
 * The minimum quality of a Nachschub line (I15 "wünschen + einplanen" with "Eisen Q ≥ 700"). It is a column of the
 * line itself (`hq_supplies.min_quality`, migration 20261109000600), so it syncs like every other line field; this
 * store is the read/write view the picker and Planen use.
 */
@Injectable({ providedIn: 'root' })
export class NachschubMinQualityStore {
  private readonly supplies = inject(HqSuppliesService);

  /** The line's minimum quality, null when none was set. */
  get(lineId: string): number | null {
    return this.supplies.items().find((i) => i.id === lineId)?.minQuality ?? null;
  }

  set(lineId: string, quality: number | null): void {
    this.supplies.setMinQuality(lineId, quality);
  }
}
