import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';
import { ScTristateComponent } from '../../shared/tristate/sc-tristate.component';
import { PlanNeed, PlanSelection, PlanSet, selectedFraction, setFraction, setReach } from './hq-plan-selection';

interface RingRow {
  set: PlanSet;
  /** Wanted share of the set's Nachschub lines (D28) - the arc. */
  fraction: number;
  /** How much of it is selected right now. */
  selected: number;
  reach: 'full' | 'partial' | null;
}

/**
 * Sets as tri-state rings (D28). The arc is the share of the set's Nachschub lines the user marked
 * as wanted (never the catalog), the hint under the ring says whether the wanted parts are
 * reachable. A click selects (or deselects) all needs of the set; selected sets glow.
 */
@Component({
  selector: 'sc-hq-set-rings',
  standalone: true,
  imports: [TranslatePipe, ScTristateComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (rows().length === 0) {
      <p class="none">{{ 'hq.set.none' | translate }}</p>
    } @else {
      <ul class="rings">
        @for (r of rows(); track r.set.key) {
          <li class="ring" [class.on]="r.selected > 0">
            <sc-tristate [value]="r.fraction" [label]="r.set.name" (toggled)="setToggled.emit(r.set.key)" />
            <span class="name">{{ r.set.name }}@if (r.set.favorite) { <span class="fav" aria-hidden="true"> ★</span> }</span>
            <span class="hint">
              @if (r.reach === 'full') { {{ 'hq.set.reach.full' | translate }} }
              @else if (r.reach === 'partial') { {{ 'hq.set.reach.partial' | translate }} }
            </span>
          </li>
        }
      </ul>
    }
  `,
  styles: [
    `
      :host { display: block; }
      .none { margin: 0; color: var(--sc-fg-2); }
      .rings { list-style: none; margin: 0; padding: 0; display: flex; flex-wrap: wrap; gap: var(--sc-space-3, 12px); }
      .ring {
        --sc-tristate-size: 40px;
        display: grid;
        grid-template-columns: auto 1fr;
        grid-template-areas: 'ring name' 'ring hint';
        column-gap: var(--sc-space-3, 12px);
        align-items: center;
        min-width: 180px;
        padding: var(--sc-space-2, 8px) var(--sc-space-3, 12px);
        border: 1px solid var(--sc-border);
        border-radius: 12px;
        background: var(--sc-bg-0);
        transition: border-color 0.15s ease, box-shadow 0.15s ease;
      }
      .ring.on { border-color: var(--sc-accent); box-shadow: 0 0 14px color-mix(in srgb, var(--sc-accent) 28%, transparent); }
      sc-tristate { grid-area: ring; }
      .name { grid-area: name; color: var(--sc-fg); overflow-wrap: anywhere; }
      .fav { color: var(--sc-accent); }
      .hint { grid-area: hint; min-height: 1.2em; font-size: max(0.8rem, var(--sc-fs-floor)); color: var(--sc-fg-2); }
      @media (prefers-reduced-motion: reduce) { .ring { transition: none; } }
    `,
  ],
})
export class HqSetRingsComponent {
  readonly sets = input.required<readonly PlanSet[]>();
  readonly needs = input.required<readonly PlanNeed[]>();
  readonly selection = input.required<PlanSelection>();
  /** A ring was clicked: the host toggles the set in the selection. */
  readonly setToggled = output<string>();

  protected readonly rows = computed<RingRow[]>(() =>
    this.sets()
      .filter((s) => this.needs().some((n) => n.setKey === s.key) || s.favorite)
      .map((set) => ({
        set,
        fraction: setFraction(set.key, this.needs()),
        selected: selectedFraction(this.selection(), set.key, this.needs()),
        reach: setReach(set.key, this.needs()),
      })),
  );
}
