// The inspector Δ table (concept p2-table) — one perspective group per
// section, one row per KPI key, "±0 renders nothing" (03-rules §3.5, the
// SAME rule `computeKpiDelta` already enforces upstream in
// `codex-build-compare.ts`; this component only renders what it is given,
// it never recomputes the delta).
import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';
import { PerspectiveDelta } from '../codex-build-compare';
import { formatNumber } from '../codex-format';

const PERSPECTIVE_LABEL_KEYS: Record<PerspectiveDelta['perspective'], string> = {
  offensive: 'codex.holo.patch.perspective.offensive',
  defensive: 'codex.holo.patch.perspective.defensive',
  movement: 'codex.holo.patch.perspective.movement',
  signature: 'codex.holo.patch.perspective.signature',
};

const KPI_LABEL_KEYS: Record<string, string> = {
  alpha: 'codex.kpi.alpha',
  burstDps: 'codex.kpi.burstDps',
  sustainedDps: 'codex.kpi.sustainedDps',
  missiles: 'codex.kpi.missiles',
  shieldHp: 'codex.kpi.shieldHp',
  shieldRegen: 'codex.kpi.shieldRegen',
  hullHp: 'codex.kpi.hullHp',
  effectiveHp: 'codex.kpi.effectiveHp',
  armorHp: 'codex.kpi.armor',
  scm: 'codex.kpi.scm',
  maxSpeed: 'codex.kpi.maxSpeed',
  boost: 'codex.kpi.boost',
  agility: 'codex.kpi.agility',
  quantumSpeed: 'codex.kpi.quantumSpeed',
  quantumRange: 'codex.kpi.quantumRange',
  spool: 'codex.kpi.spool',
  mass: 'codex.kpi.mass',
  cargo: 'codex.kpi.cargo',
  ir: 'codex.kpi.ir',
  emIdle: 'codex.kpi.emIdle',
  emMax: 'codex.kpi.emMax',
  crossSection: 'codex.kpi.crossSection',
};

/**
 * `sc-codex-holo-patch-delta` — standalone Δ table, one instance per
 * perspective group. The host (`CodexHoloPatchComponent`) feeds it one
 * `PerspectiveDelta` from `buildPerspectiveDeltas()` at a time; rows whose
 * `delta` is null (±0 or a gap on either side) are filtered out here so a
 * perspective with nothing changed renders its group header and no rows
 * (`changedCount === 0`), never a "no changes" placeholder row.
 */
@Component({
  selector: 'sc-codex-holo-patch-delta',
  standalone: true,
  imports: [TranslatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="perspective" [attr.data-perspective]="group().perspective">
      <h3 class="ptitle">{{ labelKey() | translate }}</h3>
      @if (rows().length === 0) {
        <p class="none">{{ 'codex.holo.patch.delta.noChange' | translate }}</p>
      } @else {
        <table class="delta-table">
          <thead>
            <tr>
              <th scope="col">{{ 'codex.holo.patch.delta.kpi' | translate }}</th>
              <th scope="col">{{ 'codex.holo.patch.delta.from' | translate }}</th>
              <th scope="col">{{ 'codex.holo.patch.delta.to' | translate }}</th>
              <th scope="col">{{ 'codex.holo.patch.delta.change' | translate }}</th>
            </tr>
          </thead>
          <tbody>
            @for (row of rows(); track row.key) {
              <tr [class.up]="row.delta?.direction === 'up'" [class.down]="row.delta?.direction === 'down'"
                  [class.good]="row.delta?.good" [class.bad]="row.delta && !row.delta.good">
                <th scope="row">{{ kpiLabelKey(row.key) | translate }}</th>
                <td>{{ fmt(row.from) }}</td>
                <td>{{ fmt(row.to) }}</td>
                <td class="pct">{{ row.delta?.pctText ?? '—' }}</td>
              </tr>
            }
          </tbody>
        </table>
      }
    </section>
  `,
  styles: [`
    :host { display: block; }
    .perspective + .perspective { margin-top: 14px; }
    .ptitle { margin: 0 0 6px; font-family: var(--sc-font-display); font-size: max(0.78rem, var(--sc-fs-floor));
      letter-spacing: 0.06em; text-transform: uppercase; color: var(--sc-fg-2); }
    .none { margin: 0; padding: 4px 0; font-size: max(0.76rem, var(--sc-fs-floor)); color: var(--sc-fg-2); font-style: italic; }
    .delta-table { width: 100%; border-collapse: collapse; font-size: max(0.8rem, var(--sc-fs-floor)); }
    .delta-table th, .delta-table td { padding: 6px 8px; text-align: right; border-bottom: 1px solid var(--sc-border); font-variant-numeric: tabular-nums; }
    .delta-table th[scope="row"] { text-align: left; color: var(--sc-fg-1); font-weight: 500; }
    .delta-table thead th { color: var(--sc-fg-2); font-weight: 500; font-size: max(0.7rem, var(--sc-fs-floor));
      text-transform: uppercase; letter-spacing: 0.04em; border-bottom: 1px solid var(--sc-border); }
    tr.good .pct { color: var(--sc-accent); }
    tr.bad .pct { color: var(--sc-danger, #ff5252); }
  `],
})
export class CodexHoloPatchDeltaComponent {
  readonly group = input.required<PerspectiveDelta>();

  readonly labelKey = computed(() => PERSPECTIVE_LABEL_KEYS[this.group().perspective]);
  readonly rows = computed(() => this.group().cells.filter((c) => c.delta !== null));

  kpiLabelKey(key: string): string {
    return KPI_LABEL_KEYS[key] ?? key;
  }

  /** The page's number format ("5.861", not a bare "5861"); a gap is a dash. */
  fmt(v: number | null): string {
    return v == null ? '—' : formatNumber(v);
  }
}
