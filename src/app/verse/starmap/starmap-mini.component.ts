import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import type { VersePoint } from '../data/verse.models';
import type { StarTaskView } from './starmap.model';
import { constellationEdges, starSlots } from './starmap.model';

/**
 * The current star map in small: the very stars and lines of the dome (same
 * slots, same solid-between-two-lit / dashed-otherwise edges), scaled into a
 * header emblem. No circle, no globe. Lit stars glow; it states nothing the big
 * map does not (no task, no next-star hint). Decorative: the page states the
 * progress in words.
 */
@Component({
  selector: 'sc-starmap-mini',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <svg viewBox="-8 -8 116 116" aria-hidden="true" focusable="false">
      @for (e of edges(); track $index) {
        <path class="ln" [class.on]="e.lit" [attr.d]="'M' + e.from.x + ' ' + e.from.y + 'L' + e.to.x + ' ' + e.to.y" />
      }
      @for (s of slots(); track s.index) {
        <g [attr.transform]="'translate(' + s.x + ' ' + s.y + ')'" [class.done]="s.state === 'done'">
          @if (s.state === 'done') {
            <circle class="halo" r="9" />
            <path class="spk" d="M0-13L1 0 0 13-1 0zM-13 0L0 1 13 0 0-1z" />
          }
          <circle class="core" [attr.r]="s.state === 'done' ? 3.6 : 3" />
        </g>
      }
    </svg>
  `,
  styles: [
    `
      :host { display: block; width: 100%; height: 100%; }
      svg { display: block; width: 100%; height: 100%; overflow: visible; }
      .ln { fill: none; stroke: color-mix(in srgb, var(--sc-accent) 45%, transparent); stroke-width: 1.2; stroke-dasharray: 3 4; }
      .ln.on { stroke: var(--sc-accent); stroke-dasharray: none; stroke-width: 1.6; }
      .core { fill: color-mix(in srgb, var(--sc-fg-1) 45%, transparent); }
      .done .core { fill: #fff; }
      .halo { fill: var(--sc-accent); opacity: 0.5; filter: blur(3px); }
      .spk { fill: #fff; opacity: 0.85; }
    `,
  ],
})
export class StarmapMiniComponent {
  readonly points = input<readonly VersePoint[] | null | undefined>(null);
  readonly tasks = input<readonly StarTaskView[]>([]);
  readonly next = input<StarTaskView | null>(null);

  readonly slots = computed(() => starSlots(this.points(), this.tasks(), this.next()));
  readonly edges = computed(() => constellationEdges(this.slots()));
}
