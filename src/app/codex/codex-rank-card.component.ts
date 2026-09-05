import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import { TranslateModule } from '@ngx-translate/core';
import {
  RANK_PROFILES,
  RankProfileId,
  RankResult,
  RankScope,
} from './codex-rank';

/**
 * "Einordnung" — the right half of the masthead (MASTER §3). Purely
 * presentational: every number comes in through `result`, computed by the
 * page from `rankShip()`. `result === null` (and `loading === false`) is the
 * honest gap state for when the cohort has not been fetched yet — never an
 * invented percentile.
 *
 * NOTE (frontend shell, 2026-09-05): the client-side cohort fetch (batched
 * stock-loadout KPI sheets per build+scope, MASTER §3/§15) is NOT wired yet —
 * `codex-detail.component.ts` always passes `result: null`. TODO for whoever
 * picks this back up: add a `CodexService` method that returns
 * `{className, sizeClass, career, sheet}[]` for the scope's ships, cache it
 * with `readCohortCache`/`writeCohortCache` (`codex-rank.ts`), and feed
 * `rankShip()` here. The card itself needs no changes to consume it.
 */
@Component({
  selector: 'sc-codex-rank-card',
  standalone: true,
  imports: [TranslateModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="rank-card sc-card">
      <h2>
        <span class="glyph" aria-hidden="true">◈</span>
        {{ 'codex.rank.header' | translate }}
      </h2>
      <p class="cohort-line">
        {{ 'codex.rank.nShipsOfSizeClass' | translate: { n: result()?.cohortSize ?? 0, k: sizeClass() ?? '—' } }}
      </p>

      <div class="profile-row" role="tablist" [attr.aria-label]="'codex.rank.profileLabel' | translate">
        @for (p of profiles; track p.id) {
          <button
            type="button"
            role="tab"
            class="profile-chip"
            [class.active]="profile() === p.id"
            [disabled]="disabledReason(p.id)"
            [attr.aria-selected]="profile() === p.id"
            [attr.title]="disabledReason(p.id) ? (disabledReason(p.id)! | translate) : (p.labelKey | translate)"
            (click)="profileChange.emit(p.id)"
          >
            <span aria-hidden="true">{{ profile() === p.id ? '◈' : '◇' }}</span>
            {{ p.labelKey | translate }}
          </button>
        }
        <label class="scope-select">
          <span class="sr-only">{{ 'codex.rank.scopeLabel' | translate }}</span>
          <select [value]="scope()" (change)="onScopeChange($event)">
            <option value="sizeClass">{{ 'codex.rank.scope.sizeClass' | translate }}</option>
            <option value="all">{{ 'codex.rank.scope.all' | translate }}</option>
            <option value="career">{{ 'codex.rank.scope.career' | translate }}</option>
          </select>
        </label>
      </div>

      @if (loading()) {
        <div class="rank-skel sc-skel-field" aria-hidden="true"></div>
      } @else if (!result()) {
        <p class="gap-note">{{ 'codex.rank.gapAxis' | translate }}</p>
      } @else {
        <p class="verdict">
          {{ 'codex.rank.verdict' | translate: { pct: result()!.overall ?? 0, band: (result()!.bandKey! | translate), n: result()!.cohortSize } }}
          <span
            class="pct-info"
            tabindex="0"
            role="note"
            [attr.aria-describedby]="'rank-pct-tip'"
          >{{ 'codex.rank.percentile' | translate }} ⓘ</span>
          <span id="rank-pct-tip" class="pct-tip" role="tooltip">{{ 'codex.rank.percentileTooltip' | translate }}</span>
        </p>

        <svg class="radar" viewBox="0 0 200 200" [attr.aria-label]="'codex.rank.radarAria' | translate: { name: shipName(), n: result()!.cohortSize }" role="img">
          <polygon class="median" [attr.points]="polygonPoints(result()!.medianPolygon)" />
          <polygon class="ship" [attr.points]="polygonPoints(axisPercentiles())" />
        </svg>
        <p class="legend">
          <span class="leg ship">— {{ 'codex.rank.legend.ship' | translate: { name: shipName() } }}</span>
          <span class="leg median">·· {{ 'codex.rank.legend.median' | translate }}</span>
        </p>

        <ul class="bar-list">
          @for (a of result()!.axes; track a.key) {
            <li class="bar-row">
              <span class="bar-label">{{ a.labelKey | translate }}</span>
              <span class="bar-track">
                @if (a.percentile != null) {
                  <span class="bar-fill" [class.weak]="a.weak" [style.width.%]="a.percentile"></span>
                }
              </span>
              <span class="bar-value">
                @if (a.percentile != null) {
                  {{ a.percentile }}%
                } @else {
                  <span class="gap-dash" [attr.title]="a.gapKey ? (a.gapKey | translate) : null">—</span>
                }
              </span>
            </li>
          }
        </ul>
      }
    </section>
  `,
  styles: [`
    :host { display: block; }
    .rank-card { padding: 16px 18px; display: flex; flex-direction: column; gap: 10px; }
    h2 { margin: 0; font-size: 0.82rem; text-transform: uppercase; letter-spacing: 0.08em; color: var(--sc-accent);
      display: flex; align-items: center; gap: 8px; }
    .glyph { font-size: 0.9rem; }
    .cohort-line { margin: 0; font-size: max(0.72rem, var(--sc-fs-floor)); color: var(--sc-fg-2); }

    .profile-row { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
    .profile-chip { display: inline-flex; align-items: center; gap: 5px; min-height: 32px; padding: 4px 10px;
      border-radius: 999px; background: var(--sc-bg-2); border: 1px solid var(--sc-border); color: var(--sc-fg-1);
      font: inherit; font-size: max(0.7rem, var(--sc-fs-floor)); cursor: pointer; }
    .profile-chip.active { border-color: var(--sc-accent); color: var(--sc-accent);
      background: color-mix(in srgb, var(--sc-accent) 14%, var(--sc-bg-2)); }
    .profile-chip:disabled { opacity: 0.45; cursor: not-allowed; }
    .scope-select { margin-left: auto; }
    .scope-select select { padding: 5px 8px; border-radius: 6px; background: var(--sc-bg-0);
      border: 1px solid var(--sc-border); color: var(--sc-fg-1); font: inherit; font-size: max(0.7rem, var(--sc-fs-floor)); }
    .sr-only { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); }

    .rank-skel { height: 220px; border-radius: 8px; }
    .gap-note { margin: 0; font-size: max(0.76rem, var(--sc-fs-floor)); color: var(--sc-fg-2); font-style: italic; }

    .verdict { position: relative; margin: 0; font-size: 0.86rem; color: var(--sc-fg-0); }
    .pct-info { margin-left: 4px; cursor: help; color: var(--sc-fg-2); }
    .pct-tip { position: absolute; display: none; }
    .pct-info:focus + .pct-tip, .pct-info:hover + .pct-tip {
      display: block; position: absolute; z-index: 5; max-width: 260px; padding: 8px 10px;
      border-radius: 6px; background: var(--sc-bg-0); border: 1px solid var(--sc-border);
      font-size: max(0.68rem, var(--sc-fs-floor)); color: var(--sc-fg-1); }

    .radar { width: 100%; max-width: 220px; align-self: center; }
    .radar .median { fill: none; stroke: var(--sc-fg-2); stroke-width: 1; stroke-dasharray: 3 3; }
    .radar .ship { fill: color-mix(in srgb, var(--sc-accent) 22%, transparent); stroke: var(--sc-accent); stroke-width: 1.5; }
    .legend { display: flex; gap: 12px; justify-content: center; margin: 0; font-size: max(0.66rem, var(--sc-fs-floor)); color: var(--sc-fg-2); }
    .legend .ship { color: var(--sc-accent); }

    .bar-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 5px; }
    .bar-row { display: grid; grid-template-columns: 74px 1fr 34px; align-items: center; gap: 8px; }
    .bar-label { font-size: max(0.66rem, var(--sc-fs-floor)); color: var(--sc-fg-2); overflow-wrap: anywhere; }
    .bar-track { height: 8px; border-radius: 999px; background: var(--sc-bg-2); overflow: hidden; }
    .bar-fill { display: block; height: 100%; border-radius: 999px; background: var(--sc-accent); }
    .bar-fill.weak { background: var(--sc-danger); }
    .bar-value { font-size: max(0.68rem, var(--sc-fs-floor)); text-align: right; color: var(--sc-fg-0);
      font-variant-numeric: tabular-nums; }
    .gap-dash { color: var(--sc-fg-2); cursor: help; }
  `],
})
export class CodexRankCardComponent {
  readonly shipName = input.required<string>();
  readonly sizeClass = input<number | null>(null);
  readonly result = input<RankResult | null>(null);
  readonly loading = input(false);
  readonly profile = input<RankProfileId>('combat');
  readonly scope = input<RankScope>('sizeClass');
  readonly disabledReasons = input<Partial<Record<RankProfileId, string | null>>>({});

  readonly profileChange = output<RankProfileId>();
  readonly scopeChange = output<RankScope>();

  readonly profiles = RANK_PROFILES;

  readonly axisPercentiles = computed<number[]>(() =>
    (this.result()?.axes ?? []).map((a) => a.percentile ?? 0),
  );

  disabledReason(id: RankProfileId): string | null {
    return this.disabledReasons()[id] ?? null;
  }

  onScopeChange(ev: Event): void {
    this.scopeChange.emit((ev.target as HTMLSelectElement).value as RankScope);
  }

  polygonPoints(percentiles: readonly number[]): string {
    const n = percentiles.length;
    if (n === 0) return '';
    const cx = 100;
    const cy = 100;
    const r = 80;
    return percentiles
      .map((p, i) => {
        const angle = (Math.PI * 2 * i) / n - Math.PI / 2;
        const radius = (Math.max(0, Math.min(100, p)) / 100) * r;
        const x = cx + radius * Math.cos(angle);
        const y = cy + radius * Math.sin(angle);
        return `${x.toFixed(1)},${y.toFixed(1)}`;
      })
      .join(' ');
  }
}
