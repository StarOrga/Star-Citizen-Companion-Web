import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { EARLY_DAYS, StabilityVerdict } from './patch-stability';

/**
 * The stability of a patch as a PICTURE, parked in the top-right corner of the
 * thing it describes (owner, 2026-09-05: "Füge jedem patch der schon draußen
 * ist die stabilitätsanzeige, aber nicht wörtlich sondern bildlich hinzu, z. B.
 * rechts oben").
 *
 * A ring that fills clockwise with how much of the patch's 100 % survived, in
 * the traffic-light colour of its level — so the answer arrives as a shape and
 * a hue before any word is read. The number sits inside the ring because a
 * gauge without its value is a mood, not a measurement; the level sentence and
 * the "provisional" caveat ride in the title/aria, where they cost no layout.
 *
 * Renders NOTHING without a verdict: an empty ring in the corner of a patch
 * card would read as "0 %", which is the opposite of "we don't know yet".
 */
@Component({
  selector: 'sc-stability-badge',
  standalone: true,
  imports: [TranslateModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (shown(); as v) {
      <span class="badge" [attr.data-tone]="v.tone" [attr.data-size]="size()"
            [class.early]="v.early" [style.--fill]="v.stability + '%'"
            [attr.title]="hint()" [attr.aria-label]="hint()" role="img">
        <span class="ring" aria-hidden="true"></span>
        <span class="val" aria-hidden="true">{{ v.stability }}<i>%</i></span>
      </span>
    }
  `,
  styles: [`
    :host { display: inline-flex; }
    .badge {
      position: relative; display: inline-grid; place-items: center;
      width: var(--dia); height: var(--dia); --dia: 46px; --track: 5px;
      color: var(--tone);
    }
    .badge[data-size='sm'] { --dia: 38px; --track: 4px; }
    .badge[data-size='lg'] { --dia: 62px; --track: 6px; }
    /* The gauge: a conic sweep clipped to a ring. No SVG, no library — and it
       animates its own fill when the verdict arrives after the card. */
    .ring {
      position: absolute; inset: 0; border-radius: 50%;
      background: conic-gradient(var(--tone) var(--fill, 0%), color-mix(in srgb, var(--sc-fg-2) 22%, transparent) 0);
      -webkit-mask: radial-gradient(farthest-side, transparent calc(100% - var(--track)), #000 calc(100% - var(--track)));
      mask: radial-gradient(farthest-side, transparent calc(100% - var(--track)), #000 calc(100% - var(--track)));
      animation: sb-sweep 0.5s ease-out both;
    }
    /* Provisional verdicts get a dashed halo instead of a solid ring edge —
       the same "not final yet" grammar the chip and the chart already use. */
    .badge.early::after {
      content: ''; position: absolute; inset: -3px; border-radius: 50%;
      border: 1px dashed color-mix(in srgb, var(--tone) 60%, transparent);
    }
    .val {
      font-family: var(--sc-font-display); font-weight: 700; line-height: 1;
      font-size: max(0.76rem, var(--sc-fs-floor)); color: var(--tone);
      font-variant-numeric: tabular-nums;
    }
    .badge[data-size='sm'] .val { font-size: max(0.68rem, var(--sc-fs-floor)); }
    .badge[data-size='lg'] .val { font-size: max(1rem, var(--sc-fs-floor)); }
    .val i { font-style: normal; font-size: 0.62em; opacity: 0.7; margin-left: 1px; }

    [data-tone='green'] { --tone: var(--sc-success); }
    [data-tone='amber'] { --tone: var(--sc-warning); }
    [data-tone='red'] { --tone: var(--sc-danger); }

    @keyframes sb-sweep { from { opacity: 0; transform: scale(0.86); } to { opacity: 1; transform: none; } }
    @media (prefers-reduced-motion: reduce) { .ring { animation: none; } }
  `],
})
export class StabilityBadgeComponent {
  private readonly t = inject(TranslateService);

  readonly verdict = input<StabilityVerdict | null>(null);
  readonly size = input<'sm' | 'md' | 'lg'>('md');

  /** Only a verdict that actually resolved gets a ring. */
  readonly shown = computed(() => {
    const v = this.verdict();
    return v && v.level !== null && v.stability !== null ? v : null;
  });

  readonly hint = computed(() => {
    const v = this.shown();
    if (!v) return '';
    const base = this.t.instant('news.patch.stability.badgeAria', {
      version: v.line,
      percent: v.stability,
      level: this.t.instant(`news.patch.stability.level.${v.level}`),
    });
    if (!v.early) return base;
    const day = Math.max(1, Math.ceil(v.daysLive));
    return `${base} · ${this.t.instant('news.patch.stability.early', { day, threshold: EARLY_DAYS })}`;
  });
}
