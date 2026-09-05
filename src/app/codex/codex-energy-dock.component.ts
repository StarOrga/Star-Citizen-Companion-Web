// PLACEHOLDER — replaced by the dock agent's implementation on merge.
// -----------------------------------------------------------------------------
// This file exists only so the frontend shell can wire the exact contract
// (MASTER §8) and keep `npm run build` green while the dock agent lands the
// real `sc-codex-energy-dock` on this same integration branch. Do not add
// behaviour here — it renders nothing.
import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import type { SummaryOccupant } from './ship-summary-panels';
import type { PowerSheet } from './codex-power';

@Component({
  selector: 'sc-codex-energy-dock',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: ``,
})
export class CodexEnergyDockComponent {
  readonly occupants = input.required<readonly SummaryOccupant[]>();
  readonly shipStats = input<Record<string, Record<string, string | number | boolean | null>> | null>(null);
  readonly shipClassName = input.required<string>();
  readonly schemaVersion = input<number | null>(null);
  readonly userId = input<string | null>(null);
  readonly crossSection = input<number | null>(null);

  readonly sheetChange = output<PowerSheet>();
}
