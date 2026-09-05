import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { TranslateModule } from '@ngx-translate/core';
import { EARLY_DAYS, StabilityVerdict } from './patch-stability';

/**
 * The five-level stability pill on a collapsed LIVE row. Dashed while the
 * patch is younger than EARLY_DAYS — the verdict is provisional and the
 * border says so before the tooltip does. Hidden when there is no verdict:
 * an empty chip would read as "nominal".
 */
@Component({
  selector: 'sc-stability-chip',
  standalone: true,
  imports: [TranslateModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (verdict(); as v) {
      @if (v.level !== null) {
        <span class="chip" [attr.data-level]="v.level" [class.early]="v.early"
              [attr.title]="v.early ? ('news.patch.stability.early' | translate:{ day: day(), threshold: threshold }) : null"
              [attr.aria-label]="'news.patch.stability.chipAria' | translate:{ version: v.line, level: (levelKey() | translate) }">
          <span class="dot" aria-hidden="true"></span>
          <span>{{ levelKey() | translate }}</span>
          @if (v.early) {
            <span class="early-mark">{{ 'news.patch.stability.earlyShort' | translate }}</span>
          }
        </span>
      }
    }
  `,
  styles: [`
    :host { display: inline-flex; }
    .chip {
      display: inline-flex; align-items: center; gap: 5px;
      padding: 1px 7px; border-radius: 999px;
      font-size: max(0.64rem, var(--sc-fs-floor)); font-weight: 700;
      letter-spacing: 0.02em; white-space: nowrap;
      color: var(--level); border: 1px solid color-mix(in srgb, var(--level) 55%, transparent);
    }
    .chip.early { border-style: dashed; }
    .dot { width: 6px; height: 6px; border-radius: 50%; background: var(--level); }
    .early-mark { font-weight: 500; color: var(--sc-fg-2); text-transform: uppercase; letter-spacing: 0.07em; }
    .chip[data-level='1'] { --level: var(--sc-success); }
    .chip[data-level='2'] { --level: var(--sc-accent); }
    .chip[data-level='3'] { --level: var(--sc-warning); }
    .chip[data-level='4'] { --level: var(--sc-warn); }
    .chip[data-level='5'] { --level: var(--sc-danger); }
  `],
})
export class StabilityChipComponent {
  readonly verdict = input<StabilityVerdict | null>(null);
  readonly threshold = EARLY_DAYS;
  readonly levelKey = computed(() => `news.patch.stability.level.${this.verdict()?.level ?? 1}`);
  readonly day = computed(() => Math.max(1, Math.ceil(this.verdict()?.daysLive ?? 0)));
}
