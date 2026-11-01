import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';

/**
 * Tiny inline chart for the Statistik tiles: bars (counts per bucket) or a line (a running
 * quantity), optionally with a second series drawn dashed. Decorative by default (`aria-hidden`);
 * the tile's text carries the numbers. Colours come from app tokens, a flat series draws a
 * baseline instead of an empty box.
 */
@Component({
  selector: 'sc-hq-spark',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <svg class="spark" viewBox="0 0 100 32" preserveAspectRatio="none" aria-hidden="true" focusable="false">
      <line class="base" x1="0" y1="31.5" x2="100" y2="31.5" />
      @if (kind() === 'bars') {
        @for (b of bars(); track $index) {
          <rect class="bar" [attr.x]="b.x" [attr.y]="b.y" [attr.width]="b.w" [attr.height]="b.h" />
        }
      } @else {
        <polyline class="line" [attr.points]="line()" />
      }
      @if (line2()) {
        <polyline class="line two" [attr.points]="line2()" />
      }
    </svg>
  `,
  styles: [
    `
      :host { display: block; }
      .spark { display: block; width: 100%; height: 100%; overflow: visible; }
      .base { stroke: var(--sc-border); stroke-width: 1; vector-effect: non-scaling-stroke; }
      .bar { fill: var(--sc-accent); opacity: 0.85; }
      .line { fill: none; stroke: var(--sc-accent); stroke-width: 2; vector-effect: non-scaling-stroke; stroke-linejoin: round; }
      .line.two { stroke: var(--sc-warning); stroke-dasharray: 3 2; }
    `,
  ],
})
export class HqSparkComponent {
  readonly values = input.required<readonly number[]>();
  readonly values2 = input<readonly number[] | null>(null);
  readonly kind = input<'bars' | 'line'>('bars');

  private readonly max = computed(() => Math.max(1, ...this.values(), ...(this.values2() ?? [])));

  readonly bars = computed(() => {
    const v = this.values();
    const n = Math.max(1, v.length);
    const slot = 100 / n;
    const w = Math.max(0.6, slot * 0.7);
    return v.map((x, i) => {
      const h = x > 0 ? Math.max(2, (x / this.max()) * 30) : 0;
      return { x: i * slot + (slot - w) / 2, y: 31 - h, w, h };
    });
  });

  readonly line = computed(() => this.points(this.values()));
  readonly line2 = computed(() => (this.values2() ? this.points(this.values2()!) : ''));

  private points(v: readonly number[]): string {
    if (!v.length) return '';
    const step = v.length > 1 ? 100 / (v.length - 1) : 0;
    return v.map((x, i) => `${(i * step).toFixed(2)},${(30 - (Math.max(0, x) / this.max()) * 28).toFixed(2)}`).join(' ');
  }
}
