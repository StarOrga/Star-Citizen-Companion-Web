import { ChangeDetectionStrategy, Component, computed, inject, input, output } from '@angular/core';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { StabilityVerdict } from './patch-stability';

/**
 * All-time comparison: one column per LIVE line, height = score, colour =
 * level, the newest line hatched while early. A column is a BUTTON because
 * clicking it expands that line on this page (an action), not a navigation.
 * Hidden below two columns — a bar chart of one bar compares nothing.
 */
@Component({
  selector: 'sc-stability-history',
  standalone: true,
  imports: [TranslateModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (shown().length >= 2) {
      <section class="sh" [attr.aria-label]="'news.patch.stability.history.title' | translate">
        <div class="head">
          <h4>{{ 'news.patch.stability.history.title' | translate }}</h4>
          <span class="hint">{{ 'news.patch.stability.history.hint' | translate }}</span>
        </div>
        <div class="chart">
          @for (v of shown(); track v.line) {
            <button type="button" class="col" [class.early]="v.early" [class.none]="v.level === null"
                    [attr.data-level]="v.level ?? 0" [attr.aria-label]="colAria(v)" [attr.title]="colAria(v)"
                    (click)="showLine.emit(v.line)">
              <span class="col-bar" [style.height.%]="v.level === null ? 8 : pct(v.score)"></span>
              <span class="col-label">{{ v.line }}</span>
            </button>
          }
        </div>
      </section>
    }
  `,
  styles: [`
    :host { display: block; }
    .sh { display: flex; flex-direction: column; gap: 6px; padding: 10px 12px; border: 1px solid color-mix(in srgb, var(--sc-border) 70%, transparent); border-radius: 8px; }
    .head { display: flex; align-items: baseline; flex-wrap: wrap; gap: 8px; }
    h4 { margin: 0; font-size: max(0.8rem, var(--sc-fs-floor)); font-family: var(--sc-font-display); color: var(--sc-fg-0); }
    .hint { font-size: max(0.68rem, var(--sc-fs-floor)); color: var(--sc-fg-2); }
    .chart { display: flex; align-items: flex-end; gap: 4px; height: 110px; padding: 0 2px; border-bottom: 1px solid var(--sc-border); overflow-x: auto; }
    .col {
      flex: 1 1 0; min-width: 28px; max-width: 56px; height: 100%;
      display: flex; flex-direction: column; justify-content: flex-end; align-items: stretch; gap: 3px;
      padding: 0; background: transparent; border: 0; cursor: pointer; color: var(--sc-fg-2); font-family: inherit;
    }
    .col:hover .col-bar { filter: brightness(1.15); }
    .col:focus-visible { outline: 2px solid var(--sc-accent); outline-offset: 2px; border-radius: 4px; }
    .col-bar { width: 100%; border-radius: 2px 2px 0 0; background: var(--level, var(--sc-fg-2)); transition: height 0.3s ease; }
    .col.none .col-bar { background: color-mix(in srgb, var(--sc-fg-2) 25%, transparent); }
    .col.early .col-bar { background: repeating-linear-gradient(135deg, var(--level) 0 2px, transparent 2px 5px); outline: 1px dashed color-mix(in srgb, var(--level) 70%, transparent); }
    .col-label { font-size: max(0.62rem, var(--sc-fs-floor)); text-align: center; white-space: nowrap; }
    /* A column with no verdict carries data-level="0", which none of the rules
       below match — so it has no --level. The .early hatch above references
       var(--level) with no fallback and wins on source order, which would make
       a brand-new patch (early AND not yet enough data — the most-looked-at
       column there is) render as an invisible bar. A muted level keeps it
       hatched and legible instead. */
    [data-level='0'] { --level: color-mix(in srgb, var(--sc-fg-2) 45%, transparent); }
    [data-level='1'] { --level: var(--sc-success); }
    [data-level='2'] { --level: var(--sc-accent); }
    [data-level='3'] { --level: var(--sc-warning); }
    [data-level='4'] { --level: var(--sc-warn); }
    [data-level='5'] { --level: var(--sc-danger); }
  `],
})
export class StabilityHistoryComponent {
  private readonly t = inject(TranslateService);

  /** Oldest first, as the service delivers them. */
  readonly verdicts = input<readonly StabilityVerdict[]>([]);
  readonly showLine = output<string>();

  /** Lines that have any verdict OR are the newest (which may still be insufficient). */
  readonly shown = computed(() => {
    const all = this.verdicts();
    return all.filter((v, i) => v.level !== null || i === all.length - 1);
  });

  pct(score: number | null): number {
    return score === null ? 0 : Math.round(Math.min(1, Math.max(0, score)) * 100);
  }

  colAria(v: StabilityVerdict): string {
    const level = v.level === null
      ? this.t.instant('news.patch.stability.history.noData')
      : this.t.instant(`news.patch.stability.level.${v.level}`);
    return this.t.instant('news.patch.stability.history.colAria', { version: v.line, level });
  }
}
