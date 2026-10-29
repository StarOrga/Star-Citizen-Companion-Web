import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import type { VersePoint } from '../../data/verse.models';
import { skyFigure } from './briefing.model';

/** Seconds between two stars of the build-up (7 stars → ~1.4 s in all). */
export const SKY_STEP_S = 0.16;

/**
 * The current patch's constellation (itself the star-map link), in the star
 * map's glyph language without rings: lit stars (core, spikes, a slowly
 * breathing halo) and open stars as small hollow rings. Edges are solid
 * between two lit stars and dashed wherever the figure is still incomplete.
 * No "next" star here — that guidance lives on the star map. Decorative: the
 * surrounding anchor carries the count in words.
 *
 * Rendered only once the real figure is known, it builds itself up: the stars
 * appear one after another, each edge draws in (lit) or fades in (dashed)
 * right after the star it leads to. Held by the stage's pause
 * (--sc-brief-play); reduced motion shows the final figure.
 */
@Component({
  selector: 'sc-briefing-sky',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <svg viewBox="-12 -12 124 124" aria-hidden="true" focusable="false">
      @for (l of figure().lines; track $index) {
        <line [class]="'ln ' + l.state" [attr.pathLength]="l.state === 'lit' ? 1 : null" [style.--d]="lineDelay($index)" [style.--i]="$index"
              [attr.x1]="l.x1" [attr.y1]="l.y1" [attr.x2]="l.x2" [attr.y2]="l.y2" />
      }
      @for (s of figure().stars; track s.i) {
        <g [class]="'st ' + s.state" [attr.transform]="'translate(' + s.x + ' ' + s.y + ')'" [style.--ph]="s.phase + 's'" [style.--si]="s.i">
          <g class="in" [style.--d]="starDelay(s.i)">
            @if (s.state === 'lit') {
              <circle class="h" r="8" />
              <path class="spk" d="M0-10L0.45 0 0 10-0.45 0zM-10 0L0 0.45 10 0 0-0.45z" />
              <circle class="c" r="1.8" />
            } @else {
              <circle class="c" r="2.2" />
            }
          </g>
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
      /* build-up: stars pop in one by one, edges follow the star they lead to;
         scaled by the stage's --k, so a repeat visit in the session builds up fast */
      .in { transform-origin: 0 0; animation: star-in calc(0.45s * var(--k, 1)) cubic-bezier(0.2, 0.7, 0.2, 1) calc(var(--intro-d, 0s) + var(--d) * var(--k, 1)) both;
        animation-play-state: var(--sc-brief-play, running); }
      .ln { animation: line-in calc(0.5s * var(--k, 1)) ease-out calc(var(--intro-d, 0s) + var(--d) * var(--k, 1)) both; animation-play-state: var(--sc-brief-play, running); }
      .ln.lit { stroke-dasharray: 1; animation-name: line-draw; }
      @keyframes star-in { from { opacity: 0; transform: scale(0.2); } to { opacity: 1; transform: none; } }
      @keyframes line-draw { from { stroke-dashoffset: 1; } to { stroke-dashoffset: 0; } }
      @keyframes line-in { from { opacity: 0; } }
      @keyframes glow { 0%, 100% { opacity: 0.24; } 50% { opacity: 0.4; } }
      /* Hub hover (the surrounding star-map link): the lines draw themselves again
         (0.9 s, 0.18 s apart), the stars twinkle — in the star map's own white/blue. */
      :host-context(.const-l:hover) .ln.lit, :host-context(.const-l:focus-visible) .ln.lit {
        animation: line-draw 0.9s ease-out calc(var(--i) * 0.18s) both; }
      :host-context(.const-l:hover) .ln.open, :host-context(.const-l:focus-visible) .ln.open {
        animation: line-in 0.9s ease-out calc(var(--i) * 0.18s) both; }
      :host-context(.const-l:hover) .st .in, :host-context(.const-l:focus-visible) .st .in {
        animation: twinkle 1.6s ease-in-out calc(var(--si) * 0.23s) infinite; }
      /* Idle hint: the lines glimmer once. */
      :host-context(.const-l.idle) .ln { animation: glim 2.4s ease-in-out 0.4s 1 both; }
      @keyframes twinkle { 0%, 100% { opacity: 1; transform: none; } 50% { opacity: 0.6; transform: scale(1.35); } }
      @keyframes glim { 50% { stroke: #fff; stroke-opacity: 1; filter: drop-shadow(0 0 3px var(--sc-accent)); } }
      @media (prefers-reduced-motion: reduce) {
        .lit .h, .in, .ln { animation: none; }
        :host-context(.const-l) .ln, :host-context(.const-l) .st .in { animation: none !important; }
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

  /** Star `i` appears at this offset into the build-up. */
  starDelay(i: number): string {
    return `${(i * SKY_STEP_S).toFixed(2)}s`;
  }

  /** Edge `k` runs from star k to star k+1 (the last closes back to star 0): it follows its end star. */
  lineDelay(k: number): string {
    const end = Math.min(k + 1, this.figure().stars.length - 1);
    return `${(end * SKY_STEP_S + 0.15).toFixed(2)}s`;
  }
}
