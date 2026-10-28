import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { TranslateService } from '@ngx-translate/core';
import { ScTooltipDirective } from '../shared/tooltip/sc-tooltip.directive';
import { type StabilityLevel, type StabilityTone, toneOf } from './patch-stability';

/** Bars in the meter; one bar = 20 percentage points of surviving stability. */
export const METER_BARS = 5;
/** Below this the meter turns warning amber. */
export const METER_WEAK_BELOW = 70;

/**
 * Patch stability as a short BAR METER with its percentage — the quality mark
 * of the Patches timeline (round 3). It is deliberately not a signal-strength
 * glyph and never shares the stage's visual language: the stage ("Live", "PTU")
 * is a filled word, this is a rising bar scale plus a number. Weak values
 * (below 70 %, or an amber/red level) use the warning colour — a weaker patch
 * is a comparison, not an error. No value yet renders the empty scale.
 */
@Component({
  selector: 'sc-stability-meter',
  standalone: true,
  imports: [ScTooltipDirective],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <span class="m" [class.weak]="weak()" [class.none]="percent() === null" role="img"
          [attr.aria-label]="aria()" [scTooltip]="aria()" scTooltipTier="label" tabindex="0">
      <span class="bars" aria-hidden="true">
        @for (n of bars; track n) { <i [class.f]="n <= filled()"></i> }
      </span>
      <b class="pct" aria-hidden="true">{{ percent() === null ? '–' : percent() + ' %' }}</b>
      @if (caption(); as c) { <small class="cap" aria-hidden="true">{{ c }}</small> }
    </span>
  `,
  styles: [`
    :host { display: inline-flex; }
    .m { display: inline-grid; grid-template-columns: auto auto; align-items: center; justify-content: end; gap: 3px 6px; color: var(--sc-fg-1); white-space: nowrap; }
    .m:focus-visible { outline: 2px solid var(--sc-accent); outline-offset: 2px; border-radius: 4px; }
    .bars { display: inline-flex; align-items: flex-end; gap: 2px; height: 14px; }
    .bars i { width: 4px; border-radius: 1px; background: color-mix(in srgb, var(--sc-fg-2) 28%, transparent); }
    .bars i:nth-child(1) { height: 30%; } .bars i:nth-child(2) { height: 47%; } .bars i:nth-child(3) { height: 64%; }
    .bars i:nth-child(4) { height: 82%; } .bars i:nth-child(5) { height: 100%; }
    .bars i.f { background: var(--sc-accent); }
    .pct { font-family: var(--sc-font-display); font-size: max(0.78rem, var(--sc-fs-floor)); font-weight: 600; font-variant-numeric: tabular-nums; color: var(--sc-fg-0); }
    .cap { font-size: max(0.66rem, var(--sc-fs-floor)); color: var(--sc-fg-2); line-height: 1.25; text-align: right; white-space: normal; max-width: 9em; grid-column: 1 / -1; justify-self: end; }
    .m.weak .bars i.f { background: var(--sc-warning); }
    .m.weak .pct { color: var(--sc-warning); }
    .m.none .pct { color: var(--sc-fg-2); }
    @media (pointer: coarse) { .m { min-height: 48px; } }
  `],
})
export class StabilityMeterComponent {
  private readonly t = inject(TranslateService);
  readonly bars = Array.from({ length: METER_BARS }, (_, i) => i + 1);

  /** Surviving stability 0–100, or null while there is no verdict. */
  readonly percent = input<number | null>(null);
  readonly level = input<StabilityLevel | null>(null);
  /** Small caption next to the value; null = the level word, '' = none. */
  readonly label = input<string | null>(null);

  readonly filled = computed(() => {
    const p = this.percent();
    return p === null ? 0 : Math.max(1, Math.min(METER_BARS, Math.round(p / 20)));
  });
  readonly tone = computed<StabilityTone | null>(() => {
    const l = this.level();
    return l ? toneOf(l) : null;
  });
  readonly weak = computed(() => {
    const p = this.percent();
    return p !== null && (p < METER_WEAK_BELOW || this.tone() === 'amber' || this.tone() === 'red');
  });
  readonly caption = computed(() => {
    const own = this.label();
    if (own !== null) return own;
    const l = this.level();
    return l ? this.t.instant(`news.patch.stability.level.${l}`) : '';
  });
  readonly aria = computed(() => {
    const p = this.percent();
    if (p === null) return this.t.instant('news.patch.stability.meter.none');
    const l = this.level();
    return this.t.instant('news.patch.stability.meter.aria', {
      percent: p,
      level: l ? this.t.instant(`news.patch.stability.level.${l}`) : '',
    });
  });
}
