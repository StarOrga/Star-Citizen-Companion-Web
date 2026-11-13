import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { RANK_TIER_COUNT, rankTier, type TierState } from './starmap.model';

/** How a crest reads on the rank ladder. */
export type CrestState = TierState;

/**
 * `<sc-kartograph-crest>` - the rank crest, a small generated SVG in the style
 * of a chart compass: a fine outer ring with 7 tick marks (the reached tiers
 * lit) around a star whose point count is the tier (tier 1 = 3 points ...
 * tier 7 = 9 points - seven distinct shapes).
 *
 * API (reused by the profile corner, the star-map head and the rank page):
 *   - `rank`   server rank (completed constellations); folded into the tier.
 *   - `tier`   1..7 directly (the rank ladder); wins over `rank`.
 *   - `size`   px, default 24.
 *   - `state`  'earned' | 'current' | 'locked' (default 'earned').
 *   - `framed` the tier-5 reward: a second, finer ring.
 *   - `orbit`  the tier-7 reward: the star turns slowly (never with reduced motion).
 *
 * Decorative (aria-hidden): the host puts label / tooltip / link around it.
 * Colours come from app tokens only.
 */
@Component({
  selector: 'sc-kartograph-crest',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '[class]': "'crest ' + state()",
    '[class.framed]': 'framed()',
    '[class.orbit]': 'orbit()',
    '[style.width.px]': 'size()',
    '[style.height.px]': 'size()',
    'aria-hidden': 'true',
  },
  template: `
    <svg viewBox="0 0 40 40" fill="none" stroke-linejoin="round" stroke-linecap="round">
      <circle class="disc" cx="20" cy="20" r="17.5" />
      @if (framed()) { <circle class="frame" cx="20" cy="20" r="19.6" /> }
      @for (t of ticks(); track $index) {
        <line class="tick" [class.lit]="t.lit" [attr.x1]="t.x1" [attr.y1]="t.y1" [attr.x2]="t.x2" [attr.y2]="t.y2" />
      }
      <g class="rose">
        <polygon class="star" [attr.points]="points()" />
        <circle class="core" cx="20" cy="20" r="1.3" />
      </g>
    </svg>
  `,
  styles: [`
    :host { display: inline-flex; flex: none; color: var(--sc-accent); line-height: 0; }
    svg { width: 100%; height: 100%; overflow: visible; }
    .disc { fill: color-mix(in srgb, var(--sc-bg-1) 85%, transparent); stroke: currentColor; stroke-width: 1; opacity: 0.9; }
    .frame { stroke: currentColor; stroke-width: 0.6; stroke-dasharray: 1.2 1.6; opacity: 0.8; }
    .tick { stroke: currentColor; stroke-width: 1.2; opacity: 0.28; }
    .tick.lit { opacity: 1; }
    .star { fill: color-mix(in srgb, currentColor 14%, transparent); stroke: currentColor; stroke-width: 1.1; }
    .core { fill: currentColor; }
    .rose { transform-origin: 20px 20px; }
    :host(.current) { filter: drop-shadow(0 0 4px color-mix(in srgb, var(--sc-accent) 55%, transparent)); }
    :host(.current) .star { fill: color-mix(in srgb, currentColor 55%, transparent); }
    :host(.locked) { color: var(--sc-fg-2); opacity: 0.5; }
    :host(.locked) .star { fill: none; stroke-dasharray: 1.4 1.4; }
    :host(.orbit) .rose { animation: crest-orbit 90s linear infinite; }
    @keyframes crest-orbit { to { transform: rotate(360deg); } }
    @media (prefers-reduced-motion: reduce) { :host(.orbit) .rose { animation: none; } }
  `],
})
export class KartographCrestComponent {
  readonly rank = input<number>(1);
  readonly tier = input<number | null>(null);
  readonly size = input<number>(24);
  readonly state = input<CrestState>('earned');
  readonly framed = input(false);
  readonly orbit = input(false);

  /** 1..7; an unranked rank still draws tier 1 (callers show a placeholder instead). */
  protected readonly n = computed(() => {
    const t = this.tier() ?? rankTier(this.rank());
    return Math.min(RANK_TIER_COUNT, Math.max(1, Math.floor(t)));
  });

  /** Star points: tier + 2 (3..9). */
  protected readonly points = computed(() => {
    const k = this.n() + 2;
    const out: string[] = [];
    for (let i = 0; i < k * 2; i++) {
      const r = i % 2 === 0 ? 11 : 4.6;
      const a = -Math.PI / 2 + (i * Math.PI) / k;
      out.push(`${(20 + r * Math.cos(a)).toFixed(2)},${(20 + r * Math.sin(a)).toFixed(2)}`);
    }
    return out.join(' ');
  });

  /** 7 compass ticks on the ring, the reached tiers lit (clockwise from the top). */
  protected readonly ticks = computed(() => {
    const lit = this.state() === 'locked' ? 0 : this.n();
    return Array.from({ length: RANK_TIER_COUNT }, (_, i) => {
      const a = -Math.PI / 2 + (i * 2 * Math.PI) / RANK_TIER_COUNT;
      const c = Math.cos(a);
      const s = Math.sin(a);
      return {
        lit: i < lit,
        x1: (20 + 14.4 * c).toFixed(2),
        y1: (20 + 14.4 * s).toFixed(2),
        x2: (20 + 17.5 * c).toFixed(2),
        y2: (20 + 17.5 * s).toFixed(2),
      };
    });
  });
}
