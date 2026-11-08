import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';

/** Cubes drawn inside a crate (three rows of four); the share of closed lines fills them from the bottom left. */
export const CRATE_CUBES = 12;

/** How many of the {@link CRATE_CUBES} are lit for `done` of `total` lines (at least one once anything is done). */
export function litCubes(done: number, total: number): number {
  if (total <= 0 || done <= 0) return 0;
  return Math.min(CRATE_CUBES, Math.max(1, Math.round((done / total) * CRATE_CUBES)));
}

const CELLS = Array.from({ length: CRATE_CUBES }, (_, i) => ({ x: 17 + (i % 4) * 22, y: 72 - Math.floor(i / 4) * 12 }));

/**
 * One Nachschub as a freight crate ("Frachtkiste", round 4 slot style "crate", polished): a steel body with straps and
 * corner brackets, a lid that lifts when the crate is selected, and goods cubes that light up with progress. A finished
 * crate turns green. Purely decorative: the host names it.
 */
@Component({
  selector: 'sc-nachschub-crate',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '[class.open]': 'open()', '[class.full]': 'full()', 'aria-hidden': 'true' },
  template: `
    <svg viewBox="0 0 120 92" focusable="false">
      <ellipse class="shadow" cx="60" cy="87" rx="46" ry="3.2" />
      <rect class="body" x="10" y="34" width="100" height="50" rx="4" />
      <path class="slat" d="M10 46h100M10 58h100M10 70h100" />
      <g class="goods">
        @for (c of cells; track $index) {
          <rect [class.lit]="$index < lit()" [attr.x]="c.x" [attr.y]="c.y" width="18" height="9" rx="1.6" />
        }
      </g>
      <path class="bracket" d="M10 44v-6a4 4 0 0 1 4-4h6M110 44v-6a4 4 0 0 0-4-4h-6M10 74v6a4 4 0 0 0 4 4h6M110 74v6a4 4 0 0 1-4 4h-6" />
      <g class="lid">
        <path class="lid-top" d="M8 34 L15 21 H105 L112 34 Z" />
        <path class="lid-edge" d="M15 27h90" />
      </g>
          </svg>
  `,
  styles: [
    `
      :host { display: block; width: min(100%, 120px); aspect-ratio: 120 / 92; color: var(--sc-accent); }
      svg { display: block; width: 100%; height: 100%; overflow: visible; }
      .shadow { fill: rgb(0 0 0 / 0.35); }
      .body { fill: color-mix(in srgb, var(--sc-accent) 9%, var(--sc-bg-1)); stroke: color-mix(in srgb, currentColor 75%, transparent); stroke-width: 1.6; }
      .slat { fill: none; stroke: color-mix(in srgb, currentColor 24%, transparent); stroke-width: 1.2; }
      .bracket { fill: none; stroke: currentColor; stroke-width: 1.8; stroke-linecap: round; }
      .lid { transform-box: fill-box; transform-origin: 50% 100%; transition: transform 0.28s cubic-bezier(0.2, 0.8, 0.2, 1); }
      .lid-top { fill: color-mix(in srgb, var(--sc-accent) 16%, var(--sc-bg-1)); stroke: color-mix(in srgb, currentColor 75%, transparent); stroke-width: 1.6; stroke-linejoin: round; }
      .lid-edge { stroke: color-mix(in srgb, currentColor 30%, transparent); stroke-width: 1.2; }
      .goods rect { fill: color-mix(in srgb, currentColor 14%, transparent); }
      .goods rect.lit { fill: currentColor; opacity: 0.9; }
      :host(.open) .lid { transform: translate(-3px, -14px) rotate(-5deg); }
      :host(.full) { color: var(--sc-success); }
      :host(.full) .body { fill: color-mix(in srgb, var(--sc-success) 12%, var(--sc-bg-1)); }
      @media (prefers-reduced-motion: reduce) { .lid { transition: none; } }
    `,
  ],
})
export class NachschubCrateComponent {
  readonly done = input(0);
  readonly total = input(0);
  readonly open = input(false);
  protected readonly cells = CELLS;
  protected readonly lit = computed(() => litCubes(this.done(), this.total()));
  protected readonly full = computed(() => this.total() > 0 && this.done() >= this.total());
}
