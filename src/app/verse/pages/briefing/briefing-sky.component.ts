import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import type { VersePoint } from '../../data/verse.models';
import { skyFigure } from './briefing.model';

/**
 * The current patch's constellation (itself the star-map link), in the star
 * map's glyph language without rings: lit stars (core, spikes, a slowly
 * breathing halo) and open stars as small hollow rings. Edges are solid
 * between two lit stars and dashed wherever the figure is still incomplete.
 * No "next" star here — that guidance lives on the star map. Decorative: the
 * surrounding anchor carries the count in words.
 */
@Component({
  selector: 'sc-briefing-sky',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <svg viewBox="-12 -12 124 124" aria-hidden="true" focusable="false">
      @for (l of figure().lines; track $index) {
        <line [class]="'ln ' + l.state" [attr.x1]="l.x1" [attr.y1]="l.y1" [attr.x2]="l.x2" [attr.y2]="l.y2" />
      }
      @for (s of figure().stars; track s.i) {
        <g [class]="'st ' + s.state" [attr.transform]="'translate(' + s.x + ' ' + s.y + ')'" [style.--ph]="s.phase + 's'">
          @if (s.state === 'lit') {
            <circle class="h" r="8" />
            <path class="spk" d="M0-10L0.45 0 0 10-0.45 0zM-10 0L0 0.45 10 0 0-0.45z" />
            <circle class="c" r="1.8" />
          } @else {
            <circle class="c" r="2.2" />
          }
        </g>
      }
    </svg>
  `,
  styles: [
    `
      :host { display: block; }
      svg { display: block; width: 100%; height: 100%; overflow: visible; }
      .ln { fill: none; stroke-linecap: round; }
      .ln.lit { stroke: color-mix(in srgb, var(--sc-accent) 55%, #fff); stroke-opacity: 0.75; stroke-width: 1.1;
        filter: drop-shadow(0 0 2px var(--sc-accent)); }
      .ln.open { stroke: color-mix(in srgb, var(--sc-fg-1) 70%, transparent); stroke-opacity: 0.45; stroke-width: 0.8; stroke-dasharray: 2.4 3; }
      .h { fill: color-mix(in srgb, var(--sc-accent) 45%, #fff); opacity: 0.34; filter: blur(2.4px); }
      .lit .h { animation: glow 5s ease-in-out calc(var(--ph) * -1) infinite; animation-play-state: var(--sc-brief-play, running); }
      .spk { fill: #fff; opacity: 0.92; }
      .lit .c { fill: #fff; filter: drop-shadow(0 0 1.4px #fff); }
      /* open: the star map's open glyph — a small hollow ring, dim, no glow */
      .off .c { fill: none; stroke: color-mix(in srgb, var(--sc-fg-1) 70%, transparent); stroke-width: 0.9; }
      @keyframes glow { 0%, 100% { opacity: 0.24; } 50% { opacity: 0.4; } }
      @media (prefers-reduced-motion: reduce) {
        .lit .h { animation: none; }
      }
    `,
  ],
})
export class BriefingSkyComponent {
  readonly points = input<readonly VersePoint[] | null | undefined>(null);
  readonly lit = input(0);
  /** The star map's placement (see `explorerLit`); null → symmetric order by `lit`. */
  readonly litSet = input<ReadonlySet<number> | null>(null);
  readonly figure = computed(() => skyFigure(this.points(), this.lit(), this.litSet()));
}
