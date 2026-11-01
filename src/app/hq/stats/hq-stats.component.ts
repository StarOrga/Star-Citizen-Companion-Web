import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { AuthService } from '../../auth/auth.service';
import { ScDialogDirective } from '../../shared/dialog/sc-dialog.directive';
import { ScSegmentedComponent, ScSegmentOption } from '../../shared/segmented-control.component';
import type { HqStats, HqStatsRange } from '../data/hq-db.types';
import { HQ_STATS_RANGES, HqStatsService } from '../data/hq-stats.service';
import { HqSparkComponent } from './hq-spark.component';

export type HqTileId = 'auec' | 'missions' | 'deaths' | 'crimestat' | 'refinery' | 'blueprints';

export interface HqTile {
  id: HqTileId;
  /** i18n key under `hq.stats.tile.<id>`. */
  value: string;
  /** Second line, ready-made (numbers already formatted). */
  sub: string;
  series: number[];
  series2: number[] | null;
  kind: 'bars' | 'line';
  buckets: string[];
  empty: boolean;
}

/**
 * HQ page "Statistik" (D40): six tiles with a mini preview each, a 7/30/90 day switch and a
 * detail dialog per tile. Zero data is zeros ("noch nichts erfasst"), a failed load is an error
 * state with retry. Last page: the footer follows it.
 */
