import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import type { VersePoint } from '../data/verse.models';
import { FALLBACK_POINTS, lightRank, litIndices } from './starmap.model';

/**
 * One constellation as SVG: outline, 7 stars (lit in SYMMETRIC order — the CSS
 * stagger follows the same rank), the sun above-right when the comet hit, and
 * the patch number as a barely visible catalogue watermark. Decorative: the
 * host page states the progress in words.
 */
@Component({
  selector: 'sc-constellation-figure',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <svg viewBox="-8 -14 122 122" [class.small]="size() === 'small'" aria-hidden="true" focusable="false">
      <polygon class="outline" [class.on]="lit().size > 0" [attr.points]="outline()" />
      @for (s of stars(); track s.i) {
        <g class="star" [class.lit]="s.lit" [style.--rank]="s.rank" [attr.transform]="'translate(' + s.x + ' ' + s.y + ')'">
          <circle class="halo" r="7" />
          <circle class="core" r="2.2" />
        </g>
      }
      @if (sun()) {
        <g class="sun" [class.big]="size() === 'large'" transform="translate(104 -4)">
          <circle class="corona" [attr.r]="size() === 'large' ? 14 : 6" />
          <circle class="disc" [attr.r]="size() === 'large' ? 5 : 2.2" />
        </g>
      }
      @if (watermark() && size() === 'large') {
        <text class="mark" [attr.x]="markAt()[0] + 4" [attr.y]="markAt()[1] + 7">{{ watermark() }}</text>
      }
    </svg>
  `,
  styles: [
    `
      :host { display: block; }
      svg { display: block; width: 100%; height: auto; overflow: visible; }
      .outline { fill: none; stroke: color-mix(in srgb, var(--sc-accent) 18%, transparent); stroke-width: 0.6; }
      .outline.on { stroke: color-mix(in srgb, var(--sc-accent) 45%, transparent); }
      .star .core { fill: color-mix(in srgb, var(--sc-fg-1) 35%, transparent); transition: fill 400ms ease calc(var(--rank) * 140ms); }
      .star .halo { fill: var(--sc-accent); opacity: 0; transform: scale(0.4); transform-box: fill-box; transform-origin: center;
        transition: opacity 500ms ease calc(var(--rank) * 140ms), transform 500ms ease calc(var(--rank) * 140ms); filter: blur(2px); }
      .star.lit .core { fill: #fff; }
      .star.lit .halo { opacity: 0.45; transform: scale(1); }
      .small .outline { stroke-width: 1.4; }
      .small .star .core { r: 4; }
      .sun .corona { fill: var(--sc-warning); opacity: 0.25; filter: blur(3px); }
      .sun .disc { fill: color-mix(in srgb, var(--sc-warning) 40%, #fff); }
      .mark { font: 600 4.2px var(--sc-font-display); fill: var(--sc-fg-1); opacity: 0.08; letter-spacing: 0.04em; }
      @media (prefers-reduced-motion: reduce) {
        .star .core, .star .halo { transition: none; }
      }
    `,
  ],
})
export class ConstellationFigureComponent {
  readonly points = input<readonly VersePoint[] | null | undefined>(null);
  readonly starCount = input(0);
  readonly sun = input(false);
  readonly size = input<'large' | 'small'>('large');
  /** Patch number, rendered as the faint catalogue mark (large only). */
  readonly watermark = input<string | null>(null);

  private readonly pts = computed(() => {
    const p = this.points();
    return p && p.length === 7 ? p : FALLBACK_POINTS;
  });
  readonly lit = computed(() => litIndices(this.pts(), this.starCount()));
  readonly stars = computed(() => {
    const rank = lightRank(this.pts());
    const lit = this.lit();
    return this.pts().map((p, i) => ({ i, x: p[0] * 100, y: p[1] * 100, lit: lit.has(i), rank: rank[i] }));
  });
  readonly outline = computed(() => this.stars().map((s) => `${s.x},${s.y}`).join(' '));
  readonly markAt = computed<[number, number]>(() => {
    const lit = [...this.lit()];
    const s = this.stars()[lit.length ? Math.min(...lit) : 0];
    return [s.x, s.y];
  });
}
