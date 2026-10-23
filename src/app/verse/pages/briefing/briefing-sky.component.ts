import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import type { VersePoint } from '../../data/verse.models';
import { skyFigure } from './briefing.model';

/**
 * The current patch's constellation in the briefing sky, in the star map's
 * glyph language without rings: lit stars (core, spikes, a slowly breathing
 * halo), the next star's core pushing outward, dormant cores. Decorative —
 * the star-map button carries the count in words.
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
          @switch (s.state) {
            @case ('lit') {
              <circle class="h" r="8" />
              <path class="spk" d="M0-10L0.45 0 0 10-0.45 0zM-10 0L0 0.45 10 0 0-0.45z" />
              <circle class="c" r="1.6" />
            }
            @case ('next') {
              <circle class="bl" r="3.4" />
              <path class="spk" d="M0-9L0.4 0 0 9-0.4 0zM-9 0L0 0.4 9 0 0-0.4z" />
              <circle class="c" r="1.5" />
            }
            @default {
              <circle class="ig" r="2.2" />
              <circle class="c" r="1.1" />
            }
          }
        </g>
      }
    </svg>
  `,
  styles: [
    `
      :host { display: block; }
      svg { display: block; width: 100%; height: auto; overflow: visible; }
      .ln { fill: none; stroke-linecap: round; }
      .ln.lit { stroke: color-mix(in srgb, var(--sc-accent) 55%, #fff); stroke-opacity: 0.7; stroke-width: 0.8;
        filter: drop-shadow(0 0 2px var(--sc-accent)); }
      .ln.next { stroke: color-mix(in srgb, var(--sc-accent) 55%, #fff); stroke-opacity: 0.5; stroke-width: 0.6; stroke-dasharray: 2 2; }
      .ln.off { stroke: color-mix(in srgb, var(--sc-accent) 40%, #fff); stroke-opacity: 0.28; stroke-width: 0.5; stroke-dasharray: 0.6 2.6; }
      .h { fill: color-mix(in srgb, var(--sc-accent) 45%, #fff); opacity: 0.34; filter: blur(2.4px); }
      .lit .h { animation: glow 5s ease-in-out calc(var(--ph) * -1) infinite; }
      .spk { fill: #fff; opacity: 0.92; }
      .c { fill: #fff; }
      .lit .c { filter: drop-shadow(0 0 1.4px #fff); }
      .next .bl { fill: color-mix(in srgb, var(--sc-accent) 35%, #fff); opacity: 0.6; filter: blur(1.3px);
        transform-box: fill-box; transform-origin: center; animation: push 2.4s ease-in-out infinite; }
      .next .spk { transform-box: fill-box; transform-origin: center; animation: peek 2.4s ease-in-out infinite; }
      .off .ig { fill: color-mix(in srgb, var(--sc-accent) 30%, #fff); opacity: 0.22; filter: blur(1px); }
      .off .c { opacity: 0.6; }
      @keyframes glow { 0%, 100% { opacity: 0.24; } 50% { opacity: 0.4; } }
      @keyframes push { 0%, 100% { transform: scale(0.72); opacity: 0.45; } 55% { transform: scale(1.28); opacity: 0.9; } }
      @keyframes peek { 0%, 100% { transform: scale(0.3); opacity: 0.45; } 55% { transform: scale(0.5); opacity: 0.95; } }
      @media (prefers-reduced-motion: reduce) {
        .lit .h, .next .bl, .next .spk { animation: none; }
      }
    `,
  ],
})
export class BriefingSkyComponent {
  readonly points = input<readonly VersePoint[] | null | undefined>(null);
  readonly lit = input(0);
  readonly figure = computed(() => skyFigure(this.points(), this.lit()));
}