@Component({
  selector: 'sc-hq-stats',
  standalone: true,
  imports: [TranslatePipe, ScSegmentedComponent, HqSparkComponent, ScDialogDirective],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="head">
      <h2 class="page-title" id="hq-stats-title">{{ 'hq.pages.statistik' | translate }}</h2>
      <sc-segmented
        [options]="rangeOptions"
        [value]="svc.range()"
        [ariaLabel]="'hq.stats.range.label' | translate"
        (valueChange)="setRange($event)" />
    </div>

    @if (svc.error() && !svc.stats()) {
      <div class="state" role="alert">
        <p>{{ svc.error()! | translate }}</p>
        <button type="button" class="sc-btn" (click)="svc.load()">{{ 'hq.stats.retry' | translate }}</button>
      </div>
    } @else if (!auth.user()) {
      <p class="state muted" role="status">{{ 'hq.stats.signedOut' | translate }}</p>
    } @else if (!svc.stats()) {
      <p class="state muted" role="status" aria-busy="true">{{ 'hq.stats.loading' | translate }}</p>
    } @else {
      @if (allEmpty()) {
        <p class="note" role="status">{{ 'hq.stats.emptyAll' | translate }}</p>
      }
      <ul class="tiles" [attr.aria-busy]="svc.loading()">
        @for (t of tiles(); track t.id) {
          <li>
            <button type="button" class="tile" [class.zero]="t.empty" (click)="open(t.id, $event)">
              <span class="t-name">{{ 'hq.stats.tile.' + t.id + '.name' | translate }}</span>
              <span class="t-value">{{ t.value }}</span>
              <span class="t-sub">{{ t.sub }}</span>
              <sc-hq-spark class="t-spark" [values]="t.series" [values2]="t.series2" [kind]="t.kind" />
              <span class="t-more">{{ 'hq.stats.details' | translate }} ›</span>
            </button>
          </li>
        }
      </ul>
      @if (svc.error()) {
        <p class="note warn" role="status">{{ svc.error()! | translate }}</p>
      }
    }

    @if (detail(); as d) {
      <div class="backdrop" (click)="close()"></div>
      <div
        class="dialog"
        scDialog
        role="dialog"
        aria-modal="true"
        [attr.aria-label]="'hq.stats.tile.' + d.id + '.name' | translate"
        (scDialogEscape)="close()">
        <header class="d-head">
          <h3>{{ 'hq.stats.tile.' + d.id + '.name' | translate }}</h3>
          <button type="button" class="sc-btn micro" (click)="close()">{{ 'hq.stats.close' | translate }}</button>
        </header>
        <p class="d-sum">{{ d.value }} · {{ d.sub }}</p>
        <sc-hq-spark class="d-spark" [values]="d.series" [values2]="d.series2" [kind]="d.kind" />
        <p class="d-hint">{{ 'hq.stats.tile.' + d.id + '.hint' | translate }}</p>
        @if (d.empty) {
          <p class="muted">{{ 'hq.stats.zero' | translate }}</p>
        } @else {
          <div class="sc-table-scroll">
            <table>
              <thead>
                <tr>
                  <th scope="col">{{ (svc.stats()?.bucket === 'week' ? 'hq.stats.week' : 'hq.stats.day') | translate }}</th>
                  <th scope="col" class="num">{{ 'hq.stats.tile.' + d.id + '.col' | translate }}</th>
                  @if (d.series2) {
                    <th scope="col" class="num">{{ 'hq.stats.tile.' + d.id + '.col2' | translate }}</th>
                  }
                </tr>
              </thead>
              <tbody>
                @for (b of d.buckets; track b; let i = $index) {
                  @if (d.series[i] > 0 || (d.series2 && d.series2[i] > 0)) {
                    <tr>
                      <td>{{ b }}</td>
                      <td class="num">{{ fmt(d.series[i]) }}</td>
                      @if (d.series2) {
                        <td class="num">{{ fmt(d.series2[i]) }}</td>
                      }
                    </tr>
                  }
                }
              </tbody>
            </table>
          </div>
        }
      </div>
    }
  `,
  styles: [
    `
      :host { display: block; }
      .head { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: var(--sc-space-3, 12px); margin-bottom: var(--sc-space-3, 12px); }
      .page-title { margin: 0; font: 600 1.6rem / 1.2 var(--sc-font-display); }
      .state { margin: 0; display: flex; flex-direction: column; align-items: flex-start; gap: var(--sc-space-2, 8px); }
      .muted { color: var(--sc-fg-2); }
      .note { margin: 0 0 var(--sc-space-3, 12px); color: var(--sc-fg-2); }
      .note.warn { color: var(--sc-warning); margin-top: var(--sc-space-3, 12px); }
      .tiles { list-style: none; margin: 0; padding: 0; display: grid; gap: var(--sc-space-3, 12px); grid-template-columns: repeat(auto-fill, minmax(min(100%, 15rem), 1fr)); }
      .tile {
        all: unset; box-sizing: border-box; cursor: pointer; width: 100%; height: 100%;
        display: grid; gap: var(--sc-space-1, 4px); padding: var(--sc-space-3, 12px);
        background: var(--sc-bg-1); border: 1px solid var(--sc-border); border-radius: var(--sc-radius);
        color: var(--sc-fg);
      }
      .tile:hover { border-color: var(--sc-accent); }
      .tile:focus-visible, .sc-btn:focus-visible { outline: 2px solid var(--sc-accent); outline-offset: 2px; }
      .t-name { color: var(--sc-fg-2); font-size: var(--sc-fs-floor, 0.8rem); text-transform: uppercase; letter-spacing: 0.04em; }
      .t-value { font: 600 1.7rem / 1.1 var(--sc-font-display); font-variant-numeric: tabular-nums; }
      .t-sub { color: var(--sc-fg-2); font-size: var(--sc-fs-floor, 0.8rem); min-height: 1.2em; }
      .t-spark { height: 2.4rem; margin-top: var(--sc-space-2, 8px); }
      .tile.zero .t-value { color: var(--sc-fg-2); }
      .t-more { color: var(--sc-accent); font-size: var(--sc-fs-floor, 0.8rem); }
      .backdrop { position: fixed; inset: 0; background: rgb(0 0 0 / 0.55); z-index: 40; }
      .dialog {
        position: fixed; z-index: 41; inset-inline: var(--sc-space-3, 12px); top: 50%; transform: translateY(-50%);
        max-width: 34rem; margin-inline: auto; max-height: 85vh; max-height: 85dvh; overflow: auto;
        background: var(--sc-bg-1); border: 1px solid var(--sc-border); border-radius: var(--sc-radius);
        padding: var(--sc-space-4, 16px); display: grid; gap: var(--sc-space-3, 12px);
      }
      .d-head { display: flex; justify-content: space-between; align-items: center; gap: var(--sc-space-3, 12px); }
      .d-head h3 { margin: 0; font: 600 1.2rem / 1.2 var(--sc-font-display); }
      .d-sum { margin: 0; font-variant-numeric: tabular-nums; }
      .d-spark { height: 5rem; }
      .d-hint { margin: 0; color: var(--sc-fg-2); font-size: var(--sc-fs-floor, 0.8rem); }
      table { width: 100%; border-collapse: collapse; font-variant-numeric: tabular-nums; }
      th, td { padding: var(--sc-space-1, 4px) var(--sc-space-2, 8px); text-align: start; border-bottom: 1px solid var(--sc-border); }
      .num { text-align: end; }
    `,
  ],
})
export class HqStatsComponent implements OnInit {
  readonly svc = inject(HqStatsService);
  readonly auth = inject(AuthService);
  private readonly i18n = inject(TranslateService);

  readonly rangeOptions: readonly ScSegmentOption[] = HQ_STATS_RANGES.map((r) => ({
    value: r,
    labelKey: `hq.stats.range.${r}`,
  }));

  private readonly detailId = signal<HqTileId | null>(null);
  private opener: HTMLElement | null = null;

  readonly tiles = computed<HqTile[]>(() => this.buildTiles(this.svc.stats()));
  readonly allEmpty = computed(() => this.tiles().every((t) => t.empty));
  readonly detail = computed(() => this.tiles().find((t) => t.id === this.detailId()) ?? null);

  ngOnInit(): void {
    if (this.auth.user()) void this.svc.load();
  }

  setRange(v: string): void {
    if ((HQ_STATS_RANGES as readonly string[]).includes(v)) void this.svc.load(v as HqStatsRange);
  }

  open(id: HqTileId, ev: Event): void {
    this.opener = ev.currentTarget as HTMLElement;
    this.detailId.set(id);
  }

  close(): void {
    this.detailId.set(null);
    this.opener?.focus();
  }

  fmt(n: number): string {
    return new Intl.NumberFormat(this.i18n.currentLang() || 'de').format(n);
  }

  private buildTiles(s: HqStats | null): HqTile[] {
    if (!s) return [];
    const days = s.range === '7d' ? 7 : s.range === '30d' ? 30 : 90;
    const vals = (p: { value: number }[]) => p.map((x) => x.value);
    const keys = (p: { bucket: string }[]) => p.map((x) => x.bucket);
    const sign = (n: number) => (n > 0 ? '+' : n < 0 ? '−' : '') + this.fmt(Math.abs(n));
    const perWeek = this.fmt(Math.round(((s.missions.total / days) * 7) * 10) / 10);
    const t = (id: HqTileId, v: string, sub: string, p: { bucket: string }[], series: number[], zero: boolean, extra: Partial<HqTile> = {}): HqTile => ({
      id, value: v, sub, series, series2: null, kind: 'bars', buckets: keys(p), empty: zero, ...extra,
    });
    const dc = s.deaths_claims;
    return [
      t('auec', sign(s.auec.net), this.i18n.instant('hq.stats.tile.auec.sub', { earned: this.fmt(s.auec.earned), spent: this.fmt(s.auec.spent) }), s.auec.series, vals(s.auec.series), s.auec.earned === 0 && s.auec.spent === 0, { kind: 'line' }),
      t('missions', this.fmt(s.missions.total), this.i18n.instant('hq.stats.tile.missions.sub', { n: perWeek }), s.missions.series, vals(s.missions.series), s.missions.total === 0),
      t('deaths', `${this.fmt(dc.deaths)} / ${this.fmt(dc.claims)}`, this.i18n.instant('hq.stats.tile.deaths.sub'), dc.series, dc.series.map((x) => x.deaths), dc.deaths === 0 && dc.claims === 0, { series2: dc.series.map((x) => x.claims), kind: 'line' }),
      t('crimestat', this.fmt(s.crimestat.total), this.i18n.instant('hq.stats.tile.crimestat.sub'), s.crimestat.series, vals(s.crimestat.series), s.crimestat.total === 0),
      t('refinery', this.fmt(s.refinery.total), this.i18n.instant('hq.stats.tile.refinery.sub'), s.refinery.series, vals(s.refinery.series), s.refinery.total === 0),
      t('blueprints', this.fmt(s.blueprints.total), this.i18n.instant('hq.stats.tile.blueprints.sub'), s.blueprints.series, vals(s.blueprints.series), s.blueprints.total === 0),
    ];
  }
}
