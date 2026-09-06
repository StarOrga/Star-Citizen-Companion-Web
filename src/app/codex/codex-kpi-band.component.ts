import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { TranslateModule } from '@ngx-translate/core';
import { formatEquippedStat, formatEquippedStatNumber } from './codex-equipped-stats';
import { KpiCell } from './codex-loadout-stats';
import { KpiStripCell } from './codex-kpi-sets';

/**
 * Six headline numbers for the ship's active mission (02-handover §2.3 / PR C).
 * Sticky under the shell header on desktop so the KPIs stay visible while a
 * pilot scrolls the loadout/analysis columns; static on narrow viewports
 * where a sticky band would eat too much of the screen (04-rules-v2 §3).
 *
 * Every cell is read from the RESOLVED DRAFT loadout — never invented — and a
 * cell the extract has no source for renders an em-dash with a gap tooltip
 * instead of a confident zero (see `codex-loadout-stats.ts`).
 */
@Component({
  selector: 'sc-codex-kpi-band',
  standalone: true,
  imports: [TranslateModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="kpi-band" role="group" [attr.aria-label]="'codex.kpi.bandLabel' | translate">
      @for (c of cells(); track c.key) {
        <div class="kpi-cell" [class.accent]="c.accent" [class.gap]="c.value == null" [class.from-power]="c.fromPower">
          <span class="kpi-label">
            {{ c.labelKey | translate }}
            @if (c.tooltipKey; as tip) {
              <button type="button" class="kpi-info tip" tabindex="0" [attr.aria-describedby]="'kpi-tip-' + c.key">ⓘ</button>
              <span [id]="'kpi-tip-' + c.key" class="kpi-tip" role="tooltip">{{ tip | translate }}</span>
            }
          </span>
          @if (c.value != null) {
            <span class="kpi-value">{{ fmt(c) }}</span>
          } @else {
            <span class="kpi-value gap-dash" [attr.title]="c.gapKey ? (c.gapKey | translate) : null">—</span>
          }
          @if (c.delta; as d) {
            @if (deltaText(c); as body) {
              <span class="kpi-delta" [class.good]="d.good" [class.bad]="!d.good" [attr.title]="d.pctText">{{ body }}</span>
            }
          }
        </div>
      }
    </div>
  `,
  styles: [`
    :host { display: block; }
    /* Mollywator draws ONE continuous band, not six tiles: no gap, no radius,
       and the cells share a single 1px rule (part-02.html:177-179). The band
       carries no border of its own — every cell paints top/left/bottom and the
       last one closes the right edge. Dropping the radius also drops the
       overflow clip, so the label tooltips are no longer cut off at the band. */
    .kpi-band {
      display: grid;
      grid-template-columns: repeat(6, minmax(0, 1fr));
      background: var(--sc-bg-0);
      position: sticky;
      /* Approximates the shell topbar's rendered height (14px padding × 2 +
         content) plus any active impersonation banner — see shell.component.ts. */
      top: calc(var(--sc-imp-banner-h, 0px) + 64px);
      z-index: 10; /* below the swap-picker backdrop (150), compare tray (40) and the energy dock (14) */
      box-shadow: 0 6px 14px -8px rgba(0, 0, 0, 0.55);
    }
    @media (max-width: 1120px) {
      .kpi-band { position: static; grid-template-columns: repeat(3, minmax(0, 1fr)); }
      /* part-02.html:290 — once the band wraps, the cell that ends a row would
         sit open on its right, so every cell closes its own edge. */
      .kpi-cell { border-right: 1px solid var(--sc-border); }
    }
    @media (max-width: 480px) {
      .kpi-band { grid-template-columns: repeat(2, minmax(0, 1fr)); }
    }
    /* One baseline ROW per cell — label left, value pushed right, delta chip
       trailing (part-02.html:178). Not a stacked column. */
    .kpi-cell {
      background: linear-gradient(180deg, var(--sc-bg-2), var(--sc-bg-1));
      border: 1px solid var(--sc-border);
      border-right: none;
      display: flex;
      align-items: baseline;
      gap: 6px;
      /* Coarse pointers keep the 48px floor from styles.scss; the vertical
         padding is sized so the row sits centred in it instead of being pinned
         to the top by the baseline alignment. */
      padding: 14px 9px;
      min-height: 48px;
    }
    .kpi-cell:last-child { border-right: 1px solid var(--sc-border); }
    @media (pointer: fine) {
      /* The concept's own .45rem .7rem at the mock 13px root = 6px 9px, which
         is the ~25px baseline row a mouse user is meant to see. */
      .kpi-cell { padding: 6px 9px; min-height: 0; }
    }
    .kpi-cell.accent { background: linear-gradient(180deg, color-mix(in srgb, var(--sc-accent) 18%, var(--sc-bg-2)), var(--sc-bg-1)); border-bottom: 2px solid var(--sc-accent); }
    .kpi-label { font-size: max(9.5px, var(--sc-fs-floor)); color: var(--sc-fg-2); letter-spacing: 0.13em; text-transform: uppercase; }
    .kpi-value { margin-left: auto; font-family: var(--sc-font-display); font-variant-numeric: tabular-nums; font-size: 17px; color: var(--sc-fg-0); }
    .kpi-cell.gap .kpi-value.gap-dash { color: var(--sc-fg-2); font-size: 15px; cursor: help; }
    /* The delta is a tinted CHIP, not bare text (part-02.html:184-186). */
    .kpi-delta { font-size: max(10px, var(--sc-fs-floor)); font-variant-numeric: tabular-nums;
      padding: 1px 4px; border-radius: 2px; }
    .kpi-delta.good { color: var(--sc-success); background: color-mix(in srgb, var(--sc-success) 12%, transparent); }
    .kpi-delta.bad { color: var(--sc-danger); background: color-mix(in srgb, var(--sc-danger) 12%, transparent); }
    .kpi-cell.from-power { border-bottom: 2px solid var(--sc-danger); }
    .kpi-info { position: relative; margin-left: 3px; cursor: help; color: var(--sc-fg-2); font-size: 10px;
      background: none; border: none; padding: 0; font-family: inherit; }
    .kpi-info:focus-visible { outline: 2px solid var(--sc-accent); outline-offset: 2px; }
    .kpi-tip { position: absolute; display: none; }
    .kpi-info:hover + .kpi-tip, .kpi-info:focus + .kpi-tip {
      display: block; position: absolute; z-index: 25; max-width: 240px; padding: 8px 10px;
      border-radius: 6px; background: var(--sc-bg-0); border: 1px solid var(--sc-border);
      font-size: max(0.68rem, var(--sc-fs-floor)); color: var(--sc-fg-1); font-weight: 400;
      text-transform: none; letter-spacing: 0; }
  `],
})
export class CodexKpiBandComponent {
  readonly cells = input.required<readonly KpiStripCell[]>();

  fmt(c: KpiCell): string {
    return formatEquippedStat({ labelKey: c.labelKey, value: c.value!, format: c.format });
  }

  /**
   * The delta chip body: the absolute change, forced-sign, on the cell's own
   * scale but WITHOUT its unit — the value right beside it already carries
   * that, and the concept draws bare "+28" / "−225" chips.
   *
   * Null when the change rounds away to nothing. `computeKpiDelta` already
   * drops an exact tie, but a sub-unit change survives it and would render as
   * "+0", which "±0 renders nothing" (03-rules §3.5) equally forbids.
   */
  deltaText(c: KpiCell): string | null {
    const raw = c.delta!.raw;
    const magnitude = formatEquippedStatNumber({ labelKey: c.labelKey, value: Math.abs(raw), format: c.format });
    if (/^0([.,]0*)?$/.test(magnitude)) return null;
    return `${raw > 0 ? '+' : '−'}${magnitude}`;
  }
}
