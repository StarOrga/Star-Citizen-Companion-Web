import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';

/** How a crest reads on the Kartograph ladder. */
export type CrestState = 'earned' | 'current' | 'locked';

/**
 * `<sc-kartograph-crest>` - the Kartograph rank crest, a small generated SVG.
 *
 * API (stable, reused by the profile corner badge and the Sternkarte crest ladder):
 *   - `rank`  (required, number >= 1)  rank n; every rank has its own motif: a shield
 *             whose inner star-ring grows by one point every rank (3..9 points, then it
 *             repeats with an extra outer ring every 7 ranks).
 *   - `size`  (number, px, default 24)  square edge of the crest.
 *   - `state` ('earned' | 'current' | 'locked', default 'earned')  earned = accent line
 *             art, current = filled and glowing, locked = dimmed grey.
 *
 * Decorative by itself (aria-hidden): the host puts the label / tooltip / link around it.
 * Colours come from app tokens only (`--sc-accent`, `--sc-fg-2`, `--sc-bg-1`).
 */
@Component({
  selector: 'sc-kartograph-crest',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '[class]': "'crest ' + state()",
    '[style.width.px]': 'size()',
    '[style.height.px]': 'size()',
    'aria-hidden': 'true',
  },
  template: `
    <svg viewBox="0 0 40 40" fill="none" stroke-linejoin="round" stroke-linecap="round">
      <path class="shield" d="M20 2.5 35 8v12.5c0 8.4-6 14.4-15 17-9-2.6-15-8.6-15-17V8z" />
      @if (rings() > 0) {
        <path class="band" d="M9 12.5 20 9l11 3.5" />
      }
      <polygon class="star" [attr.points]="points()" />
      @for (d of dots(); track $index) {
        <circle class="pip" [attr.cx]="d.x" [attr.cy]="d.y" r="1.1" />
      }
    </svg>
  `,
  styles: [`
    :host { display: inline-flex; flex: none; color: var(--sc-accent); line-height: 0; }
    svg { width: 100%; height: 100%; overflow: visible; }
    .shield { fill: var(--sc-bg-1); stroke: currentColor; stroke-width: 2; }
    .band { stroke: currentColor; stroke-width: 1.4; opacity: 0.7; }
    .star { fill: none; stroke: currentColor; stroke-width: 1.6; }
    .pip { fill: currentColor; stroke: none; }
    :host(.current) { filter: drop-shadow(0 0 5px color-mix(in srgb, var(--sc-accent) 60%, transparent)); }
    :host(.current) .shield { fill: color-mix(in srgb, var(--sc-accent) 24%, var(--sc-bg-1)); }
    :host(.current) .star { fill: currentColor; }
    :host(.locked) { color: var(--sc-fg-2); opacity: 0.55; }
  `],
})
export class KartographCrestComponent {
  readonly rank = input.required<number>();
  readonly size = input<number>(24);
  readonly state = input<CrestState>('earned');

  private readonly n = computed(() => Math.max(1, Math.floor(this.rank())));
  /** Extra ring count: one every 7 ranks. */
  protected readonly rings = computed(() => Math.floor((this.n() - 1) / 7));
  /** Star-ring points: 3..9, repeating. */
  private readonly tips = computed(() => 3 + ((this.n() - 1) % 7));

  protected readonly points = computed(() => {
    const k = this.tips();
    const out: string[] = [];
    for (let i = 0; i < k * 2; i++) {
      const r = i % 2 === 0 ? 9 : 4.4;
      const a = -Math.PI / 2 + (i * Math.PI) / k;
      out.push(`${(20 + r * Math.cos(a)).toFixed(1)},${(21 + r * Math.sin(a)).toFixed(1)}`);
    }
    return out.join(' ');
  });

  /** Pips under the star: one per completed outer ring, max 4. */
  protected readonly dots = computed(() => {
    const c = Math.min(4, this.rings());
    return Array.from({ length: c }, (_, i) => ({ x: 20 + (i - (c - 1) / 2) * 4, y: 32 }));
  });
}
