import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { TranslateModule } from '@ngx-translate/core';
import { formatEquippedStat } from './codex-equipped-stats';
import { KpiCell } from './codex-loadout-stats';

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
        <div class="kpi-cell" [class.accent]="c.accent" [class.gap]="c.value == null">
          <span class="kpi-label">{{ c.labelKey | translate }}</span>
          @if (c.value != null) {
            <span class="kpi-value">{{ fmt(c) }}</span>
          } @else {
            <span class="kpi-value gap-dash" [attr.title]="c.gapKey ? (c.gapKey | translate) : null">—</span>
          }
          @if (c.delta; as d) {
            <span class="kpi-delta" [class.good]="d.good" [class.bad]="!d.good" [class.dir-down]="d.direction === 'down'">
              {{ d.direction === 'up' ? '▲' : '▼' }}
              @if (d.pctText) { {{ d.pctText }} }
            </span>
          }
        </div>
      }
    </div>
  `,
  styles: [`
    :host { display: block; }
    .kpi-band {
      display: grid;
      grid-template-columns: repeat(6, minmax(0, 1fr));
      gap: 1px;
      background: var(--sc-border);
      border: 1px solid var(--sc-border);
      border-radius: 8px;
      overflow: hidden;
      position: sticky;
      /* Approximates the shell topbar's rendered height (14px padding × 2 +
         content) plus any active impersonation banner — see shell.component.ts. */
      top: calc(var(--sc-imp-banner-h, 0px) + 64px);
      z-index: 20; /* below the swap-picker backdrop (150) and compare tray (40) */
    }
    @media (max-width: 1120px) {
      .kpi-band { position: static; grid-template-columns: repeat(3, minmax(0, 1fr)); }
    }
    @media (max-width: 480px) {
      .kpi-band { grid-template-columns: repeat(2, minmax(0, 1fr)); }
    }
    .kpi-cell {
      background: linear-gradient(180deg, var(--sc-bg-2), var(--sc-bg-1));
      padding: 10px 12px;
      display: flex;
      flex-direction: column;
      gap: 2px;
      min-height: 48px;
      justify-content: center;
    }
    .kpi-cell.accent { background: linear-gradient(180deg, color-mix(in srgb, var(--sc-accent) 18%, var(--sc-bg-2)), var(--sc-bg-1)); border-bottom: 2px solid var(--sc-accent); }
    .kpi-label { font-size: 12px; color: var(--sc-fg-2); letter-spacing: 0.02em; text-transform: uppercase; }
    .kpi-value { font-family: var(--sc-font-display); font-variant-numeric: tabular-nums; font-size: 15px; color: var(--sc-fg-0); }
    .kpi-cell.gap .kpi-value.gap-dash { color: var(--sc-fg-2); cursor: help; }
    .kpi-delta { font-size: 12px; font-variant-numeric: tabular-nums; }
    .kpi-delta.good { color: var(--sc-success); }
    .kpi-delta.bad { color: var(--sc-danger); }
  `],
})
export class CodexKpiBandComponent {
  readonly cells = input.required<readonly KpiCell[]>();

  fmt(c: KpiCell): string {
    return formatEquippedStat({ labelKey: c.labelKey, value: c.value!, format: c.format });
  }
}
